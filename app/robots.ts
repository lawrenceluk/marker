import type { MetadataRoute } from "next";
import { PREVIEW_BOT_USER_AGENTS } from "./lib/robots";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: "/",
      },
      {
        // X/Twitter (and several others) honor robots.txt; a global Disallow
        // would prevent cards. Search engines stay on the `*` rule.
        userAgent: [...PREVIEW_BOT_USER_AGENTS],
        allow: "/",
        disallow: "/api/",
      },
    ],
  };
}
