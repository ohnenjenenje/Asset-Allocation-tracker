import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  productionBrowserSourceMaps: false,
  serverExternalPackages: ['ccxt'],
  experimental: {
    webpackBuildWorker: false,
    memoryBasedWorkersCount: true,
  }
};

export default nextConfig;
