"use client";

import { AnimatePresence, motion } from "motion/react";
import { Avatar, shortKey } from "@/components/primitives/Avatar";
import { AnimatedNumber } from "@/components/primitives/AnimatedNumber";
import { CARD_HEIGHT, PlayingCard } from "@/components/primitives/PlayingCard";
import { ClockRing } from "@/components/primitives/ClockRing";
import { PrivacyRing } from "@/components/primitives/ChipRing";
import { spring } from "@/styles/theme";
import type { SeatView } from "@/stores/table-store";
import { NO_CARD } from "@/lib/engine/cards";

/**
 * A seat, drawn the way the Superdesign "High Stakes Table" draft draws one:
 * a circular avatar in a dark ring, the name in a small pill overlapping its
 * bottom edge, and the stack in a black pill underneath. Your own seat runs a
 * green ring with a glow, and while it is your turn the name pill turns into
 * the draft's solid green YOUR TURN badge.
 *
 * The old two-band plate carried the same facts in a 220px bar; the column
 * carries them in half the width, which is what lets the table read as a
 * table instead of a dashboard.
 *
 * An empty seat is a dashed circular outline with a green plus — the same
 * invitation as before, in the new geometry.
 */

const DIMS = {
  full: {
    avatar: 60,
    avatarMe: 72,
    ring: 4,
    nameFont: 10,
    stackFont: 12,
    tagFont: 9,
    overlap: 9,
  },
  compact: {
    avatar: 36,
    avatarMe: 42,
    ring: 3,
    nameFont: 8,
    stackFont: 10,
    tagFont: 8,
    overlap: 7,
  },
} as const;

interface Props {
  seat: SeatView | null;
  index: number;
  isMe: boolean;
  isTurn: boolean;
  isButton: boolean;
  dealtIn: boolean;
  /** Face-up cards: yours always, others only once shown at showdown. */
  cards: number[] | null;
  /** Winning cards to highlight, by card byte. */
  winning?: Set<number>;
  dimmed?: boolean;
  deadline: number;
  timeoutSecs: number;
  /** A hand is actually running, so per-hand labels mean something. */
  handLive?: boolean;
  /**
   * Whether this seat's TEE permission is confirmed. Only ever passed for your
   * own seat: it is a statement about the cards you can read, not about
   * anybody else's.
   */
  secured?: boolean;
  /** Which end the avatar sat at on the old plate. Kept for the dealer button side. */
  avatarOn?: "left" | "right";
  /**
   * Which side the cards sit on. Seats along the top of the table lay their
   * cards toward the felt, or the cards would run off the top of the screen.
   */
  cardsOn?: "above" | "below";
  /** This seat just won something, so the seat celebrates briefly. */
  winner?: boolean;
  /** The phone-sized seat. */
  compact?: boolean;
  onSit?: (index: number) => void;
}

