import { isMap, parseDocument } from "yaml";

export type MetadataValue = string | number | boolean | null | MetadataValue[] | { [key: string]: MetadataValue };
export type FrontMatter = { raw: string; fields: Record<string, MetadataValue> | null; end: number };

/** Only a leading, closed YAML block is metadata. Keep body offsets unchanged. */
export function frontMatter(content: string): FrontMatter | null {
  const opening = /^\uFEFF?---[ \t]*\r?\n/u.exec(content);
  if (!opening) return null;
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm;
  closing.lastIndex = opening[0].length;
  const match = closing.exec(content);
  if (!match) return null;
  const raw = content.slice(opening[0].length, match.index);
  const end = match.index + match[0].length;
  try {
    const document = parseDocument(raw, { schema: "core" });
    if (document.errors.length) return { raw, fields: null, end };
    // Preserve ordinary leading thematic rules / setext paragraphs.
    if (document.contents && !isMap(document.contents)) return null;
    const fields = document.toJS({ maxAliasCount: 50 }) ?? {};
    // Reject cyclic aliases and bound nested rendering; keep the raw YAML available.
    JSON.stringify(fields);
    return { raw, fields, end };
  } catch {
    return { raw, fields: null, end };
  }
}

export function bodyMarkdown(content: string, metadata = frontMatter(content)): string {
  if (!metadata) return content;
  return content.slice(0, metadata.end).replace(/[^\r\n]/g, " ") + content.slice(metadata.end);
}
