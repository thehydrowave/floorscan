/** @type {import('next').NextConfig} */
// build: 2026-03-15
const nextConfig = {
  reactStrictMode: false,
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.alias = { ...config.resolve.alias, canvas: false };
    }
    config.module.rules.push({ test: /pdf\.worker(\.min)?\.js$/, type: "asset/resource" });
    config.resolve.symlinks = false;
    return config;
  },
};
module.exports = nextConfig;
