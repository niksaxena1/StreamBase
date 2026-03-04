import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { TopRouteLoadingBar } from "@/components/shell/TopRouteLoadingBar";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  // Cover the entire screen including notch/safe areas
  viewportFit: "cover",
  // Ensure visual viewport resizes (not overlays) when keyboard/UI appears
  interactiveWidget: "resizes-visual",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Favicon: default for browsers that don't support media on link */}
        <link rel="icon" href="/favicon-dark.ico" type="image/x-icon" />
        {/* Favicon per color scheme (browser/OS light or dark mode) */}
        <link rel="icon" href="/favicon-light.ico" type="image/x-icon" media="(prefers-color-scheme: light)" />
        <link rel="icon" href="/favicon-dark.ico" type="image/x-icon" media="(prefers-color-scheme: dark)" />
        {/* Theme initialization script - runs synchronously before hydration to prevent flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                const STORAGE_KEY = "sb-theme";
                try {
                  const stored = localStorage.getItem(STORAGE_KEY);
                  const theme = (stored === "light" || stored === "dark") ? stored : "dark";
                  document.documentElement.dataset.theme = theme;
                } catch {
                  // ignore errors (e.g., in private browsing)
                  document.documentElement.dataset.theme = "dark";
                }
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${geistMono.variable} ${spaceGrotesk.variable} antialiased`}
      >
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[9999] focus:rounded-lg focus:bg-black focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-lg focus:outline-none dark:focus:bg-white dark:focus:text-black"
        >
          Skip to main content
        </a>
        <TopRouteLoadingBar />
        {children}
      </body>
    </html>
  );
}
