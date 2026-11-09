import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { PwaProvider } from "@/components/pwa/pwa-provider";
import { InstallPromptDialog } from "@/components/pwa/install-prompt-dialog";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Sovereign — Play, Analyze & Master Chess",
  applicationName: "Sovereign",
  description:
    "The world's most premium chess learning platform: full-rules play against a ruthless AI, grandmaster-style game reports with move classification & accuracy, tactics puzzles, endgame drills and interactive opening lessons — in a royal emerald & gold arena.",
  keywords: [
    "chess",
    "chess game",
    "AI chess",
    "premium chess",
    "chess analysis",
    "chess puzzles",
    "learn chess",
    "play chess online",
    "chess pwa",
    "offline chess",
  ],
  authors: [{ name: "Sovereign Chess" }],
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Sovereign",
  },
  formatDetection: { telephone: false },
  openGraph: {
    title: "Sovereign — Play, Analyze & Master Chess",
    description:
      "Play a ruthless chess AI, decode your games with grandmaster-grade reports, and train with puzzles, drills and openings — installable, works offline.",
    siteName: "Sovereign Chess",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0b0e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // a game board must never pinch-zoom or double-tap-zoom mid-duel
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <PwaProvider />
        <InstallPromptDialog />
        <Toaster />
        <Sonner position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
