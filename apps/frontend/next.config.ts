import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  turbopack: {
    // This only controls module resolution. Next still loads env files from
    // the application directory (apps/frontend), not from this workspace root.
    root: path.resolve(__dirname, "../.."),
  },
};

export default nextConfig;
