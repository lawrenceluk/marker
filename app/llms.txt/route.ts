import { HOME_AGENT_PROMPT } from "@/app/lib/agentPrompt";

export const dynamic = "force-static";

/** Agent instructions for crawlers and tools; also served at /.well-known/llms.txt via a rewrite. */
export function GET() {
  return new Response(HOME_AGENT_PROMPT, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
