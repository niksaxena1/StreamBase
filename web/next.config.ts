import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Help Next.js treat most data as effectively static for a day.
    staleTimes: {
      dynamic: 86400,
      static: 86400,
    },
  },
  images: {
    // Cache optimized images for a full day.
    minimumCacheTTL: 86400,
    remotePatterns: [
      { protocol: "https", hostname: "i.scdn.co" },
    ],
  },
};

export default nextConfig;
