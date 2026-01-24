import type { Metadata } from "next";
import Link from "next/link";
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
  title: "SpotiBase",
  description: "Automated daily Spotify stream tracking from SpotOnTrack exports",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50`}
      >
        <div className="min-h-dvh">
          <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
            <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
              <Link href="/" className="font-semibold tracking-tight">
                SpotiBase
              </Link>
              <nav className="flex items-center gap-4 text-sm">
                <Link className="hover:underline" href="/">
                  Dashboard
                </Link>
                <Link className="hover:underline" href="/playlists">
                  Playlists
                </Link>
                <Link className="hover:underline" href="/health">
                  System Health
                </Link>
              </nav>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
          <footer className="mx-auto w-full max-w-6xl px-4 pb-10 pt-2 text-xs text-zinc-500">
            Data source: SpotOnTrack exports • Updated daily via GitHub Actions
          </footer>
        </div>
      </body>
    </html>
  );
}