export function SeatPod({
  seat,
  index,
  isMe,
  isTurn,
  isButton,
  dealtIn,
  cards,
  winning,
  dimmed,
  deadline,
  timeoutSecs,
  handLive = false,
  secured,
  avatarOn = "left",
  cardsOn = "above",
  winner = false,
  compact = false,
  onSit,
}: Props) {
  const d = DIMS[compact ? "compact" : "full"];
  const empty = !seat?.occupant;
  const size = isMe ? d.avatarMe : d.avatar;
  /** The space this seat's hand occupies, held open whether or not it holds one. */
  const cardSize: "sm" | "md" = isMe && !compact ? "md" : "sm";
  const cardHeight = CARD_HEIGHT[cardSize];

  if (empty) {
    /*
     * Seats along the top of the table hang their label ABOVE the plate.
     * Below it, the pill lands on the rail and reads as a caption printed on
     * the felt rather than as this seat's own invitation — and at the top
     * corners it collided with the table's edge outright. `cardsOn` already
     * knows which half of the room a seat is in, so it decides this too.
     */
    const labelAbove = cardsOn === "below";
    const plate = d.avatar + (compact ? 4 : 10);
    return (
      <motion.button
        onClick={() => onSit?.(index)}
        className={onSit ? "seat-open" : "seat-open is-quiet"}
        // The seat shows a silhouette and a verb, which is right on the table
        // but says nothing on its own. The name is what a screen reader
        // announces and what the browser tests click.
        aria-label={`Seat ${index + 1}`}
        whileHover={onSit ? { scale: 1.05 } : undefined}
        whileTap={onSit ? { scale: 0.97 } : undefined}
        transition={spring.snappy}
        style={{
          border: "none",
          background: "none",
          /*
           * Invisible room around the plate, so the chair stays a fingertip.
           *
           * The felt is scaled as one object, which scales this button with
           * it: a 40px compact plate on a phone-sized table lands at 34 real
           * pixels, well under the 44px floor. The padding is drawn from
           * nothing and costs nothing — the pod is centred as a column, so the
           * plate does not move — and it keeps the hit area over the floor at
           * every scale the table is drawn at.
           */
          padding: compact ? 12 : 8,
          cursor: onSit ? "pointer" : "default",
          display: "flex",
          flexDirection: labelAbove ? "column-reverse" : "column",
          alignItems: "center",
          position: "relative",
        }}
      >
        <span
          className="seat-plate"
          aria-hidden
          style={{ width: plate, height: plate }}
        >
          <span className="seat-plate-ring" />
          {/* The player who is not here yet, in the same circle every seated
              player occupies — so a full seat and an empty one are plainly
              the same kind of thing. */}
          <svg viewBox="0 0 48 48" className="seat-ghost">
            <circle cx="24" cy="17.5" r="8" fill="currentColor" />
            <path
              d="M 8.5 42 C 8.5 31.5, 15.5 27.5, 24 27.5 C 32.5 27.5, 39.5 31.5, 39.5 42 Z"
              fill="currentColor"
            />
          </svg>
        </span>
        {/* One quiet word.

            An empty seat does not need to be sold. Instructions were tried
            here — "sit · 3", then "sit here" — and both shouted at a player
            who is looking at a poker table and can already see which chairs
            are free. "Open" states the fact and gets out of the way; the
            seat's own hover, and the pointer, say the rest. Set in the felt's
            own ink rather than the brand's green, so six free chairs read as
            a calm room instead of six buttons.

            The seat number lives in the aria-label, where it is useful,
            rather than on the felt, where position already identifies the
            chair. */}
        <span
          className="seat-cta"
          style={{
            fontSize: d.nameFont,
            padding: compact ? "2px 9px" : "3px 12px",
            // Clean air, not the pill's old overlap: without a background to
            // tuck under the plate's edge, a negative margin just lands the
            // word on the silhouette.
            marginTop: labelAbove ? 0 : compact ? 4 : 6,
            marginBottom: labelAbove ? (compact ? 4 : 6) : 0,
          }}
        >
          open
        </span>
      </motion.button>
    );
  }

  const s = seat!;
  const sittingOut = handLive && !dealtIn;
  // The avatar overlay states, straight from the draft's folded seat.
  const overlay = s.folded
    ? { label: "folded", color: "var(--c-ink-muted)" }
    : s.allIn
      ? { label: "all in", color: "var(--c-warn)" }
      : null;

  const namePill =
    isMe && isTurn ? (
      // The draft's YOUR TURN badge: solid green, black text, no ambiguity.
      <span
        className="label"
        style={{
          fontSize: d.nameFont,
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--c-felt)",
          background: "var(--c-green)",
          padding: compact ? "2px 8px" : "3px 12px",
          borderRadius: "var(--r-pill)",
          whiteSpace: "nowrap",
        }}
      >
        your turn
      </span>
    ) : (
      <span
        style={{
          fontSize: d.nameFont,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: sittingOut
            ? "var(--c-ink-faint)"
            : isMe
              ? "var(--c-green)"
              : "var(--c-ink)",
          background: "var(--c-felt-raised)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          padding: compact ? "1px 7px" : "2px 10px",
          borderRadius: "var(--r-pill)",
          whiteSpace: "nowrap",
          maxWidth: size + 46,
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontFamily: isMe || sittingOut ? undefined : "var(--font-mono)",
        }}
      >
        {sittingOut ? "sitting out" : isMe ? "you" : shortKey(s.occupant!)}
      </span>
    );

  const avatar = (
    <div style={{ position: "relative", width: size, height: size }}>
      {/* The circle: the draft's dark ring, or your green one with its glow.
          The countdown ring replaces the border while this seat is to act. */}
      {isTurn ? (
        <ClockRing
          deadline={deadline}
          totalSecs={timeoutSecs}
          size={size}
          thickness={compact ? 2.5 : 3.5}
        >
          <CircleAvatar pubkey={s.occupant!} size={size - (compact ? 10 : 14)} />
        </ClockRing>
      ) : (
        <span
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            // A folded seat keeps its ring but loses its voice: your own green
            // circle and its glow are for the player still in the hand.
            border: `${d.ring}px solid ${
              s.folded
                ? "var(--c-card-back)"
                : isMe
                  ? "var(--c-green)"
                  : "var(--c-card-back)"
            }`,
            boxShadow:
              isMe && !s.folded
                ? "0 0 20px rgba(20, 241, 149, 0.3)"
                : "0 8px 20px rgba(0, 0, 0, 0.45)",
            display: "grid",
            placeItems: "center",
            background: "var(--c-felt-raised)",
            // The picture goes quiet rather than being covered up. Colour
            // draining out of a seat is the oldest way a table shows somebody
            // is out of the hand, and it needs no words at all.
            filter: s.folded ? "grayscale(1) brightness(0.65)" : undefined,
            transition: "filter 260ms ease",
          }}
        >
          <CircleAvatar pubkey={s.occupant!} size={size - d.ring * 2} />
        </span>
      )}

      {/*
        Out of the hand, said the way a card room says it.
        This used to be a black disc dropped over the player's face with the
        word in loss-red across it — the loudest treatment on the table given
        to its least eventful event. Folding is not a loss and not an error; it
        is simply no longer being in the hand. So the picture desaturates, and
        a single band crosses it carrying the word in the felt's own ink, the
        way a mucked hand gets a line through it. Two cues, no colour alone,
        and the player's identity stays legible underneath.

        All-in keeps its warning colour: that one IS an event.
      */}
      {overlay && (
        <span
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            overflow: "hidden",
            display: "grid",
            placeItems: "center",
            zIndex: 2,
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              display: "grid",
              placeItems: "center",
              padding: compact ? "2px 0" : "3px 0",
              background: "rgba(0, 0, 0, 0.66)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 0 rgba(255,255,255,0.06)",
            }}
          >
            <span
              className="label"
              style={{
                fontSize: d.tagFont,
                fontWeight: 800,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: overlay.color,
                whiteSpace: "nowrap",
              }}
            >
              {overlay.label}
            </span>
          </span>
        </span>
      )}

      {isButton && (
        <DealerButton on={avatarOn === "left" ? "right" : "left"} small={compact} />
      )}
    </div>
  );

  return (
    <motion.div
      /*
       * Deliberately NOT `layout`.
       *
       * A hand ending unmounts two cards from the top of this column, and with
       * layout animation on, framer implements the resulting height change by
       * scaling the whole subtree and easing it back — so every seat's avatar
       * and name visibly squashed and stretched at the end of every hand, then
       * settled. That is the "weird animation" and it was never a design, just
       * a side effect. The pod is absolutely positioned by the felt, so it has
       * nothing to gain from layout animation; the cards below reserve their
       * own space instead, and nothing moves at all.
       */
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: dimmed || s.folded ? 0.55 : 1, scale: isTurn ? 1.03 : 1 }}
      transition={spring.snappy}
      style={{
        display: "flex",
        flexDirection: cardsOn === "below" ? "column-reverse" : "column",
        alignItems: "center",
        position: "relative",
      }}
    >
      {/* Cards, fanned over the seat's top edge. Centred on the column now
          that nothing stands proud of one end.

          The height is reserved whether or not a hand is out. It used to
          collapse to nothing between hands, which moved the avatar, the name
          and the stack of every seat up and down the felt twice a hand — the
          table breathing in and out around a game nobody had moved. A chair at
          a real table does not shuffle backwards when the cards are collected. */}
      <div
        style={{
          display: "flex",
          gap: 3,
          height: cardHeight,
          alignItems: "flex-end",
          marginBottom: cardsOn === "above" ? (compact ? -8 : -10) : 0,
          marginTop: cardsOn === "below" ? (compact ? -6 : -8) : 0,
          zIndex: 0,
        }}
      >
        <AnimatePresence>
          {dealtIn &&
            [0, 1].map((i) => {
              const card = cards?.[i];
              const known = card !== undefined && card !== NO_CARD;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: -28, scale: 0.7 }}
                  animate={{ opacity: 1, y: 0, scale: 1, rotate: i === 0 ? -5 : 5 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ ...spring.deal, delay: i * 0.06 }}
                >
                  <PlayingCard
                    card={known ? card : undefined}
                    faceDown={!known}
                    size={cardSize}
                    highlighted={known && winning?.has(card)}
                    dimmed={dimmed || s.folded}
                  />
                </motion.div>
              );
            })}
        </AnimatePresence>
      </div>

      {/*
        The privacy indicator, and the third and last job of the chip ring.
        It sits beside your own hand because that is exactly what it makes a
        claim about — solid and green when this seat's permission is confirmed,
        hollow when it is not.

        The wording is held to the line the trust page takes. "Cards secured"
        is the whole claim: the hole cards are hardware-protected, not
        cryptographically guaranteed, and the interface must not say more than
        the docs do.
      */}
      {isMe && secured !== undefined && !compact && (
        // The row holds its height whether or not it is saying anything, for
        // the same reason the cards above it do: this sits between your hand
        // and your avatar, so letting it come and go with the deal moved your
        // own seat up and down the felt every hand.
        <div
          style={{
            height: 22,
            marginBottom: cardsOn === "above" ? 4 : 0,
            marginTop: cardsOn === "below" ? 4 : 0,
            position: "relative",
            zIndex: 3,
            display: "grid",
            placeItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              // The claim is about cards you are holding, so it says nothing
              // between hands — but it keeps its place while it is quiet.
              opacity: dealtIn ? 1 : 0,
              transition: "opacity 220ms ease",
              // Its own dark pill, like every other label here: bare green text
              // vanished the day the cards turned white.
              padding: "2px 8px",
              borderRadius: "var(--r-pill)",
              background: "rgba(0, 0, 0, 0.6)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
            }}
          >
            <PrivacyRing secured={!!secured} size={13} />
            <span
              className="label"
              style={{
                fontSize: 10,
                letterSpacing: "0.08em",
                color: secured ? "var(--c-green)" : "var(--c-ink-faint)",
              }}
            >
              {secured ? "Cards secured" : "Not secured"}
            </span>
          </div>
        </div>
      )}

      <motion.div
        animate={{
          scale: winner ? [1, 1.06, 1] : 1,
          // The seat lifts off the cloth while it is to act. Second cue: the
          // depleting ring is the first, and neither is a colour.
          y: isTurn ? -4 : 0,
        }}
        transition={winner ? { duration: 0.6, times: [0, 0.4, 1] } : spring.snappy}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          zIndex: 1,
          position: "relative",
          // A stacking context ALWAYS, not only while animating. The chair
          // below sits at z -1, and without this it fell behind the page the
          // moment framer reset the idle transform — a chair visible only
          // while its seat was moving.
          isolation: "isolate",
          filter: winner
            ? "drop-shadow(0 0 14px color-mix(in srgb, var(--c-win) 30%, transparent))"
            : undefined,
        }}
      >
        {avatar}
        {/* The name, overlapping the circle's bottom edge as the draft sets
            it, then the stack in its black pill. */}
        <div style={{ marginTop: -d.overlap, zIndex: 3, display: "grid", placeItems: "center" }}>
          {namePill}
        </div>
        <span
          className="num"
          style={{
            marginTop: 4,
            fontFamily: "var(--font-mono)",
            fontSize: d.stackFont,
            fontWeight: 700,
            color: s.stack === 0 ? "var(--c-loss)" : "var(--c-green)",
            background: "rgba(0, 0, 0, 0.5)",
            border: isMe
              ? "1px solid color-mix(in srgb, var(--c-green) 20%, transparent)"
              : "1px solid rgba(255, 255, 255, 0.08)",
            padding: compact ? "1px 8px" : "2px 12px",
            borderRadius: "var(--r-pill)",
            whiteSpace: "nowrap",
          }}
        >
          {s.stack === 0 ? "no chips" : <AnimatedNumber value={s.stack} />}
        </span>
      </motion.div>
    </motion.div>
  );
}

/** The Avatar squircle, clipped to the draft's circle. */
function CircleAvatar({ pubkey, size }: { pubkey: string; size: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        display: "grid",
        placeItems: "center",
      }}
    >
      <Avatar pubkey={pubkey} size={size} square />
    </span>
  );
}

function DealerButton({ on, small = false }: { on: "left" | "right"; small?: boolean }) {
  const size = small ? 16 : 22;
  return (
    <motion.div
      layoutId="dealer-button"
      transition={spring.gentle}
      style={{
        position: "absolute",
        [on]: small ? -6 : -8,
        // High on the circle's shoulder, clear of the name pill that overlaps
        // the bottom edge.
        top: small ? -2 : -2,
        width: size,
        height: size,
        borderRadius: "50%",
        // A real dealer button is white plastic, exactly as the draft draws
        // it, with the same soft drop shadow.
        background: "var(--c-card-face)",
        color: "var(--c-card-black)",
        fontSize: small ? 9 : 10,
        fontWeight: 900,
        display: "grid",
        placeItems: "center",
        boxShadow: "0 2px 4px rgba(0, 0, 0, 0.5)",
        zIndex: 3,
      }}
    >
      D
    </motion.div>
  );
}
