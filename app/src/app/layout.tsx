import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { COLOR } from "@/design/tokens";
import "./globals.css";
import { Providers } from "./providers";

// Three faces, and no fourth. The design system names them in tokens.ts as
// FONT.display / FONT.body / FONT.mono; these are the loaded instances, bound
// to those tokens in globals.css.
//
// Archivo carries headings, h1 and h2, and it is loaded WITH its width axis:
// the brand direction wants headings that spend more space horizontally than
// vertically, and globals.css sets font-stretch on them to use that axis.
// Requesting the axis here is what makes font-stretch real — without `axes`,
// next/font ships the default-width cut and the stretch silently synthesises.
//
// Money still does not follow the display face. It is pinned to Satoshi via
// --font-num, because tabular figures were verified there and a heading face
// can change with the brand; see tokens.ts FONT.num.
const display = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

// The interface, and everything below h2. Self-hosted rather than pulled from
// api.fontshare.com: a third-party stylesheet on the critical path defeats the
// preloading and CLS protection next/font exists to provide.
const satoshi = localFont({
  src: [
    { path: "../fonts/Satoshi-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/Satoshi-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/Satoshi-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-satoshi",
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
      className={`${display.variable} ${satoshi.variable} ${mono.variable}`}
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
