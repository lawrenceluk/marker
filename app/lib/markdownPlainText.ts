/** Enough source text for a title + description even with markdown noise. */
const SOURCE_MAX = 8_000;

export function stripMarkdown(markdown: string): string {
  let text = markdown.slice(0, SOURCE_MAX).replace(/\r\n|\r/g, "\n");

  // Fenced code: keep the inner text (it may be the paste).
  text = text.replace(/```[\w-]*\n?([\s\S]*?)```/g, "$1");
  text = text.replace(/~~~[\w-]*\n?([\s\S]*?)~~~/g, "$1");

  // Uploaded images and embeds drop out entirely (an image's alt is often a filename); others keep their alt text.
  text = text.replace(/!\[[^\]]*\]\(\s*marker-(?:asset|embed):[^)]*\)/g, "");
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");

  text = text.replace(/^\s{0,3}#{1,6}[ \t]+/gm, "");
  text = text.replace(/^\s{0,3}>\s?/gm, "");
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+[.)]\s+/gm, "");
  text = text.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "");
  text = text.replace(/^[\=\-]{3,}\s*$/gm, "");

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

/** Excerpt a rendered Markdown body while retaining paragraph boundaries. */
export function markdownExcerpt(markdown: string, max: number): string {
  const plain = stripMarkdown(markdown);
  if (!plain) return "";
  if (plain.length <= max) return plain;

  const slice = plain.slice(0, max);
  const breakNl = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"));
  const breakSp = slice.lastIndexOf(" ");
  const preferNl = breakNl >= Math.floor(max * 0.4);
  const end = preferNl
    ? breakNl
    : breakSp >= Math.floor(max * 0.5)
      ? breakSp
      : max;
  return plain.slice(0, end).replace(/[\s.,;:!?-]+$/u, "") + "…";
}
