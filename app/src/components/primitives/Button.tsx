"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChipSpinner } from "./ChipRing";
import { spring } from "@/styles/theme";

/**
 * Every button in the room, in one place.
 *
 * There were four parallel button styles before this: this one, a private
 * variant map inside the action bar that was a verbatim copy with a different
 * height, a `LabelButton` in the lobby, and the wallet adapter's own. They
 * disagreed on height (30 through 52), on radius, and on which of them owned
 * the gradient. The extra variants below exist so the other three can be
 * deleted rather than re-invented.
 *
 * On colour: green is the affirmative, so it carries the primary action inside
 * the room. The purple-to-green gradient now has a variant too — `gradient` —
 * but it is rationed rather than free: ONE per screen, and it means "the thing
 * you probably want". On a poker table that is a bet, never a fold.
 */
type Variant = "primary" | "ghost" | "danger" | "quiet" | "sol" | "gradient";
type Size = "sm" | "md" | "lg" | "xl";

const VARIANTS: Record<Variant, React.CSSProperties> = {
  // Green on felt-dark ink. Green is this product's affirmative colour, and it
  // is safe at any size (12.92:1 on felt).
  primary: {
    background: "var(--c-green)",
    color: "var(--c-felt)",
    fontWeight: 700,
    boxShadow: "var(--e-raised)",
  },
  // A raised surface, not an outlined box: depth here is rim-light, because a
  // drop shadow is nearly invisible on #0B0E14.
  ghost: {
    background: "var(--c-felt-raised)",
    color: "var(--c-ink)",
    border: "1px solid var(--c-rule)",
    boxShadow: "var(--e-raised)",
  },
  danger: {
    background: "var(--c-loss)",
    color: "var(--c-felt)",
    fontWeight: 600,
  },
  quiet: {
    background: "transparent",
    color: "var(--c-ink-muted)",
  },
  /*
   * For the one or two places that are about the chain rather than about
   * money. Purple does the job it is allowed to do — a fill and a border —
   * and the label uses --c-purple-text, because #9945FF is 4.28:1 on felt and
   * fails AA for anything under 24px.
   */
  sol: {
    background: "color-mix(in srgb, var(--c-purple) 18%, transparent)",
    color: "var(--c-purple-text)",
    border: "1px solid color-mix(in srgb, var(--c-purple) 55%, transparent)",
    fontWeight: 700,
  },
  /*
   * The identity, as a fill. One per screen.
   *
   * The label is black rather than white and the weight is not adjustable:
   * black on the purple end of this gradient measures ~4.8:1, which passes AA
   * but has no margin left over. At 600 or lighter it fails, and a lighter
   * label is the obvious-looking "refinement" that would break it silently.
   *
   * The shimmer sweep and the resting glow come from .cta-gradient in
   * globals.css, which also gates both behind a fine pointer and drops them
   * under prefers-reduced-motion.
   */
  gradient: {
    color: "#000",
    fontWeight: 700,
  },
};

/*
 * Heights. Anything a thumb has to find is at or above --touch-target (44px);
 * `sm` is for dense desktop chrome only, and globals.css raises it to the full
 * target on any coarse pointer, so a phone never gets a 32px tap area.
 */
const SIZES: Record<Size, React.CSSProperties> = {
  sm: { height: 32, padding: "0 var(--sp-3)", fontSize: "var(--t-body-sm-size)" },
  md: {
    height: 40,
    minHeight: 40,
    padding: "0 18px",
    fontSize: "var(--t-body-size)",
  },
  lg: {
    height: "var(--touch-target)",
    minHeight: "var(--touch-target)",
    padding: "0 26px",
    fontSize: "var(--t-body-lg-size)",
  },
  // Thumb-sized, for the action bar: the one row where a mis-tap costs chips.
  xl: {
    height: 52,
    minHeight: "var(--touch-target)",
    padding: "0 26px",
    fontSize: "var(--t-body-lg-size)",
  },
};

/**
 * A button that navigates renders as a LINK, not as a button inside one.
 *
 * Wrapping this component in `<Link>` produces `<a><button>`, which is invalid
 * HTML — an anchor may not contain interactive content — and React 19 reports
 * it. The real cost is not the warning: nested interactives give one control
 * two tab stops, and a screen reader announces it as a link that contains a
 * button. Pass `href` and get a single correct element instead.
 */
const MotionLink = motion.create(Link);

interface Props {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  title?: string;
  style?: React.CSSProperties;
  className?: string;
  type?: "button" | "submit";
  /**
   * Renders an anchor instead of a button. `onClick` still fires alongside
   * navigation — the sheet's CTA needs it to close the menu on the way out.
   */
  href?: string;
}

export function Button({
  children,
  onClick,
  variant = "ghost",
  size = "md",
  disabled = false,
  loading = false,
  fullWidth = false,
  title,
  style,
  className,
  type = "button",
  href,
}: Props) {
  const reduce = useReducedMotion();
  const off = disabled || loading;

  // The gradient fill, its resting glow and its shimmer all live in CSS so they
  // can be gated behind a fine pointer and dropped under reduced motion —
  // neither of which an inline style can express.
  const cls = [variant === "gradient" ? "cta-gradient" : null, className]
    .filter(Boolean)
    .join(" ");

  const shared = {
    title,
    className: cls || undefined,
    // The press must answer immediately, before anything reaches the chain.
    whileTap: off || reduce ? undefined : { scale: 0.97 },
    whileHover: off || reduce ? undefined : { y: -1 },
    transition: spring.snappy,
    style: {
      ...SIZES[size],
      ...VARIANTS[variant],
      width: fullWidth ? "100%" : undefined,
      borderRadius: "var(--r-md)",
      border: VARIANTS[variant].border ?? "1px solid transparent",
      cursor: off ? "not-allowed" : "pointer",
      opacity: off ? 0.45 : 1,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "var(--sp-2)",
      whiteSpace: "nowrap",
      fontFamily: "var(--font-body)",
      textDecoration: "none",
      transition: "opacity var(--m-fast) var(--m-ease), background var(--m-fast) var(--m-ease)",
      ...style,
    } as React.CSSProperties,
  };

  const inner = (
    <>
      {/* The chip ring, not a generic spinner. There are none in this product. */}
      {loading && <ChipSpinner size={14} thickness={2} color="currentColor" />}
      {children}
    </>
  );

  if (href) {
    // A disabled link is not a thing the platform has; the honest equivalent
    // is a real button that does nothing, so the state stays announced.
    if (off) {
      return (
        <motion.button {...shared} type="button" disabled aria-disabled>
          {inner}
        </motion.button>
      );
    }
    return (
      <MotionLink {...shared} href={href} onClick={onClick}>
        {inner}
      </MotionLink>
    );
  }

  return (
    <motion.button
      {...shared}
      type={type}
      onClick={off ? undefined : onClick}
      disabled={off}
    >
      {inner}
    </motion.button>
  );
}
