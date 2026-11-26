import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@node-rs/argon2", "@prisma/client", "tesseract.js", "bullmq"],
  poweredByHeader: false,
  // Upload foto struk lewat server action (maks. 10 MB + overhead form).
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
