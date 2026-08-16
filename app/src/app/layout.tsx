import type { Metadata, Viewport } from "next";
import { Dela_Gothic_One, Poppins } from "next/font/google";
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
  title: "SolPoker",
  description:
    "Real-time Texas Hold'em on Solana. Buy chips with SOL, play, sell back. Provably fair shuffle, TEE-protected hole cards.",
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
      </body>
    </html>
  );
}
