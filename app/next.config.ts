import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The attestation check pulls @phala/dcap-qvl, which is CJS and stubs out node
  // built-ins for browsers. Keeping it server-side means it never has to bundle.
  serverExternalPackages: [
    "@phala/dcap-qvl",
    "@magicblock-labs/ephemeral-rollups-sdk",
  ],
  webpack: (config) => {
    // web3.js v1 and its deps reference node built-ins that the browser does not
    // need. Without this they resolve to nothing and the build fails.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      os: false,
      crypto: false,
    };
    return config;
  },
};

export default nextConfig;
