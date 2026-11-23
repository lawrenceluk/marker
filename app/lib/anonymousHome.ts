// Set by the root Proxy after checking the method and query string.
export const ANONYMOUS_HOME_HEADER = "x-marker-anonymous-home";

export const privateHomeHeaders = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "rsc",
  "next-action",
  "next-router-state-tree",
  "next-router-prefetch",
  "next-router-segment-prefetch",
  "next-url",
  "x-nextjs-data",
  "purpose",
  "sec-purpose",
  "x-middleware-prefetch",
];
