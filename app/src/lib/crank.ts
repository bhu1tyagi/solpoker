/**
 * Keeping the table moving.
 *
 * There is no server. Starting a hand, dealing, turning a street, settling and
 * timing out are all permissionless, so every client watches the same state and
 * does whatever is next. Two browsers will sometimes try the same step at the
 * same moment; the loser gets a specific error back and treats it as done.
 *
 * Two things keep that from being chaos:
 *
 * 1. Steps are idempotent on chain, so a duplicate is refused rather than
 *    applied twice.
 * 2. Clients wait their turn. A seat's delay is based on where it sits among
 *    the occupied seats, so the lowest one usually acts and the others only
 *    step in if it did not. That turns a race into a fallback chain.
 *
 * Your own salt work has no delay. Nobody else can do it for you.
 */

import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import type { SolpokerProgram } from "./anchor";
import {
  COMMIT_EVERY,
  MAX_SEATS,
  NO_SEAT,
  SALT_COMMITTED,
  SALT_NONE,
  SHUFFLE_IDLE,
} from "./constants";
import {
  advanceStreetIx,
  commitResultsIx,
  commitSaltIx,
  dealHoleCardsIx,
  forceTimeoutIx,
  requestShuffleIx,
  resetShuffleIx,
  revealSaltIx,
  secureHoleIx,
  settleHandIx,
  startHandIx,
  type SessionSigner,
} from "./instructions";
import { isRaceLost, isTransient, sendEr } from "./net";
import { commitmentFor, getOrCreateSalt } from "./salts";
import type { HandView, SeatView, TableView } from "@/stores/table-store";

export interface CrankContext {
  connection: Connection;
  program: SolpokerProgram;
  table: PublicKey;
  config: PublicKey;
  /** The session key signs everything here, so no prompts mid-hand. */
  session: Keypair;
  sessionToken: PublicKey;
  wallet: PublicKey;
  mySeat: number;
  /** Blocks the next hand until this one has been written to history. */
  captureReady: () => boolean;
  onError?: (e: unknown, step: string) => void;
}

export interface CrankSnapshot {
  table: TableView | null;
  hand: HandView | null;
  seats: (SeatView | null)[];
  /** Hand number stamped on our own hole account, the deal-done signal. */
  myHoleHandNumber: number;
}

/** Base pause before acting on a shared step, plus a slot per occupied seat. */
const BASE_DELAY_MS = 350;
const PER_RANK_MS = 1200;
/** How long to let stragglers reveal before asking for randomness. */
const SALT_QUIET_MS = 2500;
/**
 * How long to wait for a committed-but-unrevealed salt before going on
 * without it. A player who commits and then closes the tab must not be able
 * to hold the table hostage; their commitment simply misses this shuffle.
 */
const SALT_ABANDON_MS = 20_000;
/** An armed step whose condition stopped holding forgets its arming time. */
const ARM_EXPIRY_MS = 1_500;

type StepKey = string;

export class Crank {
  private inflight = new Set<StepKey>();
  private backoff = new Map<StepKey, number>();
  private armedAt = new Map<StepKey, { since: number; lastSeen: number }>();
  /** When observed salt state last advanced, across every seat, any client. */
  private lastSaltProgress = 0;
  private lastSaltFingerprint = "";
  /** Hands this client has already sent a deal for, for the not-dealt-in case. */
  private dealtHands = new Set<number>();
  /**
   * Seats this client has already tried to re-secure, per hand.
   *
   * A locked-out permission fails every time, so without this the attempt would
   * fire on every tick forever. One try per seat per hand is enough to catch
   * the case where it can actually succeed.
   */
  private securedTried = new Set<string>();

  constructor(private ctx: CrankContext) {}

  update(ctx: Partial<CrankContext>) {
    this.ctx = { ...this.ctx, ...ctx };
  }

  private signer(): SessionSigner {
    return {
      payer: this.ctx.session.publicKey,
      authority: this.ctx.wallet,
      sessionToken: this.ctx.sessionToken,
    };
  }

  /**
   * Do the hole cards still need dealing for this hand?
   *
   * Dealing stamps the hand number onto every hole account, so our own account
   * is the signal. A client that is not dealt in cannot see any hole account,
   * so it falls back to remembering whether it has already sent one, and the
   * on-chain idempotence covers the rest.
   */
  private needsDeal(hand: HandView, snap: CrankSnapshot): boolean {
    const dealtIn = (hand.dealtIn & (1 << this.ctx.mySeat)) !== 0;
    if (this.ctx.mySeat >= 0 && dealtIn) {
      return snap.myHoleHandNumber !== hand.handNumber;
    }
    return this.dealtHands.has(hand.handNumber) === false;
  }

