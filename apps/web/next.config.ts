import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  basePath: process.env.CODE_SERVER_BASE_PATH || undefined,
  allowedDevOrigins: ["code.gitpolars.com"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, Authorization",
          },
        ],
      },
    ]
  },
  transpilePackages: ["@workspace/ui"],
}

export default nextConfig
