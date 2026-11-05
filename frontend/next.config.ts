import type { NextConfig } from 'next';

// Browser calls /api/* on the same origin; Next proxies them to the NestJS API so the
// httpOnly auth cookie works without CORS.
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  experimental: {
    // The /api proxy forwards only 10 MB of a request by default, which cut CV and mail folder uploads short. The
    // pages also send uploads in batches below UPLOAD_BATCH_BYTES (lib/api.ts), so this is headroom, not the plan.
    proxyClientMaxBodySize: '100mb',
  },
  poweredByHeader: false,
  // Security headers for the pages (security test, 2026-11-05); /api responses get the same from the API itself.
  // SAMEORIGIN, not DENY: the job post page shows the circular PDF in a frame.
  async headers() {
    return [{
      source: '/((?!api/).*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
