/**
 * Phase 2 gate, base layer only, no ephemeral rollup.
 *
 * Creates a table, seats three funded players, then has them leave, asserting
 * throughout that chips are conserved. Chips only ever move between a player's
 * balance and their seat stack, so the system-wide total must never change.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN, web3 } from "@coral-xyz/anchor";
import { Solpoker } from "../target/types/solpoker";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import { assert } from "chai";

const MAX_SEATS = 6;
const STARTING_CHIPS = 10_000;

/** Must match `MICRO_USDC_PER_CHIP` in the program. */
const MICRO_USDC_PER_CHIP = 100_000;
/** The devnet test mint, whose keypair was destroyed at creation. */
const USDC_MINT = new PublicKey("CzZoUHtyZkarrnRbsjPVEge6UANgCYrq8Bb8ambjjTxq");

const ata = (owner: PublicKey, offCurve = false) =>
  getAssociatedTokenAddressSync(USDC_MINT, owner, offCurve);

const SMALL_BLIND = new BN(5);
const BIG_BLIND = new BN(10);
const MIN_BUY_IN = new BN(200);
const MAX_BUY_IN = new BN(2_000);

describe("SolPoker Phase 2, base layer", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Solpoker as Program<Solpoker>;
  const connection = provider.connection;

  // Three independent player wallets, funded with SOL for rent and fees.
  const players = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  const buyIns = [new BN(500), new BN(1_000), new BN(2_000)];

  // Unique per run so repeated runs never collide on an existing table PDA.
  const tableId = new BN(Math.floor(Date.now() / 1000));

  const [config] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), tableId.toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const [table] = PublicKey.findProgramAddressSync(
    [Buffer.from("table"), tableId.toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const seatPdas = Array.from(
    { length: MAX_SEATS },
    (_, i) =>
      PublicKey.findProgramAddressSync(
        [Buffer.from("seat"), table.toBuffer(), Buffer.from([i])],
        program.programId,
      )[0],
  );
  const [handPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("hand"), table.toBuffer()],
    program.programId,
  );
  const [deckPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("deck"), table.toBuffer()],
    program.programId,
  );
  const playerPda = (owner: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("player"), owner.toBuffer()],
      program.programId,
    )[0];

  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId,
  );

  /** The accounts a buy or a sell takes, beyond what the IDL can derive. */
  const tradeAccounts = (owner: PublicKey, kind: "buy" | "sell") => ({
    player: playerPda(owner),
    vault,
    usdcMint: USDC_MINT,
    vaultAta: ata(vault, true),
    ...(kind === "buy" ? { buyerAta: ata(owner) } : { sellerAta: ata(owner) }),
    authority: owner,
  });

  /** A token balance, where a missing account reads as zero rather than throwing. */
  async function tokenAmount(address: PublicKey): Promise<number> {
    const info = await connection.getAccountInfo(address);
    return info ? Number(info.data.readBigUInt64LE(64)) : 0;
  }

  /** Chips in balances plus chips in seat stacks, the system-wide total. */
  async function totalChips(): Promise<number> {
    let total = 0;
    for (const p of players) {
      const acct = await program.account.player.fetch(playerPda(p.publicKey));
      total += acct.chips.toNumber();
    }
    for (const s of seatPdas) {
      const acct = await program.account.seat.fetch(s);
      total += acct.stack.toNumber();
    }
    return total;
  }

  before(async function () {
    this.timeout(300_000);
    console.log("Program:  ", program.programId.toBase58());
    console.log("Table id: ", tableId.toString());

    // SOL for rent and fees; the chips are bought with USDC below. The
    // provider wallet is the test mint's mint authority, so the buy-in money
    // is printed rather than begged from a faucet with a queue.
    const funder = (provider.wallet as anchor.Wallet).payer;
    const needed = STARTING_CHIPS * MICRO_USDC_PER_CHIP * 2; // room to round-trip
    for (const p of players) {
      const tx = new anchor.web3.Transaction().add(
        web3.SystemProgram.transfer({
          fromPubkey: funder.publicKey,
          toPubkey: p.publicKey,
          lamports: 0.05 * LAMPORTS_PER_SOL,
        }),
        createAssociatedTokenAccountIdempotentInstruction(
          funder.publicKey,
          ata(p.publicKey),
          p.publicKey,
          USDC_MINT,
        ),
        createMintToInstruction(USDC_MINT, ata(p.publicKey), funder.publicKey, needed),
      );
      await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
    }
    console.log(
      `  three players funded with $${(needed / 1e6).toFixed(2)} of test USDC each`,
    );
  });

  it("initializes players and buys their first chips with USDC", async () => {
    for (const p of players) {
      await program.methods
        .initPlayer()
        .accounts({ authority: p.publicKey })
        .signers([p])
        .rpc({ commitment: "confirmed" });

      await program.methods
        .buyChips(new BN(STARTING_CHIPS))
        .accountsPartial(tradeAccounts(p.publicKey, "buy"))
        .signers([p])
        .rpc({ commitment: "confirmed" });

      const acct = await program.account.player.fetch(playerPda(p.publicKey));
      assert.equal(acct.chips.toNumber(), STARTING_CHIPS);
    }
    console.log(`  three players bought ${STARTING_CHIPS} chips each`);
  });

  it("backs every purchase with USDC in the vault", async () => {
    const held = await tokenAmount(ata(vault, true));
    assert.isAtLeast(
      held,
      3 * STARTING_CHIPS * MICRO_USDC_PER_CHIP,
      "the vault must hold the USDC that backs the chips",
    );
    console.log(`  vault holds $${(held / 1e6).toLocaleString()}`);
  });

  it("sells chips back for exactly what they cost", async () => {
    const p = players[0];
    const before = await tokenAmount(ata(p.publicKey));
    await program.methods
      .sellChips(new BN(1_000))
      .accountsPartial(tradeAccounts(p.publicKey, "sell"))
      .signers([p])
      .rpc({ commitment: "confirmed" });
    const after = await tokenAmount(ata(p.publicKey));
    const acct = await program.account.player.fetch(playerPda(p.publicKey));
    assert.equal(acct.chips.toNumber(), STARTING_CHIPS - 1_000);
    // Exactly, not approximately: the fee is paid in SOL, so nothing rounds.
    assert.equal(
      after - before,
      1_000 * MICRO_USDC_PER_CHIP,
      "selling must pay the fixed rate back to the penny",
    );

    // Round-trip: buy them back so the rest of the suite sees a full stack.
    await program.methods
      .buyChips(new BN(1_000))
      .accountsPartial(tradeAccounts(p.publicKey, "buy"))
      .signers([p])
      .rpc({ commitment: "confirmed" });
  });

  it("refuses to sell chips the player does not hold", async () => {
    try {
      await program.methods
        .sellChips(new BN(999_999_999))
        .accountsPartial(tradeAccounts(players[0].publicKey, "sell"))
        .signers([players[0]])
        .rpc({ commitment: "confirmed" });
      assert.fail("overselling should have been rejected");
    } catch (e: any) {
      assert.include(e.toString(), "InsufficientChips");
    }
  });

  /**
   * The reason the allowlist exists.
   *
   * Opening an associated token account is permissionless, so anyone can create
   * the vault's account for a mint they control. Without the address check, the
   * chips that buy would produce are indistinguishable from chips bought with
   * real money — and they cash out as real money.
   */
  it("refuses a mint it does not recognise, in both directions", async () => {
    const junk = Keypair.generate();
    const funder = (provider.wallet as anchor.Wallet).payer;
    const junkAta = getAssociatedTokenAddressSync(junk.publicKey, players[0].publicKey);
    const junkVaultAta = getAssociatedTokenAddressSync(junk.publicKey, vault, true);

    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        web3.SystemProgram.createAccount({
          fromPubkey: funder.publicKey,
          newAccountPubkey: junk.publicKey,
          space: MINT_SIZE,
          lamports: await getMinimumBalanceForRentExemptMint(connection),
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(junk.publicKey, 6, funder.publicKey, null),
        createAssociatedTokenAccountIdempotentInstruction(
          funder.publicKey, junkAta, players[0].publicKey, junk.publicKey,
        ),
        createAssociatedTokenAccountIdempotentInstruction(
          funder.publicKey, junkVaultAta, vault, junk.publicKey,
        ),
        createMintToInstruction(junk.publicKey, junkAta, funder.publicKey, 1_000_000_000),
      ),
      [junk],
      { commitment: "confirmed" },
    );

    for (const kind of ["buy", "sell"] as const) {
      try {
        await (kind === "buy"
          ? program.methods.buyChips(new BN(100))
          : program.methods.sellChips(new BN(100))
        )
          .accountsPartial({
            player: playerPda(players[0].publicKey),
            vault,
            usdcMint: junk.publicKey,
            vaultAta: junkVaultAta,
            ...(kind === "buy" ? { buyerAta: junkAta } : { sellerAta: junkAta }),
            authority: players[0].publicKey,
          })
          .signers([players[0]])
          .rpc({ commitment: "confirmed" });
        assert.fail(`${kind} with a printed mint should have been rejected`);
      } catch (e: any) {
        assert.include(e.toString(), "WrongMint");
      }
    }
    console.log("  a self-printed mint buys nothing and redeems nothing");
  });

  it("creates a table with six seat PDAs", async () => {
    await program.methods
      .createTable(tableId, SMALL_BLIND, BIG_BLIND, MIN_BUY_IN, MAX_BUY_IN, new BN(30))
      .accountsPartial({
        config,
        table,
        hand: handPda,
        deck: deckPda,
        creator: provider.wallet.publicKey,
      })
      .rpc({ commitment: "confirmed" });

    // Seats are created individually: doing all six alongside the table blew the
    // 4KB BPF stack frame in Anchor's generated account resolution.
    for (let i = 0; i < MAX_SEATS; i++) {
      await program.methods
        .createSeat(i)
        .accountsPartial({
          table,
          seat: seatPdas[i],
          payer: provider.wallet.publicKey,
        })
        .rpc({ commitment: "confirmed" });
    }

    const cfg = await program.account.tableConfig.fetch(config);
    assert.equal(cfg.smallBlind.toNumber(), 5);
    assert.equal(cfg.bigBlind.toNumber(), 10);
    assert.equal(cfg.maxSeats, MAX_SEATS);

    const t = await program.account.table.fetch(table);
    assert.equal(t.handNumber.toNumber(), 0);
    // Delegation is account ownership now, not a flag: an undelegated table is
    // simply owned by the program.
    assert.deepEqual(Object.keys(t.state)[0], "waiting");

    for (let i = 0; i < MAX_SEATS; i++) {
      const s = await program.account.seat.fetch(seatPdas[i]);
      assert.equal(s.seatIndex, i);
      assert.equal(s.stack.toNumber(), 0);
      assert.equal(s.table.toBase58(), table.toBase58());
    }
    console.log("  table + hand + deck + 6 seat PDAs created");
  });

  it("seats three players, moving chips from balance to stack", async () => {
    const before = await totalChips();

    for (let i = 0; i < players.length; i++) {
      await program.methods
        .joinTable(i, buyIns[i])
        .accountsPartial({
          config,
          table,
          seat: seatPdas[i],
          player: playerPda(players[i].publicKey),
          authority: players[i].publicKey,
        })
        .signers([players[i]])
        .rpc({ commitment: "confirmed" });

      const seat = await program.account.seat.fetch(seatPdas[i]);
      const player = await program.account.player.fetch(
        playerPda(players[i].publicKey),
      );
      assert.equal(seat.stack.toNumber(), buyIns[i].toNumber());
      assert.equal(seat.occupant.toBase58(), players[i].publicKey.toBase58());
      assert.equal(
        player.chips.toNumber(),
        STARTING_CHIPS - buyIns[i].toNumber(),
        "buy-in must come out of the balance",
      );
      console.log(
        `  seat ${i}: bought in for ${buyIns[i].toString()}, ` +
          `${player.chips.toString()} left in balance`,
      );
    }

    const t = await program.account.table.fetch(table);
    assert.equal(t.seats.filter((s) => !s.equals(PublicKey.default)).length, 3);

    assert.equal(await totalChips(), before, "chips must be conserved");
  });

  it("rejects a buy-in outside the table limits", async () => {
    const p = Keypair.generate();
    const sig = await connection.requestAirdrop(
      p.publicKey,
      0.05 * LAMPORTS_PER_SOL,
    );
    await connection.confirmTransaction(sig, "confirmed");
    await program.methods
      .initPlayer()
      .accounts({ authority: p.publicKey })
      .signers([p])
      .rpc({ commitment: "confirmed" });
    await program.methods
      .buyChips(new BN(STARTING_CHIPS))
      .accountsPartial({ player: playerPda(p.publicKey), authority: p.publicKey })
      .signers([p])
      .rpc({ commitment: "confirmed" });

    // Above max_buy_in.
    try {
      await program.methods
        .joinTable(3, new BN(9_000))
        .accountsPartial({
          config,
          table,
          seat: seatPdas[3],
          player: playerPda(p.publicKey),
          authority: p.publicKey,
        })
        .signers([p])
        .rpc({ commitment: "confirmed" });
      assert.fail("over-max buy-in should have been rejected");
    } catch (e: any) {
      assert.include(e.toString(), "BuyInOutOfRange");
    }
  });

  it("rejects taking an occupied seat", async () => {
    const p = Keypair.generate();
    const sig = await connection.requestAirdrop(
      p.publicKey,
      0.05 * LAMPORTS_PER_SOL,
    );
    await connection.confirmTransaction(sig, "confirmed");
    await program.methods
      .initPlayer()
      .accounts({ authority: p.publicKey })
      .signers([p])
      .rpc({ commitment: "confirmed" });
    await program.methods
      .buyChips(new BN(STARTING_CHIPS))
      .accountsPartial({ player: playerPda(p.publicKey), authority: p.publicKey })
      .signers([p])
      .rpc({ commitment: "confirmed" });

    try {
      await program.methods
        .joinTable(0, new BN(500))
        .accountsPartial({
          config,
          table,
          seat: seatPdas[0],
          player: playerPda(p.publicKey),
          authority: p.publicKey,
        })
        .signers([p])
        .rpc({ commitment: "confirmed" });
      assert.fail("taking seat 0 should have been rejected");
    } catch (e: any) {
      assert.include(e.toString(), "SeatOccupied");
    }
  });

  it("rejects sitting at two seats with one wallet", async () => {
    try {
      await program.methods
        .joinTable(4, new BN(500))
        .accountsPartial({
          config,
          table,
          seat: seatPdas[4],
          player: playerPda(players[0].publicKey),
          authority: players[0].publicKey,
        })
        .signers([players[0]])
        .rpc({ commitment: "confirmed" });
      assert.fail("double-seating should have been rejected");
    } catch (e: any) {
      assert.include(e.toString(), "AlreadySeated");
    }
  });

  it("returns the full stack when players leave", async () => {
    const before = await totalChips();

    for (let i = 0; i < players.length; i++) {
      await program.methods
        .leaveTable(i)
        .accountsPartial({
          table,
          seat: seatPdas[i],
          player: playerPda(players[i].publicKey),
          authority: players[i].publicKey,
        })
        .signers([players[i]])
        .rpc({ commitment: "confirmed" });

      const seat = await program.account.seat.fetch(seatPdas[i]);
      const player = await program.account.player.fetch(
        playerPda(players[i].publicKey),
      );
      assert.equal(seat.stack.toNumber(), 0);
      assert.equal(seat.occupant.toBase58(), PublicKey.default.toBase58());
      assert.equal(
        player.chips.toNumber(),
        STARTING_CHIPS,
        "leaving must restore the original balance exactly",
      );
    }

    const t = await program.account.table.fetch(table);
    assert.equal(
      t.seats.filter((s) => !s.equals(PublicKey.default)).length,
      0,
      "table should be empty",
    );

    const after = await totalChips();
    assert.equal(after, before, "chips must be conserved");
    console.log(
      `  all three left; chip total unchanged at ${after} ` +
        `(3 x ${STARTING_CHIPS})`,
    );
  });

  it("conserves chips across the whole run", async () => {
    let sum = 0;
    for (const p of players) {
      const acct = await program.account.player.fetch(playerPda(p.publicKey));
      sum += acct.chips.toNumber();
    }
    assert.equal(
      sum,
      players.length * STARTING_CHIPS,
      "every chip minted by the faucet is still accounted for",
    );
    console.log(`  final: ${sum} chips across ${players.length} players`);
  });
});
