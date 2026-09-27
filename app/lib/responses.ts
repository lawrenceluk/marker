export type ReactionBlock =
  | { id: string; kind: "checkbox"; label: string; checked: boolean; offset: number }
  | { id: string; kind: "ask"; question: string; mode: "single" | "multi"; options: string[]; other: boolean; offset: number };

export type ResponseEntry = {
  block_id: string;
  kind: ReactionBlock["kind"];
  selections: string[];
  free_text: string;
  updated_at: number;
  submitted_at: number | null;
};

const MAX_BLOCKS = 100;
export const MAX_RESPONSE_BYTES = 64 * 1024;

function hash(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
}

/** Small, readable ask syntax. Invalid blocks stay ordinary fenced Markdown. */
function parseAsk(source: string, offset: number): ReactionBlock | null {
  const fields = new Map<string, string>();
  const options: string[] = [];
  let inOptions = false;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (inOptions && /^-\s+\S/.test(line)) {
      options.push(line.slice(2).trim());
      continue;
    }
    const match = /^(id|question|type|options|other):\s*(.*)$/i.exec(line);
    if (!match) return null;
    const name = match[1].toLowerCase();
    if (fields.has(name)) return null;
    fields.set(name, match[2].trim());
    inOptions = name === "options";
    if (inOptions && match[2].trim()) return null;
  }
  const id = fields.get("id") ?? "";
  const question = fields.get("question") ?? "";
  const mode = fields.get("type") ?? "single";
  const other = fields.get("other") ?? "false";
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !question || question.length > 300 ||
      !["single", "multi"].includes(mode) || !["true", "false"].includes(other) ||
      options.length < 2 || options.length > 12 ||
      options.some(option => !option || option.length > 120 || option === "Other") ||
      new Set(options).size !== options.length) return null;
  return { id: `ask:${id}`, kind: "ask", question, mode: mode as "single" | "multi", options, other: other === "true", offset };
}

export function reactionBlocks(content: string): ReactionBlock[] {
  const blocks: ReactionBlock[] = [];
  const seenChecks = new Map<string, number>();
  const seenAsks = new Set<string>();
  const lines = content.split("\n");
  let offset = 0;
  let fence: { mark: string; length: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.mark && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      offset += lines[i].length + 1;
      continue;
    }
    if (marker) {
      if (marker[1][0] === "`" && marker[2].trim() === "ask") {
        let end = i + 1;
        while (end < lines.length && !/^ {0,3}`{3,}\s*$/.test(lines[end])) end++;
        if (end < lines.length) {
          const block = parseAsk(lines.slice(i + 1, end).join("\n"), offset);
          if (block && !seenAsks.has(block.id)) {
            blocks.push(block);
            seenAsks.add(block.id);
          }
          while (i < end) { offset += lines[i].length + 1; i++; }
          offset += lines[i].length + 1;
          continue;
        }
      }
      fence = { mark: marker[1][0], length: marker[1].length };
      offset += lines[i].length + 1;
      continue;
    }
    const task = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.+?)\s*$/.exec(line);
    if (task) {
      const label = task[2].trim();
      const identity = hash(label.toLowerCase());
      const occurrence = (seenChecks.get(identity) ?? 0) + 1;
      seenChecks.set(identity, occurrence);
      blocks.push({ id: `check:${identity}:${occurrence}`, kind: "checkbox", label, checked: task[1].toLowerCase() === "x", offset });
    }
    offset += lines[i].length + 1;
  }
  return blocks.slice(0, MAX_BLOCKS);
}

export function applyResponseChanges(blocks: ReactionBlock[], previous: ResponseEntry[], changes: unknown, submit: unknown): ResponseEntry[] {
  if (!Array.isArray(changes) || changes.length > MAX_BLOCKS || typeof submit !== "boolean" || (!changes.length && !submit)) throw new Error("Invalid response changes");
  const byId = new Map(blocks.map(block => [block.id, block]));
  const next = new Map(previous.map(entry => [entry.block_id, entry]));
  const seen = new Set<string>();
  const now = Date.now();
  for (const change of changes) {
    if (!change || typeof change !== "object" || Array.isArray(change)) throw new Error("Invalid response change");
    const { block_id, selections, free_text } = change as Record<string, unknown>;
    const block = byId.get(block_id as string);
    if (!block || seen.has(block.id) || !Array.isArray(selections) || typeof free_text !== "string" || free_text.length > 1000) throw new Error("Invalid response change");
    seen.add(block.id);
    if (!selections.every(item => typeof item === "string") || new Set(selections).size !== selections.length) throw new Error("Invalid selections");
    if (block.kind === "checkbox") {
      if (free_text || selections.length > 1 || (selections.length === 1 && selections[0] !== block.label)) throw new Error("Invalid checkbox response");
    } else if (selections.length > (block.mode === "single" ? 1 : block.options.length + 1) ||
               selections.some(item => !block.options.includes(item) && !(block.other && item === "Other")) ||
               (free_text && (!block.other || !selections.includes("Other")))) throw new Error("Invalid ask response");
    next.set(block.id, { block_id: block.id, kind: block.kind, selections, free_text, updated_at: now, submitted_at: null });
  }
  if (submit) for (const block of blocks) {
    const entry = next.get(block.id) ?? {
      block_id: block.id, kind: block.kind,
      selections: block.kind === "checkbox" && block.checked ? [block.label] : [],
      free_text: "", updated_at: now, submitted_at: null,
    };
    next.set(block.id, { ...entry, submitted_at: now });
  }
  const result = [...next.values()];
  if (result.length > MAX_BLOCKS || Buffer.byteLength(JSON.stringify(result)) > MAX_RESPONSE_BYTES) throw new Error("Responses exceed the note limit");
  return result;
}
