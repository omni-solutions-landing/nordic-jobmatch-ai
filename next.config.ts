import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  /** Enable React Strict Mode for development checks */
  reactStrictMode: true,

  /** Redirect trailing slashes for consistent URLs */
  trailingSlash: false,

  /** Server-side packages that should not be bundled for the client */
  serverExternalPackages: ["@google/generative-ai"],

  /** Image optimization domains (add CDN/S3 origins here later) */
  images: {
    remotePatterns: [],
  },

  /** Security headers */
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
