import type { NextConfig } from "next";
import { ROBOTS_TAG } from "./app/lib/robots";

const nextConfig: NextConfig = {
  async headers() {
    const robots = [{ key: "X-Robots-Tag", value: ROBOTS_TAG }];
    // `/:path*` does not match `/` itself.
    return [
      { source: "/", headers: robots },
      { source: "/:path*", headers: robots },
    ];
  },
};

export default nextConfig;
