import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";

// STATIC_EXPORT=1 builds plain files for the Cloudflare Worker, which answers /api itself.
const nextConfig: NextConfig = process.env.STATIC_EXPORT
  ? { output: "export", devIndicators: false }
  : {
      devIndicators: false,
      // the store AI can take most of a minute to answer; the dev proxy's 30 s default cut it off
      experimental: { proxyTimeout: 120_000 },
      async rewrites() {
        return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
      },
    };

export default nextConfig;
