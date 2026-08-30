"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useElementWidth } from "@/hooks/use-viewport";
import { PlayingCard, CardSlot } from "@/components/primitives/PlayingCard";
import { ChipStack, Coin, chipsFor } from "@/components/primitives/Chip";
import { AnimatedNumber } from "@/components/primitives/AnimatedNumber";
import { SeatPod } from "./SeatPod";
import { toast } from "@/stores/ui-store";
import { TABLE_CANVAS, TABLE_GEOMETRY, spring, stagger } from "@/styles/theme";
import { MAX_SEATS, STREET_NAMES } from "@/lib/constants";
import { NO_CARD } from "@/lib/engine/cards";
import type { HandView, SeatView, TableView } from "@/stores/table-store";
import type { Award, ShowdownStage } from "@/hooks/use-showdown-sequence";

interface Props {
  table: TableView | null;
  hand: HandView | null;
  seats: (SeatView | null)[];
  mySeat: number;
  myHole: number[] | null;
  myHoleHandNumber: number;
  pot: number;
  winning?: Set<number>;
  winners?: Set<number>;
  timeoutSecs: number;
  onSit?: (index: number) => void;
  /** Where a viewer sits determines the rotation, so you are always at the bottom. */
  status?: string;
  /** The table is working on something invisible, so show it shuffling. */
  working?: boolean;
  /** A long operation with steps, drawn over the felt. */
  overlay?: string;
  /** The end-of-hand sequence: reveal, compare, award. */
  showdown?: {
    stage: ShowdownStage;
    awards: Award[];
    pot: number;
    shown: Set<number>;
    /** Who was in the hand, kept from before settlement cleared it. */
    dealtIn: number;
  };
  /** Named hands at showdown, by seat, shown under each pod. */
  handNames?: Map<number, string>;
  /** Stand the table on end, for a phone held upright. */
  portrait?: boolean;
  /**
   * A hint that this is a phone-sized room, used only for the first frame.
   * From the frame after, the felt measures itself and decides — see the note
   * on TABLE_CANVAS.
   */
  compact?: boolean;
  /** Your seat's TEE permission is confirmed, so your hole cards are secured. */
  secured?: boolean;
}

