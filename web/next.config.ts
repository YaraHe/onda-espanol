import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  agentRules: false,
  ...(process.env.NODE_ENV === "development" && process.env.S4_TEST_ALLOWED_DEV_ORIGIN
    ? {
      allowedDevOrigins: [process.env.S4_TEST_ALLOWED_DEV_ORIGIN],
      distDir: process.env.S4_TEST_NEXT_DIST_DIR ?? ".next/s4test-proxy",
    }
    : {}),
};

export default nextConfig;
