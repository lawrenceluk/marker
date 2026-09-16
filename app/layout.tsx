import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Absolute icon/OG URLs for crawlers; without this, unfurls can keep a stale
  // or relative favicon from an older deploy.
  metadataBase: new URL("https://marker.luk.xyz"),
  title: "Marker",
  // Description and Open Graph live in `generateMetadata` on the page so a
  // persist URL can override them with the note prefix. Search: stay out.
  icons: {
    icon: [{ url: "/icon.svg?v=4", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon?v=4" }],
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      "max-snippet": -1,
      "max-image-preview": "none",
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
