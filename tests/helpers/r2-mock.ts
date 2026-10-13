/** In-memory S3/R2 stand-in that verifies SigV4 (header and presigned) like R2 does. */
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { signature, UNSIGNED_PAYLOAD } from "../../app/lib/r2";

export const R2_TEST_ENV = {
  R2_ACCOUNT_ID: "test-account",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
  R2_BUCKET: "marker-assets-test",
};

type Stored = { body: Buffer; contentType: string };

export async function startR2Mock(options: { port?: number; basePath?: string; cors?: boolean } = {}) {
  const basePath = options.basePath ?? "";
  const objects = new Map<string, Stored>();
  const log: string[] = [];
  const config = { accessKeyId: R2_TEST_ENV.R2_ACCESS_KEY_ID, secretAccessKey: R2_TEST_ENV.R2_SECRET_ACCESS_KEY, region: "auto" };

  function verify(req: IncomingMessage, url: URL, body: Buffer): string | null {
    const headerValue = (name: string) => {
      const v = req.headers[name];
      return Array.isArray(v) ? v.join(",") : v ?? "";
    };
    const presigned = url.searchParams.get("X-Amz-Signature");
    if (presigned) {
      const date = url.searchParams.get("X-Amz-Date") ?? "";
      const expires = Number(url.searchParams.get("X-Amz-Expires"));
      const signedAt = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`);
      if (!(signedAt + expires * 1000 > Date.now())) return "Request has expired";
      const names = (url.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");
      const headers = Object.fromEntries(names.map(n => [n, headerValue(n)]));
      const { signature: expected } = signature({ method: req.method!, url, headers, payloadHash: UNSIGNED_PAYLOAD, date, config });
      return expected === presigned ? null : "SignatureDoesNotMatch";
    }
    const auth = /Credential=[^/]+\/(\d{8})\/[^,]+, SignedHeaders=([^,]+), Signature=([0-9a-f]+)/.exec(headerValue("authorization"));
    if (!auth) return "AccessDenied";
    const payloadHash = headerValue("x-amz-content-sha256");
    if (payloadHash !== createHash("sha256").update(body).digest("hex")) return "XAmzContentSHA256Mismatch";
    const headers = Object.fromEntries(auth[2].split(";").map(n => [n, headerValue(n)]));
    const { signature: expected } = signature({ method: req.method!, url, headers, payloadHash, date: headerValue("x-amz-date"), config });
    return expected === auth[3] ? null : "SignatureDoesNotMatch";
  }

  const server = createServer(async (req, res) => {
    if (options.cors) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, PUT");
      res.setHeader("Access-Control-Allow-Headers", "content-type");
      if (req.method === "OPTIONS") return void res.writeHead(204).end();
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const path = url.pathname.slice(basePath.length).replace(/^\//, "");
    const [bucket, ...rest] = path.split("/");
    const key = rest.map(decodeURIComponent).join("/");
    const error = bucket === R2_TEST_ENV.R2_BUCKET ? verify(req, url, body) : "NoSuchBucket";
    log.push(`${req.method} ${key || "?" + url.searchParams.get("prefix")}${error ? ` ${error}` : ""}`);
    if (error) return void res.writeHead(403, { "content-type": "application/xml" }).end(`<Error><Code>${error}</Code></Error>`);

    if (req.method === "PUT" && key) {
      if (Number(req.headers["content-length"]) !== body.length) return void res.writeHead(400).end();
      objects.set(key, { body, contentType: String(req.headers["content-type"] ?? "") });
      return void res.writeHead(200, { etag: '"mock"' }).end();
    }
    if (req.method === "HEAD" && key) {
      const object = objects.get(key);
      return void res.writeHead(object ? 200 : 404, object ? { "content-type": object.contentType, "content-length": String(object.body.length) } : {}).end();
    }
    if (req.method === "GET" && key) {
      const object = objects.get(key);
      if (!object) return void res.writeHead(404).end();
      return void res.writeHead(200, {
        "content-type": url.searchParams.get("response-content-type") ?? object.contentType,
        "content-disposition": url.searchParams.get("response-content-disposition") ?? "",
        "cache-control": url.searchParams.get("response-cache-control") ?? "",
      }).end(object.body);
    }
    if (req.method === "DELETE" && key) {
      objects.delete(key);
      return void res.writeHead(204).end();
    }
    if (req.method === "GET" && url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const keys = [...objects.keys()].filter(k => k.startsWith(prefix));
      return void res.writeHead(200, { "content-type": "application/xml" }).end(
        `<ListBucketResult><IsTruncated>false</IsTruncated>${keys.map(k => `<Contents><Key>${k}</Key></Contents>`).join("")}</ListBucketResult>`,
      );
    }
    res.writeHead(400).end();
  });
  await new Promise<void>(resolve => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    objects,
    log,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
