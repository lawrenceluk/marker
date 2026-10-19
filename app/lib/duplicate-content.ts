import { parseDocument, isMap } from "yaml";
import { ASSET_REF_PATTERN } from "./assetIndex";
import { frontMatter } from "./frontmatter";

export const COPY_TITLE_PREFIX = "[COPY] ";

function prefixFirstHeading(body: string): string {
  return body.replace(
    /^(\uFEFF?)(#{1,6}[ \t]+)([^\n]+)/m,
    (_, bom, hashes, title) => `${bom}${hashes}${COPY_TITLE_PREFIX}${title}`,
  );
}

/** Prepend the copy marker to front-matter title or the first ATX heading. */
export function duplicateNoteContent(content: string): string {
  const meta = frontMatter(content);
  if (meta?.fields && typeof meta.fields.title === "string") {
    const doc = parseDocument(meta.raw, { schema: "core" });
    if (isMap(doc.contents)) {
      doc.set("title", COPY_TITLE_PREFIX + meta.fields.title);
      const newRaw = String(doc);
      const start = content.indexOf(meta.raw);
      if (start >= 0) {
        return content.slice(0, start) + newRaw + content.slice(start + meta.raw.length);
      }
    }
  }
  if (meta) {
    const body = content.slice(meta.end);
    const prefixed = prefixFirstHeading(body);
    if (prefixed !== body) return content.slice(0, meta.end) + prefixed;
    return content;
  }
  return prefixFirstHeading(content);
}

export function rewriteAssetReferences(content: string, idMap: Record<string, string>): string {
  return content.replace(ASSET_REF_PATTERN, (match, id) => {
    const next = idMap[id];
    if (!next) return match;
    const kind = match.startsWith("marker-embed:") ? "embed" : "asset";
    return `marker-${kind}:${next}`;
  });
}
