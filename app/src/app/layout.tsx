import type { Metadata, Viewport } from "next";
import { Dela_Gothic_One, Poppins } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { Providers } from "./providers";

// Two voices, as the design spec uses them: a heavy display face for anything
// that is a name or a number on the table, and Poppins for ordinary interface
// text. Dela Gothic One ships a single weight, which is the point of it.
const dela = Dela_Gothic_One({
  subsets: ["latin"],
  variable: "--font-dela",
  weight: "400",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  variable: "--font-poppins",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pokerable",
  description:
    "Play poker with SOL. Real-time six-max Texas Hold'em on Solana: buy chips, play, cash out. Provably fair shuffle, TEE-protected hole cards.",
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
    <html lang="en" className={`${dela.variable} ${poppins.variable}`}>
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
