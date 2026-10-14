import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentViewer } from "../app/components/ContentViewer";
import { MARKER_AGENT_PROMPT } from "../app/lib/agentPrompt";
import { isProseTable, STACK_MIN_CELL_CHARS, STACK_MIN_COLUMNS } from "../app/lib/tableShape";

const sentence = "Most outages in the incident log trace back to retry storms, not raw load.";
const render = (content: string) => renderToStaticMarkup(createElement(ContentViewer, { content }));

test("a table is prose when it has three or more columns and a cell runs to a sentence", () => {
  assert.equal(STACK_MIN_COLUMNS, 3);
  assert.equal(STACK_MIN_CELL_CHARS, 60);
  assert.ok(sentence.length > STACK_MIN_CELL_CHARS);
  assert.equal(isProseTable(["Source", "Claim", "Why"], [["Talk", sentence, "Back off"]]), true);
  // Short values stay a grid however many columns there are.
  assert.equal(isProseTable(["Task", "Owner", "Due", "Status"], [["Launch post", "Lawrence", "Oct 14", "Open"]]), false);
  // Two columns of sentences still read side by side.
  assert.equal(isProseTable(["Term", "Meaning"], [["Rev", sentence]]), false);
  // Exactly at the limit is not over it; whitespace doesn't count.
  const edge = "x".repeat(STACK_MIN_CELL_CHARS);
  assert.equal(isProseTable(["a", "b", "c"], [["1", `  ${edge}  `, "3"]]), false);
  assert.equal(isProseTable(["a", "b", "c"], [["1", `${edge}x`, "3"]]), true);
  assert.equal(isProseTable([], []), false);
});

test("prose tables carry their shape, column labels and explicit roles; grids carry only their shape", () => {
  const prose = render(`| Source | Claim | Why it matters |\n| --- | --- | --- |\n| [Charles on rate limiting](https://example.com) | ${sentence} | Back off first. |\n| Notes | Short. | |`);
  assert.match(prose, /<div class="prose-table" data-shape="prose"><table[^>]* role="table"/);
  assert.match(prose, /<thead role="rowgroup"><tr role="row"><th role="columnheader">Source<\/th>/);
  assert.match(prose, /<td role="cell" data-label="Source"><a href="https:\/\/example.com"[^>]*>Charles/);
  assert.match(prose, /<td role="cell" data-label="Claim">Most outages/);
  assert.match(prose, /<td role="cell" data-label="Why it matters"><\/td>/);

  const grid = render("| Task | Owner | Due |\n| --- | --- | --- |\n| Launch post | Lawrence | Oct 14 |");
  assert.match(grid, /<div class="prose-table" data-shape="grid"><table[^>]*>/);
  assert.doesNotMatch(grid, /role=|data-label/);
});

test("the agent brief tells authors when a table is the wrong shape", () => {
  assert.match(MARKER_AGENT_PROMPT, /use a table only when readers compare short values across rows/);
  assert.match(MARKER_AGENT_PROMPT, /when a cell would need a sentence, write each item as a short bold lead or heading/);
});
