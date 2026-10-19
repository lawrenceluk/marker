import { ASSET_REF_PATTERN } from "./assetIndex";
import { frontMatter } from "./frontmatter";

export const COPY_TITLE_PREFIX = "[COPY] ";

function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function prefixTitleLine(line: string): string {
  const match = /^title:\s*(.*)$/.exec(line);
  if (!match) return line;
  const rawValue = match[1] ?? "";
  const inner = stripYamlQuotes(rawValue);
  if (rawValue.trim().startsWith('"') || rawValue.trim().startsWith("'")) {
    const quote = rawValue.trim().startsWith('"') ? '"' : "'";
    return `title: ${quote}${COPY_TITLE_PREFIX}${inner}${quote}`;
  }
  if (/^[|>]/.test(rawValue.trim())) return line;
  return `title: ${COPY_TITLE_PREFIX}${inner}`;
}

function prefixFirstHeadingOutsideFences(body: string): string {
  const lines = body.split("\n");
  let inFence = false;
  let fenceMarker = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const open = /^(```+|~~~+)(.*)$/.exec(line);
    if (open) {
      if (!inFence) {
        inFence = true;
        fenceMarker = open[1]!;
      } else if (line.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }
    if (inFence) continue;
    const heading = /^(\uFEFF?)(#{1,6}[ \t]+)(.+)$/.exec(line);
    if (heading) {
      lines[i] = `${heading[1]}${heading[2]}${COPY_TITLE_PREFIX}${heading[3]}`;
      return lines.join("\n");
    }
  }
  return body;
}

/** Prepend the copy marker to front-matter title or the first ATX heading outside fences. */
export function duplicateNoteContent(content: string): string {
  const meta = frontMatter(content);
  if (meta?.fields && typeof meta.fields.title === "string") {
    const lines = meta.raw.split("\n");
    let changed = false;
    const next = lines.map((line) => {
      if (!/^title:/.test(line)) return line;
      changed = true;
      return prefixTitleLine(line);
    });
    if (changed) {
      const newRaw = next.join("\n");
      const start = content.indexOf(meta.raw);
      if (start >= 0) {
        return content.slice(0, start) + newRaw + content.slice(start + meta.raw.length);
      }
    }
  }
  if (meta) {
    const body = content.slice(meta.end);
    const prefixed = prefixFirstHeadingOutsideFences(body);
    if (prefixed !== body) return content.slice(0, meta.end) + prefixed;
    return content;
  }
  return prefixFirstHeadingOutsideFences(content);
}

export function rewriteAssetReferences(content: string, idMap: Record<string, string>): string {
  return content.replace(ASSET_REF_PATTERN, (match, id) => {
    const next = idMap[id];
    if (!next) return match;
    const kind = match.startsWith("marker-embed:") ? "embed" : "asset";
    return `marker-${kind}:${next}`;
  });
}
