/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  serverExternalPackages: ["better-sqlite3"],
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
