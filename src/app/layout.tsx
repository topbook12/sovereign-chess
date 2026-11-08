import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";

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
  ],
  authors: [{ name: "Sovereign Chess" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Sovereign — Play, Analyze & Master Chess",
    description:
      "Play a ruthless chess AI, decode your games with grandmaster-grade reports, and train with puzzles, drills and openings.",
    siteName: "Sovereign Chess",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0b0e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
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
        <Toaster />
        <Sonner position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
