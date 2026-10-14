import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "export",
  basePath: process.env.CODE_SERVER_BASE_PATH || undefined,
  allowedDevOrigins: ["code.gitpolars.com"],
  transpilePackages: ["@workspace/ui"],
}

export default nextConfig
