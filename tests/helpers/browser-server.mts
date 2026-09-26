import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { request as proxyRequest } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRedisRest } from "./redis-rest";

// HTTPS matches production's Secure cookies, including WebKit's strict handling.
const certDir = mkdtempSync(join(tmpdir(), "marker-tls-"));
const keyPath = join(certDir, "key.pem"),
  certPath = join(certDir, "cert.pem");
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
  ],
  { stdio: "ignore" },
);
const fixture = await startRedisRest(17380);
const app = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--port", "17381"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      VERCEL_ENV: "preview",
      KV_REST_API_URL: fixture.url,
      KV_REST_API_TOKEN: "synthetic-test-only",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
);
const proxy = createServer(
  { key: readFileSync(keyPath), cert: readFileSync(certPath) },
  (request, response) => {
    const upstream = proxyRequest(
      {
        hostname: "127.0.0.1",
        port: 17381,
        path: request.url,
        method: request.method,
        headers: { ...request.headers, "x-forwarded-proto": "https" },
      },
      (result) => {
        response.writeHead(result.statusCode!, result.headers);
        result.pipe(response);
      },
    );
    upstream.on("error", () => {
      response.statusCode = 503;
      response.end();
    });
    request.pipe(upstream);
  },
);
proxy.listen(17382, "127.0.0.1");
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  proxy.closeAllConnections();
  proxy.close();
  app.kill();
  await fixture.close();
  rmSync(certDir, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
app.on("exit", close);
