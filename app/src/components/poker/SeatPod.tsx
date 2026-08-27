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
   * Which rail this seat sits at. The empty chair turns so its back faces
   * away from the table, the way a real chair waits at its rail.
   */
  side?: "bottom" | "top" | "left" | "right";
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
  side = "bottom",
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
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
        }}
      >
        {/* An open seat is an actual chair waiting at the rail, its back
            turned away from the table. The green plus on the cushion is the
            whole invitation. */}
        <Chair size={d.avatar + (compact ? 16 : 30)} side={side} />
        <span
          className="label"
          style={{
            fontSize: d.nameFont,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "rgba(255, 255, 255, 0.4)",
            padding: "2px 8px",
            borderRadius: "var(--r-pill)",
            background: "rgba(0, 0, 0, 0.4)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
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

/** How the chair turns so its back faces away from the table. */
const CHAIR_TURN = { bottom: 0, top: 180, left: 90, right: -90 } as const;

/**
 * The empty chair, seen from above: a leather horseshoe of backrest and
 * armrests wrapped around a round cushion, standing in its own pool of
 * shadow. Drawn with the back at the bottom — the pose of a chair on the
 * near rail — and turned to face whichever rail it actually waits at.
 *
 * The materials are deliberate. The horseshoe takes its light along the top
 * edge the way upholstery catches the room's light; the cushion is darker
 * where a body would sit and carries a stitched seam; the green plus in the
 * middle is the only interface object on it, and the only invitation needed.
 */
function Chair({ size, side }: { size: number; side: "bottom" | "top" | "left" | "right" }) {
  // The horseshoe of backrest and armrests, reused by every layer below so
  // the side wall, the upholstery and the light all follow one geometry.
  const HS = "M 20 32 L 20 66 C 20 100, 100 100, 100 66 L 100 32";
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 120 120"
      style={{ transform: `rotate(${CHAIR_TURN[side]}deg)`, display: "block" }}
    >
      <defs>
        {/* A seat is a hollow, not a dome: deepest in the middle where a
            body sinks it, rising to a rim that catches the room's light.
            The gradient runs dark-centre to lit-edge for exactly that
            reason — the other way round it read as bulging up. */}
        <radialGradient id="chair-cushion" cx="50%" cy="48%" r="72%">
          <stop offset="0%" stopColor="color-mix(in srgb, var(--c-chair-cushion) 68%, #000)" />
          <stop offset="55%" stopColor="color-mix(in srgb, var(--c-chair-cushion) 86%, #000)" />
          <stop offset="88%" stopColor="var(--c-chair-cushion)" />
          <stop offset="100%" stopColor="color-mix(in srgb, var(--c-ink) 10%, var(--c-chair-cushion))" />
        </radialGradient>
        <linearGradient id="chair-back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="color-mix(in srgb, var(--c-ink) 18%, var(--c-chair-back))" />
          <stop offset="45%" stopColor="var(--c-chair-back)" />
          <stop offset="100%" stopColor="color-mix(in srgb, var(--c-chair-back) 70%, #000)" />
        </linearGradient>
        <radialGradient id="chair-armcap" cx="38%" cy="32%" r="80%">
          <stop offset="0%" stopColor="color-mix(in srgb, var(--c-ink) 22%, var(--c-chair-back))" />
          <stop offset="100%" stopColor="color-mix(in srgb, var(--c-chair-back) 80%, #000)" />
        </radialGradient>
        <filter id="chair-ground" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <filter id="chair-ground-tight" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
      </defs>

      {/* Two shadows ground it: a wide soft pool, and a tighter dark one
          right under the frame. One blur alone floats. */}
      <ellipse cx="60" cy="70" rx="48" ry="34" fill="rgba(0,0,0,0.45)" filter="url(#chair-ground)" />
      <ellipse cx="60" cy="66" rx="38" ry="26" fill="rgba(0,0,0,0.5)" filter="url(#chair-ground-tight)" />

      {/* The seat FIRST, so the backrest lands on top of it and the cushion
          reads as tucked into the frame — drawn the other way round, the
          sitting surface floated above its own chair. A sofa cushion, not a
          disc: a rounded square that runs to the arms with no gap. */}
      <rect x="25" y="21" width="70" height="66" rx="22" fill="color-mix(in srgb, #000 55%, var(--c-chair-cushion))" />
      <rect x="25" y="16" width="70" height="66" rx="22" fill="url(#chair-cushion)" stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
      {/* Overhead light on a recess: shadow under its near lip, light on the
          far one. The dark band along the top edge is what sinks the seat. */}
      <path d="M 36 21 L 84 21" stroke="rgba(0,0,0,0.40)" strokeWidth="8" strokeLinecap="round" />
      <path d="M 40 78 L 80 78" stroke="rgba(255,255,255,0.07)" strokeWidth="5" strokeLinecap="round" />
      {/* The stitched seam, inset the way upholstery is. */}
      <rect x="32" y="25" width="56" height="45" rx="15" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1.4" strokeDasharray="3.2 4.2" />

      {/* The frame over the cushion, bottom up: its own side wall, the
          upholstery, a seam of shadow under the crown, the crown's light.
          Each layer is the same horseshoe shifted by height. */}
      <path d={HS} fill="none" stroke="color-mix(in srgb, #000 55%, var(--c-chair-back))" strokeWidth="19" strokeLinecap="round" transform="translate(0 6)" />
      <path d={HS} fill="none" stroke="url(#chair-back)" strokeWidth="19" strokeLinecap="round" />
      <path d={HS} fill="none" stroke="rgba(0,0,0,0.32)" strokeWidth="7" strokeLinecap="round" transform="translate(0 3.4)" />
      <path d={HS} fill="none" stroke="color-mix(in srgb, var(--c-ink) 17%, transparent)" strokeWidth="4.5" strokeLinecap="round" transform="translate(0 -5)" />

      {/* The shadow the backrest throws onto the seat it wraps. */}
      <path
        d="M 29 64 C 29 88, 91 88, 91 64"
        fill="none"
        stroke="rgba(0,0,0,0.30)"
        strokeWidth="6"
        strokeLinecap="round"
      />

      {/* Armrest pads, each catching the light on its forward shoulder. */}
      <circle cx="20" cy="32" r="10" fill="url(#chair-armcap)" />
      <circle cx="100" cy="32" r="10" fill="url(#chair-armcap)" />
      <ellipse cx="17.5" cy="29" rx="4" ry="3" fill="rgba(255,255,255,0.14)" />
      <ellipse cx="97.5" cy="29" rx="4" ry="3" fill="rgba(255,255,255,0.14)" />

      {/* The invitation. A plus is symmetric, so it survives every turn of
          the chair without a counter-rotation. */}
      <g stroke="var(--c-green)" strokeWidth="4" strokeLinecap="round">
        <path d="M 60 39 L 60 55" />
        <path d="M 52 47 L 68 47" />
      </g>
    </svg>
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
