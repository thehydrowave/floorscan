/** @type {import('next').NextConfig} */
// build: 2026-03-15
const RENDER_BACKEND = "https://floorscan-backend.onrender.com";

const nextConfig = {
  reactStrictMode: false,
  // Proxy /api/backend/* → Render backend (eliminates CORS entirely)
  async rewrites() {
    return [
      {
        source: "/api/backend/:path*",
        destination: `${RENDER_BACKEND}/:path*`,
      },
    ];
  },
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
