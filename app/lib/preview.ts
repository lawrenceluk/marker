/**
 * Title and description for link-preview unfurls, taken from the start of a
 * note. Persist URLs already expose the full note to anyone with the link;
 * this is only a truncated plaintext prefix for og:title / og:description.
 */

export const TITLE_MAX = 70;
export const DESCRIPTION_MAX = 200;

/** Enough source text for a title + description even with markdown noise. */
const SOURCE_MAX = 8_000;

export type NotePreview = {
  title: string;
  description: string;
};

function stripMarkdown(markdown: string): string {
  let text = markdown.slice(0, SOURCE_MAX).replace(/\r\n|\r/g, "\n");

  // Fenced code: keep the inner text (it may be the paste).
  text = text.replace(/```[\w-]*\n?([\s\S]*?)```/g, "$1");
  text = text.replace(/~~~[\w-]*\n?([\s\S]*?)~~~/g, "$1");

  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");

  text = text.replace(/^\s{0,3}#{1,6}[ \t]+/gm, "");
  text = text.replace(/^\s{0,3}>\s?/gm, "");
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+[.)]\s+/gm, "");
  text = text.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "");
  text = text.replace(/^[=\-]{3,}\s*$/gm, "");

  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/(\*\*|__)([\s\S]*?)\1/g, "$2");
  text = text.replace(/(\*|_)([^\n]*?)\1/g, "$2");
  text = text.replace(/~~([\s\S]*?)~~/g, "$1");

  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/\|/g, " ");

  text = text.replace(/[^\S\n]+/g, " ");
  text = text.replace(/ +\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function truncateAtWord(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  const slice = normalized.slice(0, max);
  const breakAt = slice.lastIndexOf(" ");
  const end = breakAt >= Math.floor(max * 0.5) ? breakAt : max;
  return normalized.slice(0, end).replace(/[\s.,;:!?-]+$/, "") + "…";
}

/** Split `text` into a title-sized prefix and the leftover plaintext. */
function splitPrefix(
  text: string,
  max: number
): { prefix: string; rest: string } {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return { prefix: normalized, rest: "" };
  }
  const slice = normalized.slice(0, max);
  const breakAt = slice.lastIndexOf(" ");
  const end = breakAt >= Math.floor(max * 0.5) ? breakAt : max;
  const prefix = normalized.slice(0, end).replace(/[\s.,;:!?-]+$/, "");
  return { prefix: prefix + "…", rest: normalized.slice(end).trim() };
}

/**
 * Derive unfurl title/description from the start of a note.
 * Returns null when there is no usable plaintext (empty, or markdown-only noise).
 */
export function previewFromMarkdown(markdown: string): NotePreview | null {
  if (!markdown) return null;

  const plain = stripMarkdown(markdown);
  if (!plain) return null;

  const blocks = plain
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const first = blocks[0];
  if (!first) return null;

  const afterFirst = blocks.slice(1).join(" ").replace(/\s+/g, " ").trim();

  if (first.length <= TITLE_MAX) {
    return {
      title: first,
      description: truncateAtWord(afterFirst, DESCRIPTION_MAX),
    };
  }

  const { prefix, rest } = splitPrefix(first, TITLE_MAX);
  return {
    title: prefix,
    description: truncateAtWord(
      [rest, afterFirst].filter(Boolean).join(" "),
      DESCRIPTION_MAX
    ),
  };
}