  /** How long this client waits before doing work anyone could do. */
  private sharedDelay(snap: CrankSnapshot): number {
    const occupied: number[] = [];
    for (let i = 0; i < MAX_SEATS; i++) {
      if (snap.seats[i]?.occupant) occupied.push(i);
    }
    const rank = Math.max(0, occupied.indexOf(this.ctx.mySeat));
    return BASE_DELAY_MS + rank * PER_RANK_MS;
  }

  /**
   * Run a step once the condition has held for long enough.
   *
   * Arming rather than firing immediately is what stops six clients sending the
   * same transaction at the same instant.
   */
  private async armed(
    key: StepKey,
    delayMs: number,
    run: () => Promise<void>,
  ): Promise<void> {
    if (this.inflight.has(key)) return;

    const until = this.backoff.get(key) ?? 0;
    if (Date.now() < until) return;

    // Arming only counts while the condition keeps holding. A step whose
    // condition lapsed and came back must wait its full delay again, or a
    // stale entry would let it fire instantly and skip the grace period.
    const now = Date.now();
    const armed = this.armedAt.get(key);
    if (armed === undefined || now - armed.lastSeen > ARM_EXPIRY_MS) {
      this.armedAt.set(key, { since: now, lastSeen: now });
      return;
    }
    armed.lastSeen = now;
    if (now - armed.since < delayMs) return;

    this.inflight.add(key);
    try {
      await run();
      this.backoff.delete(key);
    } catch (e) {
      if (isRaceLost(e)) {
        // Someone else did it, or the chain is not ready for it yet. Either
        // way, pause briefly rather than knocking every tick.
        this.backoff.set(key, Date.now() + 2000);
      } else {
        const attempts = (this.backoff.get(`${key}:n`) ?? 0) + 1;
        this.backoff.set(`${key}:n`, attempts);
        this.backoff.set(key, Date.now() + Math.min(8000, 1500 * attempts));
        if (!isTransient(e)) this.ctx.onError?.(e, key);
      }
    } finally {
      this.inflight.delete(key);
      this.armedAt.delete(key);
    }
  }

  private async send(ix: Awaited<ReturnType<typeof startHandIx>>, label: string) {
    const tx = new Transaction().add(ix);
    await sendEr(this.ctx.connection, tx, {
      signers: [this.ctx.session],
      feePayer: this.ctx.session.publicKey,
      label,
    });
  }

  /**
   * Note whether anyone's salt state moved since last tick. This watches the
   * chain rather than this client's own sends, so six clients agree on when
   * the protocol went quiet.
   */
  private observeSaltProgress(hand: HandView, seats: (SeatView | null)[]) {
    const fingerprint =
      hand.saltMask + ":" + seats.map((s) => s?.saltState ?? 0).join("");
    if (fingerprint !== this.lastSaltFingerprint) {
      this.lastSaltFingerprint = fingerprint;
      this.lastSaltProgress = Date.now();
    }
  }