export function TableFelt({
  table,
  hand,
  seats,
  mySeat,
  myHole,
  myHoleHandNumber,
  pot,
  winning,
  winners,
  timeoutSecs,
  onSit,
  status,
  working = false,
  overlay,
  showdown,
  handNames,
  portrait = false,
  compact: compactHint = false,
  secured,
}: Props) {
  // Rotate the table so the local player sits at the bottom. Spectators get the
  // natural order.
  const view = (i: number) => (mySeat >= 0 ? (i - mySeat + MAX_SEATS) % MAX_SEATS : i);

  // Which way the table stands decides where everything around it sits. A
  // compact table also deals the small board: full-size cards would leave no
  // clear lane between the board and the seats for bets to sit in.
  const geo = TABLE_GEOMETRY[portrait ? "portrait" : "wide"];

  /*
   * Draw the table once, at its canvas size, and scale the whole thing to
   * whatever width the room gives it.
   *
   * The felt was fluid and everything standing on it was not, so any width
   * short of 1120px drew furniture too big for the cloth — on a tablet the
   * seats' hands lay across the board, and on a phone held sideways the table
   * was unreadable. Scaling as one object is how a real client does it, and it
   * is what lets one set of seat percentages serve every screen.
   */
  const box = useRef<HTMLDivElement>(null);
  const measured = useElementWidth(box);
  // Below the compact threshold the furniture switches to its phone sizes on a
  // smaller canvas, so labels stay proportionally larger than a straight scale
  // would leave them. Until the first measurement the caller's hint stands in.
  const compact =
    portrait ||
    (measured === null ? compactHint : measured < TABLE_CANVAS.wideCompactBelow);
  const canvasW = portrait
    ? TABLE_CANVAS.portrait
    : compact
      ? TABLE_CANVAS.wideCompact
      : TABLE_CANVAS.wide;
  const canvasH = canvasW / geo.ratio;
  const scale = measured === null ? 1 : measured / canvasW;

  const boardSize = compact ? "sm" : "lg";

  const stage = showdown?.stage ?? null;
  const handLive = table?.state === 1;
  /** The room is doing invisible work, so its mark turns. */
  /**
   * What the line under the board will say, worked out here because the
   * mark's ring keys off it: any waiting-shaped status sets the ring turning.
   * The ring IS the loading indicator — the one motion for every wait, in
   * place of dots or spinners — so it runs for "waiting for players" and
   * "shuffling" exactly as it does for "dealing you in".
   */
  const fallbackLabel =
    status ?? (handLive && hand ? STREET_NAMES[hand.street] : "waiting");
  // Between hands the previous board is stale. It stays up through the
  // showdown, because that is what everyone is looking at, and clears once the
  // table is genuinely waiting for the next one.
  const showBoard = handLive || stage !== null;
  /*
   * The room is doing something invisible — but the mark only says so when
   * there is nothing else on the cloth to look at.
   *
   * Cashing out narrates itself as "finishing this hand", and that turned the
   * ring on and lifted the mark to its loud opacity behind a hand that was
   * still being played: the brightest thing on the felt, revolving, directly
   * under the board. Whatever the table is arranging in the background, cards
   * on the cloth outrank it. The status line still says what is happening;
   * the mark simply stops competing with the game for the player's eye.
   */
  const roomWorking =
    Boolean(overlay) ||
    (working && !handLive && stage === null) ||
    (stage === null && !handLive && isWaiting(fallbackLabel));
  const tableBusy = roomWorking && !showBoard;

  const board = showBoard
    ? (hand?.board ?? [NO_CARD, NO_CARD, NO_CARD, NO_CARD, NO_CARD])
    : [NO_CARD, NO_CARD, NO_CARD, NO_CARD, NO_CARD];
  const dealt = (i: number) => {
    if (!hand) return false;
    // Settlement clears the mask on chain, so through the showdown the cards
    // stay on the table on the strength of the copy taken while it was live.
    if (stage !== null) return ((showdown?.dealtIn ?? 0) & (1 << i)) !== 0;
    if (!handLive) return false;
    return (hand.dealtIn & (1 << i)) !== 0;
  };

  /**
   * Whose cards are face up.
   *
   * During the reveal beat only the seats turned over so far are shown, so the
   * hands arrive one at a time instead of all at once. Outside the sequence,
   * anything the chain says was revealed is shown, which is what a reload
   * mid-showdown needs.
   */
  const revealed = (i: number) => {
    if (!hand || !(hand.revealedMask & (1 << i))) return null;
    if (stage === "reveal" && showdown && !showdown.shown.has(i)) return null;
    return hand.revealed[i];
  };

  /**
   * Your own two cards.
   *
   * Settlement wipes the hole-card account, so from that moment the live copy
   * is blank and your hand would turn face down exactly when the showdown is
   * asking you to compare it. What the chain revealed stands in, which is the
   * same two cards, and it needs no stagger because you have been looking at
   * them all along.
   */
  const myCards = () => {
    const liveHole =
      myHoleHandNumber === hand?.handNumber && myHole && myHole[0] !== NO_CARD
        ? myHole
        : null;
    if (liveHole) return liveHole;
    if (!hand || !(hand.revealedMask & (1 << mySeat))) return null;
    return hand.revealed[mySeat];
  };

  // The comparison only lights up once every hand is face up. Highlighting the
  // winner while cards are still turning over gives the ending away.
  const comparing = stage === "compare" || stage === "award";
  const highlight = stage === null || comparing ? winning : undefined;
  const dimLosers = stage === null || comparing;

  // Every pile is drawn against the biggest stack at the table.
  const displayPot = stage !== null ? (showdown?.pot ?? 0) : pot;
  const awardBySeat = new Map((showdown?.awards ?? []).map((a) => [a.seat, a.amount]));
  /**
   * The pot as the felt draws it, which is not the same as what the pot holds
   * once it is being paid out: the chips are visibly leaving, so the pile and
   * the figure they are leaving have to come down with them rather than blink
   * out and leave the winner's chips arriving from nowhere.
   */
  const paying = stage === "award";
  const potShown = usePotPayingOut(displayPot, paying);

  return (
    <div
      ref={box}
      style={{
        position: "relative",
        width: "100%",
        maxWidth: geo.maxWidth,
        aspectRatio: geo.aspect,
        margin: "0 auto",
      }}
    >
      {/* The table's thickness: the same pill dropped a few pixels, the dark
          side wall a real table shows along its near edge. One element, and
          the flat drawing becomes an object seen from a chair's height. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: geo.ellipseInset,
          transform: "translateY(14px)",
          borderRadius: 999,
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--c-felt-rail) 70%, black) 60%, color-mix(in srgb, var(--c-felt-rail) 35%, black) 100%)",
          boxShadow: "0 26px 60px -12px rgba(0, 0, 0, 0.75)",
        }}
      />

      {/* The table, per the Superdesign "High Stakes Table" draft: a stadium
          with a broad near-black rail around deep green cloth — the one place
          the product stops being a dark UI and becomes a physical object. The
          999px radius clamps to half the short side, so the ends are true
          semicircles at any width: a pill, never a rounded rectangle. */}
      <div
        style={{
          position: "absolute",
          inset: geo.ellipseInset,
          borderRadius: 999,
          border: "12px solid var(--c-felt-rail)",
          // The cloth: lit from dead centre, falling to near-black at the rim,
          // with the draft's deep inset shadow pooling against the rail. The
          // faint bright line along the top of the inset is the rail's rim
          // catching the room light, which is what says "padded edge" rather
          // than "border".
          background:
            "radial-gradient(circle at center, var(--c-felt-cloth) 0%, var(--c-felt-cloth-deep) 100%)",
          boxShadow:
            "inset 0 6px 14px rgba(255, 255, 255, 0.05), inset 0 0 150px rgba(0, 0, 0, 0.8), 0 50px 100px -20px rgba(0, 0, 0, 0.5)",
          overflow: "hidden",
        }}
      >
        {/* The house mark, printed dead centre into the cloth the way the
            draft prints its brand there — low contrast, so cards and chips
            always beat it, and an empty table still says whose room this is.
            Inside the cloth's own box so the overflow clip keeps it on the
            felt.

            It is also the table's only loading indicator. While the table is
            doing something the player cannot see — securing cards, moving
            between layers, drawing randomness — the outer RING turns and
            brightens. The raccoon inside it stays a watermark throughout;
            only the ring answers, because only the ring means something.
            Working state used to be a raised card floating over the felt; a
            card over a table reads as an interruption, while the table's own
            print turning reads as the room quietly at work. */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: "26%",
            aspectRatio: "1",
            pointerEvents: "none",
          }}
        >
          {/*
            The ring is the table's only loading indicator, and it is drawn
            rather than borrowed from the art: the mark is an illustration with
            no circle in it to turn. Eight segments, the same geometry the chip
            mark used, so what a returning player recognises as "the room is
            working" is unchanged even though the thing inside the ring is not.

            Thinner and blurrier than it was: at 4 units it drew a hard dashed
            circle around the middle of the cloth that the eye kept returning
            to between actions; at 2.5, spread into the weave, it is a printed
            rule you only notice once it starts turning.

            It carries its OWN opacity rather than inheriting the mark's,
            because the two have different jobs. The raccoon is decoration and
            goes to a watermark everywhere. The ring is the only thing in this
            product that says the room is working, and if it dims with the art
            it stops being an indicator at all.

            Note when `tableBusy` can even be true: `roomWorking && !showBoard`.
            The loud state cannot coincide with cards on the cloth, so a ring
            that is legible while working is never a ring competing with a
            hand. During play it is at 0.03, which is weave.
          */}
          <svg
            viewBox="0 0 100 100"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              color: "var(--c-ink)",
              /*
               * Blended into the cloth, not drawn on it. Even at 0.3 the ring
               * was the brightest thing on an empty table and the eye parked
               * on it; a printed rule in felt is barely there, and MOTION is
               * what makes it readable when it matters. A turning shape at
               * 0.16 is noticed; the same shape standing still is weave.
               */
              opacity: tableBusy ? 0.16 : showBoard ? 0.02 : 0.05,
              filter: "blur(2px)",
              transition: "opacity 0.8s ease",
            }}
          >
            <circle
              className={tableBusy ? "mark-ring-turning" : undefined}
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeDasharray="22.2 13.9"
              strokeDashoffset="11.1"
            />
          </svg>
          {/*
            The mark itself, screened into the weave.

            Nearly all the colour is gone and the contrast is pulled in around
            the midtone, which is what turns a lit illustration into cloth
            print. Saturation alone was not enough: at 0.55 the purple and cyan
            rim light still picked the raccoon out of the green as a separate
            object, and the eye reads a face on a poker table whether or not it
            is faint. Grey, flattened and blurred, he is a watermark — the felt
            still says whose room this is, and nothing on the cloth competes
            with the cards.

            The opacities came down with it. He is never brighter than 0.11,
            which is below where the OLD mark sat when the table was merely
            idle: the illustration carries far more contrast than the flat chip
            it replaced, so the numbers that read as weave for that one read as
            a picture hung behind the board for this one.
          */}
          <img
            src="/logo-256.png"
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              inset: "16%",
              width: "68%",
              height: "68%",
              objectFit: "contain",
              opacity: tableBusy ? 0.08 : showBoard ? 0.015 : 0.045,
              transition: "opacity 0.8s ease",
              filter: "grayscale(0.95) saturate(0.4) contrast(0.55) blur(1.8px)",
              userSelect: "none",
            }}
          />
        </div>
      </div>

      {/* Everything that stands ON the table, drawn at canvas size and scaled
          as one object. The cloth and its rail above are percentages and were
          always fluid; it is the furniture that needed this. Held back for the
          single frame before the felt has been measured, so the table never
          appears at the wrong size and then jumps. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: canvasW,
          height: canvasH,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          visibility: measured === null ? "hidden" : undefined,
        }}
      >
        {/* Board and pot, centred. Absolute centring shrink-wraps to half the
            felt, so the column takes its content's width or the status line
            would fold under a small board. */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: geo.boardTop,
            transform: "translate(-50%, -50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: compact ? 10 : 12,
            width: "max-content",
            // Above the chair canvas: the pot, board and status are the game,
            // and no piece of furniture may stand in front of them.
            zIndex: 8,
          }}
        >
          {/* Settlement zeroes the live pot, so through the reveal and the
              comparison the figure comes from the snapshot taken just before
              it. During the award it counts down as the chips leave, because
              that is what a pot being paid out looks like.

              The row is ALWAYS here, at a fixed height, empty or not. It used
              to unmount when the pot emptied, and this column is centred on
              its own middle — so losing the row moved the board and the cards
              under it a dozen pixels up, every hand, exactly as the chips
              started flying. The jitter was the pot's own absence. */}
          <div
            style={{
              height: compact ? 22 : 30,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <AnimatePresence>
              {potShown > 0 && (
                <motion.div
                  key="pot"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={spring.snappy}
                  // The pot sits on the cloth, not in a box. It used to be a black
                  // pill — a container floating over a table full of containers —
                  // and the emphasis now comes from the money itself: the pile of
                  // real chips, and a figure set larger than anything else on the
                  // felt with the table's green light behind it. On cloth,
                  // emphasis is weight and light, not chrome.
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: compact ? 8 : 11,
                  }}
                >
                  <ChipStack
                    amount={potShown}
                    size={compact ? 14 : 18}
                    showAmount={false}
                  />
                  <span
                    className="num"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: compact ? 16 : 22,
                      fontWeight: 800,
                      color: "var(--c-green)",
                      textShadow:
                        "0 0 22px color-mix(in srgb, var(--c-green) 55%, transparent), 0 1px 2px rgba(0,0,0,0.6)",
                    }}
                  >
                    <AnimatedNumber value={potShown} duration={paying ? 900 : undefined} />
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* The slots only exist while there is a hand to hold. Between hands
              the mark stands alone on the cloth — five empty frames parked on
              top of it read as clutter, and while the table is working they sat
              exactly over the turning ring. A spacer holds their height so the
              pot and the status line never jump when the board arrives. */}
          {showBoard ? (
            <div style={{ display: "flex", gap: compact ? 4 : 6 }}>
              {board.map((card, i) => (
                <div key={i}>
                  {card === NO_CARD ? (
                    <CardSlot size={boardSize} />
                  ) : (
                    <motion.div
                      initial={{ opacity: 0, y: -14, rotateY: 180 }}
                      animate={{ opacity: 1, y: 0, rotateY: 0 }}
                      transition={{ ...spring.deal, delay: (i % 3) * stagger.board }}
                    >
                      <PlayingCard
                        card={card}
                        size={boardSize}
                        highlighted={highlight?.has(card)}
                      />
                    </motion.div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            // Taller than the board it stands in for, on purpose: the column is
            // centre-anchored, so this pushes the status line below the mark's
            // lower arc instead of across it while the ring turns.
            <div aria-hidden style={{ height: boardSize === "sm" ? 130 : 210 }} />
          )}

          <StatusLine
            stage={stage}
            busy={overlay}
            fallback={fallbackLabel}
            width={Math.min(460, canvasW * 0.82)}
            gap={compact ? 16 : 30}
          />
        </div>

        {/* Seats. */}
        {Array.from({ length: MAX_SEATS }, (_, i) => {
          const pos = geo.seats[view(i)];
          const isMe = i === mySeat;
          const cards = isMe ? myCards() : revealed(i);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${pos.x}%`,
                top: `${pos.y}%`,
                transform: "translate(-50%, -50%)",
                zIndex: hand?.toAct === i && handLive ? 12 : 10,
              }}
            >
              <SeatPod
                seat={seats[i]}
                index={i}
                isMe={isMe}
                isTurn={hand?.toAct === i && handLive}
                isButton={table?.button === i}
                dealtIn={dealt(i)}
                cards={cards}
                winning={highlight}
                dimmed={
                  dimLosers &&
                  winners !== undefined &&
                  winners.size > 0 &&
                  !winners.has(i) &&
                  dealt(i)
                }
                deadline={hand?.deadline ?? 0}
                timeoutSecs={timeoutSecs}
                handLive={handLive}
                // Only your own seat carries the indicator: it is a claim about
                // the cards you can read, not about anybody else's.
                secured={isMe ? secured : undefined}
                avatarOn={pos.x > 50 ? "left" : "right"}
                cardsOn={pos.y < 50 ? "below" : "above"}
                winner={awardBySeat.has(i)}
                compact={compact}
                onSit={onSit}
              />

              {/* What this hand actually was, named, while the table compares. */}
              <AnimatePresence>
                {comparing && handNames?.has(i) && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    style={{
                      position: "absolute",
                      left: "50%",
                      transform: "translateX(-50%)",
                      bottom: compact ? -24 : -30,
                      background: winners?.has(i) ? "var(--c-win)" : "var(--c-felt-edge)",
                      color: winners?.has(i) ? "var(--c-felt)" : "var(--c-ink)",
                      borderRadius: "var(--r-lg)",
                      fontFamily: "var(--font-display)",
                      fontSize: compact ? 9 : 10,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      padding: "4px 10px",
                      whiteSpace: "nowrap",
                      backdropFilter: "blur(8px)",
                    }}
                  >
                    {handNames.get(i)}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {/* Long operations no longer get a card over the felt: the mark's ring
            turning says the table is working, and the status line under the
            board says what at. Nothing floats over a table; the table itself
            tells the story. */}

        {/* Chips each seat has put in on this street, on their way to the pot. */}
        {stage === null &&
          Array.from({ length: MAX_SEATS }, (_, i) => {
            const seat = seats[i];
            if (!seat || seat.committedStreet <= 0) return null;
            const pos = geo.bets[view(i)];
            return (
              <motion.div
                key={`bet-${i}`}
                layoutId={`bet-${i}`}
                initial={{
                  left: `${geo.seats[view(i)].x}%`,
                  top: `${geo.seats[view(i)].y}%`,
                  opacity: 0,
                }}
                animate={{ left: `${pos.x}%`, top: `${pos.y}%`, opacity: 1 }}
                exit={{
                  left: `${geo.pot.x}%`,
                  top: `${geo.pot.y}%`,
                  opacity: 0,
                  scale: 0.6,
                }}
                transition={spring.snappy}
                style={{ position: "absolute", transform: "translate(-50%, -50%)", zIndex: 20 }}
              >
                <ChipStack
                  amount={seat.committedStreet}
                  size={compact ? 13 : 18}
                  compact
                  pill
                />
              </motion.div>
            );
          })}

        {/* The pot going home, chip by chip.
            A single pile sliding across the felt read as an icon moving; chips
            leaving the pot one after another and landing on the winner read as
            money being pushed to them, which is the moment being staged. Each
            chip fades as it lands — the winner's stack is counting up at the
            same time, so the chips are absorbed rather than piling on the
            avatar — and the figure arrives last, after the money. One stream
            per winner, so a split pot reads as a split. */}
        <AnimatePresence>
          {stage === "award" &&
            (showdown?.awards ?? []).flatMap((award, a) => {
              const pos = geo.seats[view(award.seat)];
              const from = { x: geo.pot.x, y: geo.pot.y };
              const coins = chipsFor(award.amount)
                .flatMap(({ count, token }) => Array.from({ length: count }, () => token))
                .slice(0, 10);
              const perChip = 0.09;
              return [
                ...coins.map((token, i) => {
                  // Deterministic scatter, so the stream has a little hand-flung
                  // looseness without a random number changing every render.
                  const dx = ((i * 53 + a * 29) % 17) - 8;
                  const dy = ((i * 31 + a * 41) % 11) - 5;
                  return (
                    <motion.div
                      key={`award-${award.seat}-chip-${i}`}
                      initial={{ left: `${from.x}%`, top: `${from.y}%`, opacity: 0 }}
                      animate={{
                        left: `${pos.x}%`,
                        top: `${pos.y}%`,
                        opacity: [0, 1, 1, 0],
                      }}
                      exit={{ opacity: 0 }}
                      transition={{
                        duration: 0.75,
                        delay: a * 0.2 + i * perChip,
                        times: [0, 0.2, 0.8, 1],
                        ease: "easeInOut",
                      }}
                      style={{
                        position: "absolute",
                        transform: "translate(-50%, -50%)",
                        zIndex: 30,
                        pointerEvents: "none",
                      }}
                    >
                      <div style={{ transform: `translate(${dx}px, ${dy}px)` }}>
                        <Coin size={compact ? 15 : 19} token={token} />
                      </div>
                    </motion.div>
                  );
                }),
                <motion.div
                  key={`award-${award.seat}-sum`}
                  initial={{ left: `${from.x}%`, top: `${from.y}%`, opacity: 0, scale: 0.8 }}
                  animate={{ left: `${pos.x}%`, top: `${pos.y}%`, opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{
                    type: "spring",
                    stiffness: 150,
                    damping: 20,
                    delay: a * 0.2 + coins.length * perChip * 0.6,
                  }}
                  style={{
                    position: "absolute",
                    transform: "translate(-50%, -50%)",
                    zIndex: 31,
                    pointerEvents: "none",
                  }}
                >
                  {/* Beside the player, never on them.
                      Centred on the seat, this printed straight across the
                      winner's face — the one figure in the hand somebody
                      actually wants to read, laid over the one thing that
                      identifies who read it. It steps clear to whichever side
                      has the felt: outward from the middle of the table, so
                      the end seats push their figure inward and it never
                      leaves the cloth. */}
                  <span
                    className="num"
                    style={{
                      display: "block",
                      // Far enough out to clear the circle itself: the figure
                      // is centred on this offset, so it has to cover the
                      // avatar's radius plus half its own width plus air.
                      // Level with the face, where the lane is clear — above
                      // it is the player's hand and below it is their name.
                      transform: `translate(${
                        (pos.x > 50 ? -1 : 1) * (compact ? 46 : 66)
                      }px, 0)`,
                      whiteSpace: "nowrap",
                      fontFamily: "var(--font-mono)",
                      fontSize: compact ? 15 : 19,
                      fontWeight: 800,
                      color: "var(--c-green)",
                      textShadow:
                        "0 0 20px color-mix(in srgb, var(--c-green) 55%, transparent), 0 1px 2px rgba(0,0,0,0.6)",
                    }}
                  >
                    +{award.amount.toLocaleString()}
                  </span>
                </motion.div>,
              ];
            })}
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * What the table is doing, in words, under the board.
 *
 * `busy` is a long operation narrating itself — the copy that used to sit in
 * a raised card over the middle of the felt. It lives here now, in the same
 * line everything else speaks through, set a little larger and breathing
 * while the mark's ring turns. One voice, one place, nothing floating.
 */
function StatusLine({
  stage,
  fallback,
  busy,
  width,
  gap,
}: {
  stage: ShowdownStage;
  fallback: string;
  busy?: string;
  /** How wide the line may run, in canvas pixels. */
  width: number;
  /** Clear air between the board and the line, in canvas pixels. */
  gap: number;
}) {
  const label =
    busy ??
    (stage === "reveal"
      ? "showing hands"
      : stage === "compare"
        ? "comparing"
        : stage === "award"
          ? "paying the winner"
          : fallback);

  /*
   * Printed into the cloth exactly the way the mark above it is: the same
   * ink, a steady low opacity, a breath of blur spreading the edges into the
   * weave. Nothing animates here — the words hold still like lettering
   * screened onto a real table, and the mark's turning ring alone says the
   * room is working. Bold and widely tracked, because that is how cloth
   * lettering is actually set.
   *
   * The showdown moments keep their green: "paying the winner" is an event,
   * not upholstery.
   */
  const stageMoment = !busy && stage !== null;

  /*
   * Long sentences leave the cloth.
   *
   * This was set `nowrap` at 0.3em tracking, so anything past a few words ran
   * straight off the felt and was clipped by the rail — "next hand has not
   * started, so try reloading, or pause the table" arrived as "...pause the
   * TA". Lettering screened onto a table can wrap; it cannot run off the edge.
   *
   * Three lengths, three treatments. A short label keeps the wide tracking it
   * was designed for. A medium one tightens slightly and is allowed a second
   * line. Anything longer is not upholstery at all — it is a sentence asking
   * the player to do something, and it goes to a toast where it can be read at
   * a readable width, leaving a short stand-in on the felt.
   */
  const LONG = 56;
  const MEDIUM = 18;
  const tooLong = label.length > LONG;
  const shown = tooLong ? "something needs a look" : label;

  // Fired once per distinct message, not once per render.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (tooLong && announced.current !== label) {
      announced.current = label;
      toast(label, "info");
    }
    if (!tooLong) announced.current = null;
  }, [tooLong, label]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 18,
        marginTop: gap,
        /*
         * Sized against the felt, not against the board column above it.
         *
         * A percentage here resolved against the centre column, which is only
         * as wide as five cards, so "waiting for players" broke across two
         * lines and read as a mistake rather than a caption. The line belongs
         * to the table, so it is measured against the table: wide enough for
         * an ordinary label to stay on one line, and still well inside the
         * rail on the narrowest phone.
         *
         * In canvas pixels, not vw. The table is scaled as a whole now, so a
         * viewport unit in here would be read at the screen's scale and the
         * felt's at the canvas's — the line would size itself against a
         * different table from the one it is printed on.
         */
        width,
        marginLeft: "auto",
        marginRight: "auto",
      }}
    >
      <AnimatePresence mode="wait">
        <motion.span
          key={shown}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: stageMoment ? 0.6 : 0.34, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.25 }}
          style={{
            fontFamily: "var(--font-display)",
            fontSize: busy ? 16 : 14,
            fontWeight: 800,
            color: stageMoment ? "var(--c-green)" : "var(--c-ink)",
            textTransform: "uppercase",
            letterSpacing: shown.length > MEDIUM ? "0.16em" : "0.3em",
            filter: "blur(0.5px)",
            textAlign: "center",
            // Two lines at most; a third would reach the board.
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            lineHeight: 1.5,
          }}
        >
          {shown}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

const SETTLED_LABELS = new Set(["preflop", "flop", "turn", "river", "showdown"]);
const isWaiting = (label: string) => !SETTLED_LABELS.has(label);

/** How long the pile takes to empty, against the chips crossing the felt. */
const PAYOUT_DRAIN_MS = 900;

/**
 * The pot emptying, as a number the pile can be drawn from.
 *
 * While chips are flying to the winner the pot is visibly being paid, so it
 * has to visibly shrink — both the printed figure and the physical stack
 * beside it, which is drawn from the same value. Outside the payout this is
 * simply the pot.
 */
function usePotPayingOut(pot: number, paying: boolean): number {
  const [shown, setShown] = useState(pot);
  const frame = useRef<number | undefined>(undefined);
  const from = useRef(pot);

  useEffect(() => {
    if (!paying) {
      from.current = pot;
      setShown(pot);
      return;
    }
    const a = from.current;
    if (a <= 0) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / PAYOUT_DRAIN_MS);
      // Ease out: the pile empties quickly and the last chips linger, which is
      // how a dealer actually pushes a pot.
      setShown(Math.round(a * (1 - (1 - Math.pow(1 - t, 3)))));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [paying, pot]);

  return shown;
}
