import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // The shadcn registry index, served at the root as the directory spec expects.
      { source: "/registry.json", destination: "/r/registry.json" },
    ];
  },
};

export default nextConfig;
