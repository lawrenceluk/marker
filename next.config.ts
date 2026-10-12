import type { NextConfig } from "next";
import { ROBOTS_TAG } from "./app/lib/robots";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.r2.cloudflarestorage.com",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    const common = [
      { key: "X-Robots-Tag", value: ROBOTS_TAG },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      // Report-only until real traffic shows nothing legitimate is blocked.
      { key: "Content-Security-Policy-Report-Only", value: CSP },
    ];
    // `/:path*` does not match `/` itself.
    return [
      { source: "/", headers: common },
      { source: "/:path*", headers: common },
    ];
  },
};

export default nextConfig;
