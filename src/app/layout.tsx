import type { Metadata, Viewport } from "next";
import "./globals.css";

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
  themeColor: "#0f766e",
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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
