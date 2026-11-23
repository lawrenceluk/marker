import type { NextConfig } from "next";
import { ANONYMOUS_HOME_HEADER, privateHomeHeaders } from "./app/lib/anonymousHome";
import { ROBOTS_TAG } from "./app/lib/robots";
import { markerCsp } from "./app/lib/csp";

const nextConfig: NextConfig = {
  skipProxyUrlNormalize: true,
  outputFileTracingIncludes: {
    "/og": ["./node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf"],
  },
  async rewrites() {
    return {
      beforeFiles: [{
        source: "/",
        destination: "/anonymous-home",
        has: [{ type: "header", key: ANONYMOUS_HOME_HEADER, value: "1" }],
        // Routing sees Flight headers and the internal query stripped by the Proxy adapter.
        missing: [
          ...privateHomeHeaders.map(key => ({ type: "header" as const, key })),
          { type: "query", key: "_rsc" },
        ],
      }],
      afterFiles: [{ source: "/.well-known/llms.txt", destination: "/llms.txt" }],
    };
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
