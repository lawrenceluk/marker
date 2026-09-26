/** Disposable real Redis + an Upstash-compatible HTTP shim. No hosted credentials. */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createClient } from "redis";

export async function startRedisRest(port = 0) {
  const dir = await mkdtemp(join(tmpdir(), "marker-test-"));
  const socket = join(dir, "redis.sock");
  const child = spawn(
    "redis-server",
    ["--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no"],
    { stdio: "ignore" },
  );
  const client = createClient({
    socket: {
      path: socket,
      reconnectStrategy: (retries) =>
        retries < 30 ? 50 : new Error("Redis did not start"),
    },
  });
  client.on("error", () => {});
  await client.connect();
  const commands: string[][] = [];
  function encode(value: unknown): unknown {
    if (typeof value === "string") return Buffer.from(value).toString("base64");
    if (Array.isArray(value)) return value.map(encode);
    return value;
  }
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    try {
      const input = JSON.parse(raw);
      const execute = async (command: unknown[]) => {
        const args = command.map(String);
        commands.push(args);
        const result = await client.sendCommand(args);
        return {
          result:
            request.headers["upstash-encoding"] === "base64"
              ? encode(result)
              : result,
        };
      };
      const result =
        request.url === "/pipeline"
          ? await Promise.all(input.map(execute))
          : await execute(input);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(result));
    } catch (error) {
      response.end(JSON.stringify({ error: (error as Error).message }));
    }
  });
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  const address = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}`,
    client,
    commands,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await client.quit();
      child.kill();
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
      await rm(dir, { recursive: true, force: true });
    },
  };
}
