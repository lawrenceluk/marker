import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../app/api/tap-select/route";

const sample = {
  mode: "jev",
  context: "One brief sentence. A focused clause, then another idea.",
  candidates: [
    { start: 20, end: 27, kind: "word", text: "focused" },
    { start: 20, end: 34, kind: "phrase", text: "focused clause" },
    { start: 18, end: 34, kind: "clause", text: "A focused clause" },
    { start: 18, end: 55, kind: "sentence", text: "A focused clause, then another idea." },
  ],
} as const;
function post(body: unknown = sample) {
  return POST(new Request("http://localhost/api/tap-select", { method: "POST", body: JSON.stringify(body) }));
}

test("preview Choice ranking, token cost, and hard production gate", async () => {
  const oldEnv = process.env.VERCEL_ENV, oldKey = process.env.TYPESAFE_API_KEY, oldFetch = global.fetch;
  let calls = 0;
  let chosenText: string = sample.candidates[1].text;
  try {
    process.env.VERCEL_ENV = "preview";
    process.env.TYPESAFE_API_KEY = "synthetic-test-only";
    global.fetch = (async (_url, init) => {
      calls++;
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.model, "jev-1.13.0");
      assert.ok(!JSON.stringify(payload).includes("synthetic-test-only"));
      assert.match(payload.questions.span.instructions, /shortest meaningful phrase/u);
      assert.match(payload.questions.span.instructions, /full sentence only/u);
      const criteria = payload.questions.span.criteria as Record<string, { quote: string; scope: string }>;
      assert.ok(Object.values(criteria).some(option => option.scope === "phrase"));
      const scores = Object.fromEntries(Object.entries(criteria).map(([label, option]) => [label, option.quote === chosenText ? .9 : .025]));
      return new Response(JSON.stringify({ answers: { span: { type: "choice", probabilities: scores } }, usage: { input_tokens: 400, output_tokens: 12 } }), { status: 200 });
    }) as typeof fetch;
    const success = await (await post()).json();
    assert.equal(success.source, "jev");
    assert.equal(success.ranking[0], 1);
    chosenText = sample.candidates[3].text;
    const fullSentence = await (await post()).json();
    assert.equal(fullSentence.ranking[0], 3, "an explicit full-sentence judgment remains possible");
    assert.deepEqual(success.usage, { input_tokens: 400, output_tokens: 12, cost_usd: 400 * .042 / 1_000_000 });
    process.env.VERCEL_ENV = "production";
    const production = await post();
    assert.equal(production.status, 404);
    assert.equal(calls, 2, "production with a key must never call TypeSafe");
  } finally {
    process.env.VERCEL_ENV = oldEnv;
    process.env.TYPESAFE_API_KEY = oldKey;
    global.fetch = oldFetch;
  }
});

test("missing key and timeout fall back to a clause; heuristic mode skips TypeSafe", async () => {
  const oldEnv = process.env.VERCEL_ENV, oldKey = process.env.TYPESAFE_API_KEY, oldFetch = global.fetch;
  try {
    process.env.VERCEL_ENV = "preview";
    delete process.env.TYPESAFE_API_KEY;
    let result = await (await post()).json();
    assert.equal(result.ranking[0], 2);
    assert.match(result.source, /no key/u);
    process.env.TYPESAFE_API_KEY = "synthetic-test-only";
    global.fetch = (async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })) as typeof fetch;
    result = await (await post()).json();
    assert.equal(result.ranking[0], 2);
    assert.match(result.source, /timeout/u);
    result = await (await post({ ...sample, mode: "heuristic" })).json();
    assert.equal(result.source, "heuristic");
  } finally {
    process.env.VERCEL_ENV = oldEnv;
    process.env.TYPESAFE_API_KEY = oldKey;
    global.fetch = oldFetch;
  }
});
