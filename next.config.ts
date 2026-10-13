import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  webpack(config, { dev }) {
    if (dev) {
      // Keep Next's generated-file exclusions and avoid indexer checkpoint reloads.
      config.watchOptions = {
        ...config.watchOptions,
        ignored:
          /(?:^|[\\/])(?:node_modules|\.git|\.next|indexer|contracts[\\/](?:out|cache))(?:[\\/]|$)/,
      }
    }
    return config
  },
}

export default nextConfig
