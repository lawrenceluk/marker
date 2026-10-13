import type { NextConfig } from "next";
import { ROBOTS_TAG } from "./app/lib/robots";
import { markerCsp } from "./app/lib/csp";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/og": ["./node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf"],
  },
  async headers() {
    const common = [
      { key: "X-Robots-Tag", value: ROBOTS_TAG },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Content-Security-Policy", value: markerCsp() },
    ];
    // `/:path*` does not match `/` itself.
    return [
      { source: "/", headers: common },
      { source: "/:path*", headers: common },
    ];
  },
};

export default nextConfig;
