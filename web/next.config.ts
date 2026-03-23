import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Help Next.js treat most data as effectively static for a day.
    staleTimes: {
      dynamic: 86400,
      static: 86400,
    },
    // Tree-shake large icon and chart libraries so only used exports are bundled.
    optimizePackageImports: ["recharts", "lucide-react"],
  },
  images: {
    // Spotify CDN assets are already sized reasonably; skipping the Image
    // Optimization API avoids Vercel "Image Transformations" quota on Hobby.
    unoptimized: true,
    // Cache optimized images for a full day.
    minimumCacheTTL: 86400,
    remotePatterns: [
      // Spotify uses multiple CDN hostnames for images; allow wildcard subdomains.
      { protocol: "https", hostname: "**.scdn.co" },
      { protocol: "https", hostname: "**.spotifycdn.com" },
    ],
  },
};

export default nextConfig;
