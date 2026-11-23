import { isMap, parseDocument } from "yaml";

import { bodyWithoutFrontMatter, frontMatterOpening, type FrontMatter } from "./frontmatterBody";
export type { FrontMatter, MetadataValue } from "./frontmatterBody";

/** Only a leading, closed YAML block is metadata. Keep body offsets unchanged. */
export function frontMatter(content: string): FrontMatter | null {
  const opening = frontMatterOpening(content);
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
  return bodyWithoutFrontMatter(content, metadata);
}
