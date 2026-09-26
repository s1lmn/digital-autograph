import type { NextConfig } from 'next';
import { loadWebConfig } from '@digital-autograph/config';

loadWebConfig();

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: [
    '@digital-autograph/config',
    '@digital-autograph/contracts',
    '@digital-autograph/ui',
  ],
};

export default nextConfig;
