import type { NextConfig } from "next";
import path from "path";

const apiOrigin =
  process.env.INTERNAL_API_ORIGIN?.replace(/\/$/, "") ??
  process.env.INTERNAL_API_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:3001";

const nextConfig: NextConfig = {
  output: 'standalone',
  reactCompiler: true,
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiOrigin}/api/:path*`,
        destination: `${apiOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