  /** One pass over the state machine. Called on a timer and on every update. */
  async tick(snap: CrankSnapshot): Promise<void> {
    const { table, hand, seats } = snap;
    if (!table || !hand) return;
    this.observeSaltProgress(hand, seats);

    const shared = this.sharedDelay(snap);
    const me = this.ctx.mySeat >= 0 ? seats[this.ctx.mySeat] : null;
    const nHand = hand.handNumber;

    // ---- your own salt, no delay, nobody can do it for you ----
    if (
      me?.occupant === this.ctx.wallet.toBase58() &&
      table.state === 0 &&
      hand.shuffleState === SHUFFLE_IDLE &&
      this.ctx.captureReady()
    ) {
      const nextHand = nHand + 1;
      const salt = getOrCreateSalt(this.ctx.table.toBase58(), nextHand);

      if (me.saltState === SALT_NONE) {
        await this.armed(`commit:${nextHand}`, 0, async () => {
          const ix = await commitSaltIx(
            this.ctx.program,
            this.ctx.table,
            this.ctx.mySeat,
            commitmentFor(salt),
            this.signer(),
          );
          await this.send(ix, "commit salt");
        });
        return;
      }

      if (me.saltState === SALT_COMMITTED) {
        await this.armed(`reveal:${nextHand}`, 0, async () => {
          try {
            const ix = await revealSaltIx(
              this.ctx.program,
              this.ctx.table,
              this.ctx.mySeat,
              salt,
              this.signer(),
            );
            await this.send(ix, "reveal salt");
          } catch (e) {
            // The commitment on chain does not open with the salt we hold,
            // which means storage was lost between commit and reveal. The way
            // out is to commit again with the salt we do have; retrying the
            // reveal would fail identically forever.
            if (String(e).includes("SaltMismatch")) {
              const ix = await commitSaltIx(
                this.ctx.program,
                this.ctx.table,
                this.ctx.mySeat,
                commitmentFor(salt),
                this.signer(),
              );
              await this.send(ix, "recommit salt");
              return;
            }
            throw e;
          }
        });
        return;
      }
    }

    // ---- shared work from here down ----

    // Try to point each occupied seat's hole-card permission at whoever is
    // sitting in it now. Sitting down clears that flag on chain, because a
    // permission still naming the previous occupant would let them read the new
    // player's cards.
    //
    // Best effort, but it now matters: `start_hand` deals only to seats whose
    // permission names their current occupant, and sits the rest out. A seat
    // that stays unsecured is a player who does not get dealt in, so this is
    // the repair path, not a nicety.
    //
    // It is also reachable again. A permission can only be updated by the
    // member it already names, and the program now refuses to create one for an
    // empty seat, so every permission that exists names somebody and can be
    // re-pointed by them. Every occupied seat is tried each hand rather than
    // just the first, because one seat failing must not hide the others.
    if (table.state === 0) {
      for (let i = 0; i < MAX_SEATS; i++) {
        const s = seats[i];
        if (!s?.occupant || s.cardsSecured) continue;
        if (this.securedTried.has(`${i}:${nHand}`)) continue;
        this.securedTried.add(`${i}:${nHand}`);
        try {
          const ix = await secureHoleIx(
            this.ctx.program,
            this.ctx.table,
            i,
            this.ctx.session.publicKey,
          );
          await this.send(ix, `secure seat ${i}`);
        } catch {
          // Someone else got there first, or this client cannot update that
          // seat's permission. Either way the hand can still be dealt to
          // everyone else, so carry on rather than stalling the table.
        }
      }
    }

    // Clear a shuffle request the oracle never answered, or one whose
    // randomness can no longer be used.
    //
    // This is the way out of the worst stall in the game. A fulfilled deck that
    // `start_hand` keeps refusing — the ordinary end of a heads-up session,
    // where one player busts and there is no longer a second funded seat —
    // cannot be published, so the table cannot be paused, so nobody can cash
    // out. Chips sat on the rollup with no route back. The instruction is
    // permissionless and time-gated, so every client tries and the early ones
    // bounce off harmlessly.
    if (
      table.state === 0 &&
      hand.shuffleState !== SHUFFLE_IDLE &&
      hand.deadline > 0 &&
      Date.now() / 1000 > hand.deadline
    ) {
      await this.armed(`reset-shuffle:${nHand}`, shared, async () => {
        const ix = await resetShuffleIx(
          this.ctx.program,
          this.ctx.table,
          this.ctx.session.publicKey,
        );
        await this.send(ix, "clear stale shuffle");
      });
      return;
    }

    // Ask for randomness once enough salts are in and the protocol has gone
    // quiet. Waiting for every committed seat to reveal is polite, but a seat
    // that committed and vanished must not stall the table forever, so after
    // long enough the shuffle goes on without it.
    // Never draw a shuffle for a hand that cannot start. `start_hand` needs two
    // seats with chips, and randomness drawn for a hand that never begins is
    // exactly what strands a table: the deck holds a secret it cannot publish,
    // so it cannot leave the rollup. Cheaper not to ask than to clean up after.
    const funded = seats.filter((s) => s?.occupant && s.stack > 0).length;

    const saltQuietFor = Date.now() - this.lastSaltProgress;
    if (
      table.state === 0 &&
      funded >= 2 &&
      hand.shuffleState === SHUFFLE_IDLE &&
      countBits(hand.saltMask) >= 2 &&
      saltQuietFor > SALT_QUIET_MS &&
      (allRevealersDone(seats) || saltQuietFor > SALT_ABANDON_MS)
    ) {
      await this.armed(`shuffle:${nHand}`, shared, async () => {
        const ix = await requestShuffleIx(
          this.ctx.program,
          this.ctx.table,
          this.ctx.session.publicKey,
        );
        await this.send(ix, "request shuffle");
      });
      return;
    }

    // Once randomness is requested, knock with start_hand until the program
    // stops refusing it. Fulfillment lands on the private deck, so there is
    // nothing public to watch for; ShuffleNotReady refusals pace the knocking.
    if (table.state === 0 && hand.shuffleState !== SHUFFLE_IDLE) {
      await this.armed(`start:${nHand}`, shared, async () => {
        const ix = await startHandIx(
          this.ctx.program,
          this.ctx.table,
          this.ctx.config,
          this.ctx.session.publicKey,
        );
        await this.send(ix, "start hand");
      });
      return;
    }

    if (table.state !== 1) return;

    // Hole cards. Dealing is idempotent per hole on chain, so a duplicate
    // attempt writes nothing rather than dealing twice.
    if (hand.dealtIn !== 0 && this.needsDeal(hand, snap)) {
      await this.armed(`deal:${nHand}`, shared, async () => {
        const ix = await dealHoleCardsIx(
          this.ctx.program,
          this.ctx.table,
          this.ctx.session.publicKey,
        );
        await this.send(ix, "deal hole cards");
        this.dealtHands.add(nHand);
      });
      return;
    }

    // Street complete: turn the next card, or settle at showdown.
    if (hand.toAct === NO_SEAT) {
      if (hand.street < 4) {
        await this.armed(`street:${nHand}:${hand.street}`, shared, async () => {
          const ix = await advanceStreetIx(
            this.ctx.program,
            this.ctx.table,
            this.ctx.config,
            this.ctx.session.publicKey,
          );
          await this.send(ix, "advance street");
        });
      } else {
        await this.armed(`settle:${nHand}`, shared, async () => {
          const ix = await settleHandIx(
            this.ctx.program,
            this.ctx.table,
            this.ctx.config,
            this.ctx.session.publicKey,
          );
          await this.send(ix, "settle hand");
        });
      }
      return;
    }

    // Somebody is not acting. Past the deadline anyone may act for them.
    const now = Date.now() / 1000;
    if (hand.toAct !== NO_SEAT && now > hand.deadline + 1) {
      const key = `timeout:${nHand}:${hand.street}:${hand.toAct}`;
      // Never race to time yourself out.
      const delay = hand.toAct === this.ctx.mySeat ? shared + 3000 : shared;
      await this.armed(key, delay, async () => {
        const ix = await forceTimeoutIx(
          this.ctx.program,
          this.ctx.table,
          this.ctx.config,
          this.ctx.session.publicKey,
        );
        await this.send(ix, "force timeout");
      });
    }
  }

