import type { MetadataValue } from "./frontmatter";

/**
 * Front matter in the byline (Figma BylineMetadata). The first few short, single-line string
 * values read inline; when anything else remains, every field opens as a key/value list with
 * nested keys flattened to dotted paths.
 */
export const INLINE_MAX = 3;
export const INLINE_CHARS = 32;
const LIST_ITEM_CHARS = 24;
const MAX_DEPTH = 8;

export type MetadataEntry = { key: string; value: string };
export type MetadataSummary = { inline: string[]; entries: MetadataEntry[]; more: number };

const scalar = (value: MetadataValue) => value === null || typeof value !== "object";
const show = (value: MetadataValue) => (value === null ? "null" : value === "" ? '""' : String(value));

export function flattenMetadata(fields: Record<string, MetadataValue>, prefix = "", depth = 0): MetadataEntry[] {
  return Object.entries(fields).flatMap(([name, value]): MetadataEntry[] => {
    const key = prefix ? `${prefix}.${name}` : name;
    if (depth >= MAX_DEPTH && !scalar(value)) return [{ key, value: JSON.stringify(value) }];
    if (Array.isArray(value)) {
      if (!value.length) return [{ key, value: "[]" }];
      if (value.every(scalar)) {
        const items = value.map(show);
        return [{ key, value: items.join(items.some(item => item.length > LIST_ITEM_CHARS) ? "\n" : ", ") }];
      }
      return value.flatMap((item, index) => scalar(item)
        ? [{ key: `${key}.${index}`, value: show(item) }]
        : flattenMetadata(Array.isArray(item) ? Object.fromEntries(item.map((v, i) => [String(i), v])) : (item as Record<string, MetadataValue>), `${key}.${index}`, depth + 1));
    }
    if (value !== null && typeof value === "object") {
      return Object.keys(value).length ? flattenMetadata(value, key, depth + 1) : [{ key, value: "{}" }];
    }
    return [{ key, value: show(value) }];
  });
}

export function summarizeMetadata(fields: Record<string, MetadataValue>): MetadataSummary {
  const entries = flattenMetadata(fields);
  const inline = Object.values(fields)
    .filter((value): value is string => typeof value === "string" && value.trim() !== "" && !/[\r\n]/.test(value) && value.length <= INLINE_CHARS)
    .slice(0, INLINE_MAX);
  return { inline, entries, more: entries.length - inline.length };
}
