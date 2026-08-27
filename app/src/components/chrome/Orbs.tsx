/**
 * The ambient ground: one purple glow bleeding in from the top left, one
 * green from the right. This is the atmosphere the whole site shares — it
 * began as landing-page markup, which is why every other page sat on a flat
 * black field while the homepage glowed.
 *
 * Server component, pure markup. It must live directly inside a `.landing`
 * main (position: relative, overflow-x: clip) and before the content, and it
 * never intercepts a pointer.
 */
export function Orbs() {
  return (
    <div className="landing-orbs" aria-hidden>
      <span className="orb orb-purple" />
      <span className="orb orb-green" />
    </div>
  );
}