  /**
   * Push results to the base layer.
   *
   * Not every hand: each delegated account gets ten free commits, so a table
   * that settled after every hand would be out after ten. Play at rollup speed,
   * settle on a slower cadence: whenever the base layer has fallen a batch of
   * hands behind, between hands.
   */
  async maybeCommit(snap: CrankSnapshot, lastRecorded: number): Promise<void> {
    const { table, hand } = snap;
    if (!table || !hand || table.state !== 0) return;
    if (hand.handNumber === 0) return;
    if (hand.handNumber - lastRecorded < COMMIT_EVERY) return;

    await this.armed(`commit:results:${hand.handNumber}`, this.sharedDelay(snap), async () => {
      const ix = await commitResultsIx(
        this.ctx.program,
        this.ctx.table,
        this.ctx.session.publicKey,
      );
      await this.send(ix, "commit results");
    });
  }

  /** Commit right now, regardless of cadence. */
  async commitNow(): Promise<void> {
    const ix = await commitResultsIx(
      this.ctx.program,
      this.ctx.table,
      this.ctx.session.publicKey,
    );
    await this.send(ix, "commit results");
  }
}

const countBits = (n: number) => {
  let c = 0;
  for (let i = 0; i < 8; i++) if (n & (1 << i)) c++;
  return c;
};

/** Nobody is mid-protocol with a commitment they have not opened yet. */
function allRevealersDone(seats: (SeatView | null)[]): boolean {
  return seats.every((s) => !s || s.saltState !== SALT_COMMITTED);
}

