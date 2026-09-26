import { NextResponse } from "next/server";
import { heuristicRanking, type TapCandidate } from "@/app/lib/tap-select";

const MAX_BODY = 8_192;
const TIMEOUT_MS = 800;
const PRICE_PER_INPUT_TOKEN_USD = 0.042 / 1_000_000; // jev-1.13.0; output is free.

type RankRequest = { context: string; candidates: TapCandidate[]; mode: "jev" | "heuristic" };

function reply(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex, nofollow, noarchive" },
  });
}

async function boundedBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BODY) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BODY) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function valid(value: unknown): value is RankRequest {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<RankRequest>;
  return (body.mode === "jev" || body.mode === "heuristic") &&
    typeof body.context === "string" && body.context.length <= 2200 &&
    Array.isArray(body.candidates) && body.candidates.length >= 1 && body.candidates.length <= 15 &&
    body.candidates.every(c => c && Number.isSafeInteger(c.start) && Number.isSafeInteger(c.end) &&
      c.start >= 0 && c.end > c.start && typeof c.kind === "string" && c.kind.length <= 20 &&
      typeof c.text === "string" && c.text.length > 0 && c.text.length <= 700);
}

function stableHash(text: string) {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") return reply({ error: "Not found" }, 404);
  const raw = await boundedBody(request);
  if (!raw) return reply({ error: "Request too large" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply({ error: "Invalid request" }, 400); }
  if (!valid(body)) return reply({ error: "Invalid request" }, 400);
  const fallback = heuristicRanking(body.candidates);
  const started = performance.now();
  const result = (source: string, ranking = fallback, usage?: { input_tokens: number; output_tokens: number; cost_usd: number }) =>
    reply({ ranking, source, latency_ms: Math.round(performance.now() - started), ...(usage ? { usage } : {}) });
  if (body.mode === "heuristic") return result("heuristic");
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return result("heuristic · no key");
  // Neutral labels and a deterministic, length-independent order reduce position bias.
  const order = body.candidates.map((_, i) => i)
    .sort((a, b) => stableHash(body.candidates[a].text) - stableHash(body.candidates[b].text) || a - b);
  const labels = order.map((_, i) => `option_${String(i + 1).padStart(2, "0")}`);
  const criteria = Object.fromEntries(order.map((index, i) => [labels[i], { quote: body.candidates[index].text, scope: body.candidates[index].kind }]));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "jev-1.13.0",
        state: { nearby_passage: body.context, tapped_text: body.candidates.find(c => c.kind === "word")?.text ?? body.candidates[0].text },
        questions: { span: {
          type: "choice",
          instructions: "Which quote best captures the specific point a reader would comment on after tapping `tapped_text` in `nearby_passage`? Prefer the shortest meaningful phrase or word(s) that carry the point. Choose a full sentence only when its wider claim or contrast is necessary to understand the comment target; do not choose it just because it is complete. Avoid syntax-only or vague fragments.",
          criteria,
        } },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return result("heuristic · service error");
    const data = await response.json();
    const probabilities = data?.answers?.span?.probabilities;
    if (data?.answers?.span?.type !== "choice" || !probabilities || typeof probabilities !== "object")
      return result("heuristic · invalid answer");
    const scores = order.map((index, i) => ({ index, score: probabilities[labels[i]] }));
    if (scores.some(item => typeof item.score !== "number" || !Number.isFinite(item.score)))
      return result("heuristic · invalid answer");
    scores.sort((a, b) => b.score - a.score || a.index - b.index);
    const input = data?.usage?.input_tokens, output = data?.usage?.output_tokens;
    const usage = Number.isSafeInteger(input) && Number.isSafeInteger(output)
      ? { input_tokens: input, output_tokens: output, cost_usd: input * PRICE_PER_INPUT_TOKEN_USD } : undefined;
    return result("jev", scores.map(item => item.index), usage);
  } catch {
    return result(controller.signal.aborted ? "heuristic · timeout" : "heuristic · service error");
  } finally {
    clearTimeout(timeout);
  }
}
