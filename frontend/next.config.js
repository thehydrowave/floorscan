/** @type {import('next').NextConfig} */
const RAILWAY_BACKEND = "https://floorscan-production.up.railway.app";
const LOCAL_BACKEND   = "http://localhost:8000";

const nextConfig = {
  reactStrictMode: false,
  // Proxy /api/backend/* → Railway (prod) or localhost (dev)
  // This eliminates CORS: the browser only calls the same origin.
  async rewrites() {
    const dest = process.env.NODE_ENV === "development"
      ? `${LOCAL_BACKEND}/:path*`
      : `${RAILWAY_BACKEND}/:path*`;
    return [{ source: "/api/backend/:path*", destination: dest }];
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
