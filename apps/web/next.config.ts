import type { NextConfig } from 'next';
import path from 'node:path';
import { loadWebConfig } from '@digital-autograph/config';

loadWebConfig();

const nextConfig: NextConfig = {
  agentRules: false,
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  transpilePackages: [
    '@digital-autograph/config',
    '@digital-autograph/contracts',
    '@digital-autograph/ui',
  ],
};

export default nextConfig;
