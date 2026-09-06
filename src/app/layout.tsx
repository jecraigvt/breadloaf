import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "./field-guide.css";
import { NavBar } from "@/components/layout/nav-bar";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Breadloaf Hill | Family Hub",
  description: "A family record of the house at 3995 Vermont Route 125 — Ripton, Addison County.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2c4c35",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${instrumentSerif.variable} ${instrumentSans.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased">
        <a href="#main-content" className="fg-skip-link">Skip to content</a>
        <div className="stage">
          <div className="shell">
            <main id="main-content" className="site-content" tabIndex={-1}>{children}</main>
            <NavBar />
          </div>
        </div>
      </body>
    </html>
  );
}
