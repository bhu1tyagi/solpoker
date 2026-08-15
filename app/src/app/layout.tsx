import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// One typeface, many weights. Headings and big numerals lean on the heavy end
// rather than on a second font.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SolPoker",
  description:
    "Real-time Texas Hold'em on Solana. Buy chips with SOL, play, sell back. Provably fair shuffle, TEE-protected hole cards.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
