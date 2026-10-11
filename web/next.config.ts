import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /docs reads the migration inventory outside web/ at request time.
  outputFileTracingIncludes: {
    "/docs": ["../supabase/migrations/*.sql"],
  },
  experimental: {
    // Keep revisits warm; successful mutations refresh or revalidate the router.
    staleTimes: {
      dynamic: 180,
      // Full Link prefetches use the static TTL even for dynamic pages.
      static: 180,
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
