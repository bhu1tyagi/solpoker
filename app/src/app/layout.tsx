import type { Metadata, Viewport } from "next";
import {
  Bricolage_Grotesque,
  Dela_Gothic_One,
  IBM_Plex_Mono,
  Instrument_Sans,
} from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { Providers } from "./providers";

// Three voices, and the third is the one that matters most here.
//
// Bricolage Grotesque carries the name and the headings: a grotesque with
// enough width and weight to hold a wordmark, without the novelty of the
// single-weight display face it replaces. Instrument Sans is the interface.
//
// And every amount is set in IBM Plex Mono. This is not a stylistic choice.
// Amounts were previously set in the display face wearing a `tnum` class, and
// that face has no tabular figures — so the request silently did nothing, and
// the pot, the stacks and the bet field, the three numbers that change most
// often, each re-measured themselves as they ticked. In a mono face even
// columns are the default rather than a request that can be ignored.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

// The name keeps its own face. Dela Gothic One is the wordmark and only the
// wordmark — a logo is a drawing of a word, and redrawing it because the rest
// of the type system moved is how a brand quietly stops being recognisable.
const wordmark = Dela_Gothic_One({
  subsets: ["latin"],
  variable: "--font-dela",
  weight: "400",
  display: "swap",
});

const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
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
  themeColor: "#131f25",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${wordmark.variable} ${sans.variable} ${mono.variable}`}
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
