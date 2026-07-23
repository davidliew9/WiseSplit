import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-outfit"
});

export const metadata: Metadata = {
  title: "WiseSplit",
  description: "A private household expense splitter for roommates",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "WiseSplit",
    statusBarStyle: "default"
  }
};

export const viewport: Viewport = {
  themeColor: "#17211D",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={outfit.variable}>
      <body>{children}</body>
    </html>
  );
}
