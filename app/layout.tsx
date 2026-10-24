import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { PreviewProvider } from "./components/Preview";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Google Fonts ships Geist upright only; without this face italics are synthesised.
// Not preloaded: the browser fetches it only when a note actually has italic text.
const geistItalic = localFont({
  src: "../node_modules/geist/dist/fonts/geist-sans/Geist-Italic[wght].woff2",
  variable: "--font-geist-italic",
  style: "italic",
  weight: "100 900",
  preload: false,
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
    icon: [{ url: "/icon.svg?v=3", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon?v=3" }],
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
    // Font variables sit on <html> so the :root type tokens in globals.css can resolve them.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistItalic.variable} ${geistMono.variable}`}
    >
      <head>
        <link rel="alternate" type="text/plain" href="/llms.txt" />
      </head>
      <body className="antialiased"><PreviewProvider preview={process.env.VERCEL_ENV === "preview"}>{children}</PreviewProvider></body>
    </html>
  );
}
