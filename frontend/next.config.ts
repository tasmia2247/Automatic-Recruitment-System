import type { NextConfig } from 'next';

// Browser calls /api/* on the same origin; Next proxies them to the NestJS API so the
// httpOnly auth cookie works without CORS.
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
