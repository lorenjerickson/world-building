import type { NextConfig } from "next";
import path from "node:path";

const additionalDevelopmentOrigins =
  process.env.NEXT_ALLOWED_DEV_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Next protects development assets from cross-origin requests. Device testing
  // reaches this server by its LAN address rather than the implicitly trusted
  // localhost origin, so explicitly admit the current development host. The env
  // list keeps this usable when the host name or DHCP address changes.
  allowedDevOrigins: [
    "192.168.50.221",
    "MacBookPro.local",
    ...additionalDevelopmentOrigins,
  ],
  transpilePackages: ["@world-building/common"],
  turbopack: {
    // This only controls module resolution. Next still loads env files from
    // the application directory (apps/frontend), not from this workspace root.
    root: path.resolve(__dirname, "../.."),
  },
};

export default nextConfig;
