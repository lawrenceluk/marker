/**
 * Title and description for link-preview unfurls, taken from the start of a
 * note. Persist URLs already expose the full note to anyone with the link;
 * this is only a truncated plaintext prefix for og:title / og:description.
 */

import { frontMatter } from "./frontmatter";
import { markdownExcerpt, stripMarkdown } from "./markdownPlainText";

export const TITLE_MAX = 70;
export const DESCRIPTION_MAX = 200;

/** Characters shown in the generated OG body image. */
export const OG_BODY_MAX = 420;

export type NotePreview = {
  title: string;
  description: string;
};

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
 * Plaintext prefix for the OG visual card. Keeps paragraph breaks so the
 * image reads like the start of the note, not a single run-on line.
 */
export function ogBodyText(
  markdown: string,
  max: number = OG_BODY_MAX
): string {
  return markdownExcerpt(markdown.slice(frontMatter(markdown)?.end ?? 0), max);
}

/**
 * Derive unfurl title/description from the start of a note.
 * Returns null when there is no usable plaintext (empty, or markdown-only noise).
 */
export function previewFromMarkdown(markdown: string): NotePreview | null {
  if (!markdown) return null;

  const plain = stripMarkdown(markdown.slice(frontMatter(markdown)?.end ?? 0));
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
