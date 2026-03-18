import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { NavBar } from "@/components/layout/nav-bar";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Breadloaf Hill | Family Hub",
  description: "The family hub for Breadloaf Hill — your Vermont property home base for documents, photos, smart home, and more.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#2d5a27",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} antialiased`}>
        <main className="min-h-screen pb-20">
          {children}
        </main>
        <NavBar />
      </body>
    </html>
  );
}
