import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";

// STATIC_EXPORT=1 builds plain files for the Cloudflare Worker, which answers /api itself.
const nextConfig: NextConfig = process.env.STATIC_EXPORT
  ? { output: "export", devIndicators: false }
  : {
      devIndicators: false,
      async rewrites() {
        return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
      },
    };

export default nextConfig;
