import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // User-specific dataset/access/settings routes must never remain in the
    // client router cache after a mutation. Daily analytics are cached at the
    // query layer with explicit dataset/snapshot keys instead.
    staleTimes: {
      dynamic: 0,
      static: 86400,
    },
    // Tree-shake large icon and chart libraries so only used exports are bundled.
    optimizePackageImports: ["recharts", "lucide-react"],
  },
  images: {
    // Spotify CDN assets are already sized reasonably; skipping the Image
    // Optimization API avoids Vercel "Image Transformations" quota on Hobby.
    // Note: with the optimizer disabled, options like minimumCacheTTL have no
    // effect, so none are set here.
    unoptimized: true,
    remotePatterns: [
      // Spotify uses multiple CDN hostnames for images; allow wildcard subdomains.
      { protocol: "https", hostname: "**.scdn.co" },
      { protocol: "https", hostname: "**.spotifycdn.com" },
    ],
  },
};

export default nextConfig;
