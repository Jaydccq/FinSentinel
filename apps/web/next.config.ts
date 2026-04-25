import type { NextConfig } from 'next';
import path from 'path';

const isTauri = process.env.NEXT_PUBLIC_TAURI === '1';

const apiOrigin =
  process.env.INTERNAL_API_ORIGIN?.replace(/\/$/, '') ??
  process.env.INTERNAL_API_BASE_URL?.replace(/\/$/, '') ??
  'http://localhost:3001';

const nextConfig: NextConfig = {
  output: isTauri ? 'export' : 'standalone',
  reactCompiler: true,
  images: isTauri ? { unoptimized: true } : undefined,
  turbopack: {
    root: path.join(__dirname, '../..'),
  },
  // rewrites() are incompatible with `output: 'export'`.
  // In Tauri builds we use NEXT_PUBLIC_API_BASE_URL at runtime instead.
  ...(isTauri
    ? {}
    : {
        async rewrites() {
          return [
            {
              source: '/api/:path*',
              destination: `${apiOrigin}/api/:path*`,
            },
          ];
        },
      }),
};

export default nextConfig;
