import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../app/llms.txt/route";
import { HOME_AGENT_PROMPT, MARKER_AGENT_PROMPT } from "../app/lib/agentPrompt";
import { REACTION_AGENT_PROMPT } from "../app/lib/reactionAgentPrompt";

test("/llms.txt serves exactly the home page's Copy agent prompt text", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  const body = await response.text();
  assert.equal(body, HOME_AGENT_PROMPT);
  assert.equal(body, `${MARKER_AGENT_PROMPT}\n\n${REACTION_AGENT_PROMPT}`);
  assert.match(body, /## Images/);
  assert.match(body, /## Embeds/);
});

test("Agent prompt states the server's 10-embed limit", async () => {
  const { MAX_NOTE_EMBEDS } = await import("../app/lib/embedPolicy");
  assert.equal(MAX_NOTE_EMBEDS, 10);
  assert.match(MARKER_AGENT_PROMPT, /embed up to 10 self-contained HTML files/);
  assert.doesNotMatch(MARKER_AGENT_PROMPT, /embed one self-contained HTML file/);
});
