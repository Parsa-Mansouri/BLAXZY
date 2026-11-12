import type { Metadata, Viewport } from "next";
import { Courier_Prime, Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./_components/providers";
import "./globals.css";

// Geist for the whole interface.
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

// Geist Mono only for technical values: timecodes, durations, credits, shortcuts, file names
// (the kit's <Mono>, <Kbd> and `mono-value`). Status lines are Geist.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

// Courier Prime for screenplay text on the paper sheet. Not preloaded: only script pages use it.
const courierPrime = Courier_Prime({
  variable: "--font-courier-prime",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "BLAXZY",
  description: "Make a film from an idea or a script, one guided stage at a time.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${courierPrime.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
