import { NextResponse } from "next/server";
import { DEFAULT_EMOJI, emojiFromAnswer, emojiQuestion } from "@/app/lib/emoji-suggestions";

export const preferredRegion = "sfo1";

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length")) > 4096) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  const input = body as { selection?: unknown; context?: unknown };
  if (typeof input?.selection !== "string" || !input.selection.trim() || input.selection.length > 700 ||
    typeof input.context !== "string" || input.context.length > 2200)
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const reply = (emojis = DEFAULT_EMOJI) => NextResponse.json({ emojis }, { headers: { "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex, nofollow, noarchive" } });
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return reply();
  try {
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "jev-1.13.0", state: { selected_quote: input.selection, nearby_passage: input.context }, questions: { reaction: emojiQuestion() } }),
      signal: AbortSignal.timeout(1500), cache: "no-store",
    });
    if (!response.ok) return reply();
    const data = await response.json();
    return reply(emojiFromAnswer(data?.answers?.reaction) ?? DEFAULT_EMOJI);
  } catch { return reply(); }
}
