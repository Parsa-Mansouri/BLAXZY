import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Providers } from "./_components/providers";
import "./globals.css";

// Inter only stands in where San Francisco is not installed (the system stack comes first).
// The optical-size axis gives it SF's Text/Display split: tighter, finer letters at large sizes.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
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
    <html lang="en" className={inter.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
