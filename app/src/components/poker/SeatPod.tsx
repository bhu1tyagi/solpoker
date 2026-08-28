"use client";

import { AnimatePresence, motion } from "motion/react";
import { Avatar, shortKey } from "@/components/primitives/Avatar";
import { AnimatedNumber } from "@/components/primitives/AnimatedNumber";
import { PlayingCard } from "@/components/primitives/PlayingCard";
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
  /**
   * Which slot of the rotated ring this seat renders in (0 = the hero seat at
   * the bottom centre). Decides which chair photograph stands here, how big,
   * and under which light.
   */
  anchor?: number;
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
  anchor = 0,
  winner = false,
  compact = false,
  onSit,
}: Props) {
  const d = DIMS[compact ? "compact" : "full"];
  const empty = !seat?.occupant;
  const size = isMe ? d.avatarMe : d.avatar;

  if (empty) {
    return (
      <motion.button
        onClick={() => onSit?.(index)}
        // The seat shows a plus and a number, which is right on the table but
        // says nothing on its own. The name is what a screen reader announces
        // and what the browser tests click.
        aria-label={`Seat ${index + 1}`}
        whileHover={onSit ? { scale: 1.05 } : undefined}
        whileTap={onSit ? { scale: 0.97 } : undefined}
        transition={spring.snappy}
        style={{
          border: "none",
          background: "none",
          padding: 0,
          cursor: onSit ? "pointer" : "default",
          display: "block",
          position: "relative",
        }}
      >
        {/* An open seat is the chair itself, waiting. The label hangs OUTSIDE
            the layout box: counted in, it pushed every chair half a label off
            its anchor and the table read lopsided. */}
        <SeatChair anchor={anchor} width={d.avatar + (compact ? 54 : 108)} />
        {/* The invitation: the one interface object on an empty chair. */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            top: "54%",
            transform: "translate(-50%, -50%)",
            width: compact ? 18 : 24,
            height: compact ? 18 : 24,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background: "rgba(0, 0, 0, 0.45)",
            border: "1px solid color-mix(in srgb, var(--c-green) 45%, transparent)",
            color: "var(--c-green)",
            fontSize: compact ? 13 : 16,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          +
        </span>
        <span
          className="label"
          style={{
            position: "absolute",
            top: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            marginTop: 2,
            fontSize: d.nameFont,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "rgba(255, 255, 255, 0.4)",
            padding: "2px 8px",
            borderRadius: "var(--r-pill)",
            background: "rgba(0, 0, 0, 0.4)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            whiteSpace: "nowrap",
          }}
        >
          open · {index + 1}
        </span>
      </motion.button>
    );
  }

  const s = seat!;
  const sittingOut = handLive && !dealtIn;
  // The avatar overlay states, straight from the draft's folded seat.
  const overlay = s.folded
    ? { label: "folded", color: "var(--c-loss)" }
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
            border: `${d.ring}px solid ${isMe ? "var(--c-green)" : "var(--c-card-back)"}`,
            boxShadow: isMe
              ? "0 0 20px rgba(20, 241, 149, 0.3)"
              : "0 8px 20px rgba(0, 0, 0, 0.45)",
            display: "grid",
            placeItems: "center",
            background: "var(--c-felt-raised)",
          }}
        >
          <CircleAvatar pubkey={s.occupant!} size={size - d.ring * 2} />
        </span>
      )}

      {/* Folded and all-in wash over the picture, as the draft does it. */}
      {overlay && (
        <span
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: "rgba(0, 0, 0, 0.6)",
            display: "grid",
            placeItems: "center",
            zIndex: 2,
          }}
        >
          <span
            className="label"
            style={{
              fontSize: d.tagFont,
              fontWeight: 800,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: overlay.color,
            }}
          >
            {overlay.label}
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
      layout
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
          that nothing stands proud of one end. */}
      <div
        style={{
          display: "flex",
          gap: 3,
          height: dealtIn ? undefined : 0,
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
                    size={isMe && !compact ? "md" : "sm"}
                    highlighted={known && winning?.has(card)}
                    dimmed={dimmed}
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
      {isMe && dealtIn && secured !== undefined && !compact && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            marginBottom: cardsOn === "above" ? 4 : 0,
            marginTop: cardsOn === "below" ? 4 : 0,
            // Positioned, or the z-index is ignored and the cards land on top
            // of the words. Its own dark pill, like every other label here:
            // bare green text vanished the day the cards turned white.
            position: "relative",
            zIndex: 3,
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
        {/* The chair this player is sitting in, behind them. Yours is the one
            seen from directly behind, so the room reads as looking over your
            own shoulder at the table. */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            top: anchor === 0 ? (compact ? 0 : -4) : compact ? -12 : -18,
            transform: "translateX(-50%)",
            zIndex: -1,
          }}
        >
          <SeatChair
            anchor={anchor}
            width={size + (anchor === 0 ? (compact ? 92 : 170) : compact ? 50 : 90)}
          />
        </div>
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

/**
 * The chair, photographed: the same green Chesterfield rendered from four
 * angles, matted out, and placed per seat so every chair faces the felt.
 *
 * The realism is layered on in the room rather than baked into the pictures:
 *
 *   depth    seats farther up the screen render smaller, the way the far
 *            side of a real table is farther from your eyes;
 *   light    the room's light falls from the centre of the table, so far
 *            chairs are lit a touch brighter than near ones, and the hero's
 *            back — closest to the viewer, facing away from the light — sits
 *            darkest;
 *   ground   every chair stands in its own pool of soft shadow, which is
 *            what keeps a photograph from floating over a drawing.
 */
const CHAIR_VIEWS = [
  { src: "/seats/chair-rear.png", flip: false, depth: 1.16, light: 0.86 },
  { src: "/seats/chair-rear34.png", flip: false, depth: 1.0, light: 0.8 },
  { src: "/seats/chair-front34.png", flip: false, depth: 0.86, light: 0.92 },
  { src: "/seats/chair-front.png", flip: false, depth: 0.84, light: 0.95 },
  { src: "/seats/chair-front34.png", flip: true, depth: 0.86, light: 0.92 },
  { src: "/seats/chair-rear34.png", flip: true, depth: 1.0, light: 0.8 },
] as const;

function SeatChair({ anchor, width }: { anchor: number; width: number }) {
  const view = CHAIR_VIEWS[anchor] ?? CHAIR_VIEWS[0];
  const w = Math.round(width * view.depth);
  return (
    <span style={{ display: "block", position: "relative", width: w }}>
      {/* The pool of shadow the chair stands in. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          bottom: -Math.round(w * 0.045),
          transform: "translateX(-50%)",
          width: w * 1.06,
          height: Math.round(w * 0.3),
          borderRadius: "50%",
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 45%, transparent 70%)",
        }}
      />
      <img
        src={view.src}
        alt=""
        aria-hidden
        draggable={false}
        style={{
          width: w,
          maxWidth: "none",
          height: "auto",
          display: "block",
          position: "relative",
          transform: view.flip ? "scaleX(-1)" : undefined,
          filter: `brightness(${view.light}) saturate(0.94) drop-shadow(0 ${Math.round(w * 0.05)}px ${Math.round(w * 0.1)}px rgba(0, 0, 0, 0.5))`,
          pointerEvents: "none",
          userSelect: "none",
        }}
      />
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
