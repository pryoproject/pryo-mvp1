import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@pryo/domain", "@pryo/scoring", "@pryo/crawler", "@pryo/audit-engine"]
};

export default nextConfig;
