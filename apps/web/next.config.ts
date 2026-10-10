import type { NextConfig } from 'next';
import path from 'node:path';
import { loadWebConfig } from '@digital-autograph/config';

loadWebConfig();

const nextConfig: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        {
          key: 'Content-Security-Policy',
          value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
        },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    },
  ],
  output: 'standalone',
  outputFileTracingExcludes: { '*': ['../../docs/legal/**/*'] },
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  transpilePackages: [
    '@digital-autograph/config',
    '@digital-autograph/contracts',
    '@digital-autograph/ui',
  ],
};

export default nextConfig;
