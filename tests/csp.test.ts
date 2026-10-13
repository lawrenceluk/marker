import assert from "node:assert/strict";
import { test } from "node:test";
import { markerCsp, storageOrigin } from "../app/lib/csp";

const directives = (csp: string) => Object.fromEntries(csp.split(/;\s*/).map(d => {
  const [name, ...values] = d.trim().split(/\s+/);
  return [name, values];
}));

test("Marker's CSP is enforced on every page, not report-only", async () => {
  const { default: config } = await import("../next.config");
  const rules = await config.headers!();
  assert.deepEqual(rules.map(r => r.source), ["/", "/:path*"]);
  for (const rule of rules) {
    const names = rule.headers.map(h => h.key);
    assert.ok(names.includes("Content-Security-Policy"), rule.source);
    assert.ok(!names.includes("Content-Security-Policy-Report-Only"), rule.source);
  }
});

test("the policy: own origin plus storage for frames and uploads, never framed", () => {
  const csp = directives(markerCsp({ R2_ACCOUNT_ID: "acct" }));
  assert.deepEqual(csp["frame-src"], ["'self'", "https://acct.r2.cloudflarestorage.com"]);
  assert.deepEqual(csp["connect-src"], ["'self'", "https://acct.r2.cloudflarestorage.com"]);
  assert.deepEqual(csp["script-src"], ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
  assert.deepEqual(csp["object-src"], ["'none'"]);
  assert.deepEqual(csp["form-action"], ["'self'"]);
  assert.deepEqual(csp["base-uri"], ["'self'"]);
  assert.deepEqual(csp["img-src"], ["'self'", "data:", "blob:", "https:"]);
});

test("storage origin follows the R2 settings", () => {
  assert.equal(storageOrigin({}), "https://*.r2.cloudflarestorage.com");
  assert.equal(storageOrigin({ R2_ACCOUNT_ID: "acct" }), "https://acct.r2.cloudflarestorage.com");
  assert.equal(storageOrigin({ R2_ACCOUNT_ID: "acct", R2_ENDPOINT: "https://127.0.0.1:17382/__r2" }), "https://127.0.0.1:17382");
  assert.equal(directives(markerCsp({}))["frame-src"].at(-1), "https://*.r2.cloudflarestorage.com");
});

test("dev allows eval for hot reload; Preview allows the Vercel toolbar; production allows neither", () => {
  const prod = markerCsp({ NODE_ENV: "production", VERCEL_ENV: "production" });
  assert.ok(!prod.includes("unsafe-eval") && !prod.includes("vercel.live"));
  assert.ok(directives(markerCsp({ NODE_ENV: "development" }))["script-src"].includes("'unsafe-eval'"));
  const preview = directives(markerCsp({ NODE_ENV: "production", VERCEL_ENV: "preview" }));
  assert.ok(preview["script-src"].includes("https://vercel.live"));
  assert.ok(preview["frame-src"].includes("https://vercel.live"));
  assert.ok(!preview["script-src"].includes("'unsafe-eval'"));
});
