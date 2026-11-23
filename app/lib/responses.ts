import { bodyMarkdown } from "./frontmatter";
import { MAX_BLOCKS, reactionBlocksFromMarkdown, type ReactionBlock, type ResponseEntry } from "./reactionBlocks";
export type { ReactionBlock, ResponseEntry } from "./reactionBlocks";

export const MAX_RESPONSE_BYTES = 64 * 1024;

export function reactionBlocks(content: string): ReactionBlock[] {
  return reactionBlocksFromMarkdown(bodyMarkdown(content));
}

export function applyResponseChanges(blocks: ReactionBlock[], previous: ResponseEntry[], changes: unknown): ResponseEntry[] {
  if (!Array.isArray(changes) || changes.length > MAX_BLOCKS || !changes.length) throw new Error("Invalid response changes");
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
    next.set(block.id, { block_id: block.id, kind: block.kind, selections, free_text, updated_at: now });
  }
  const result = [...next.values()];
  if (result.length > MAX_BLOCKS || Buffer.byteLength(JSON.stringify(result)) > MAX_RESPONSE_BYTES) throw new Error("Responses exceed the note limit");
  return result;
}
