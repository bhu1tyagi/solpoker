import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { COLOR } from "@/design/tokens";
import "./globals.css";
import { Providers } from "./providers";

// Three faces, and no fourth. The design system names them in tokens.ts as
// FONT.display / FONT.body / FONT.mono; these are the loaded instances, bound
// to those tokens in globals.css.
//
// Space Grotesk carries the wordmark, the headings, and every amount. Money in
// the display face is a deliberate reversal of the previous rule, which set
// amounts in a mono face because the old display face — Dela Gothic One — had
// no tabular figures, so the `tnum` request on it silently did nothing and the
// pot, the stacks and the bet field each re-measured themselves as they ticked.
// Space Grotesk does carry a `tnum` feature (checked in the shipped Google
// subset, not assumed), so the amounts can be a headline and still hold their
// column. Anything that counts must still ask for it: see `.num` in globals.
const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

// The interface. Neutral on purpose — the display face carries the personality.
const body = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Chain data only: addresses, seeds, hashes, signatures, program IDs. Not money.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pokerable",
  description:
    "Play poker with stablecoins. Real-time six-max Texas Hold'em on Solana: deposit USDC, play, cash out. Provably fair shuffle, TEE-protected hole cards.",
};

// cover lets the room paint behind the notch and home bar; the HUD then keeps
// itself out of those areas with safe-area insets rather than a letterbox.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The felt itself, so the browser chrome continues the table rather than
  // framing it. Read from the token so it cannot drift from the ground colour.
  themeColor: COLOR.felt,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
        {/*
          Page views, from the /next entry point rather than /react: it reads
          route changes out of next/navigation, so a client-side move between
          the lobby and a table counts as a view.

          Rendered only when Vercel is actually serving. A production build run
          anywhere else — `next start` locally, which is what the page-load
          check drives — still injected the script tag, got a 404 for it, and
          logged a console error, which is exactly what that check fails on.
          The comment here used to claim it stayed quiet off Vercel; it did not.

          It sees URLs, not players. A table id is in the path, and a wallet
          address is never in one. Nothing here touches the cards, the shuffle,
          or anything the trust page makes a claim about.
        */}
        {process.env.VERCEL_ENV ? <Analytics /> : null}
      </body>
    </html>
  );
}
