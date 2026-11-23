import type { MetadataSummary } from "./metadataSummary";

export const FRONT_MATTER_HEADER = "x-marker-front-matter";

export type MetadataValue = string | number | boolean | null | MetadataValue[] | { [key: string]: MetadataValue };
export type FrontMatter = { raw: string; fields: Record<string, MetadataValue> | null; end: number };

export type DisplayFrontMatter = { raw: string; summary: MetadataSummary | null; end: number };

export function frontMatterOpening(content: string) {
  return /^\uFEFF?---[ \t]*\r?\n/u.exec(content);
}

export function bodyWithoutFrontMatter(content: string, metadata: { end: number } | null): string {
  if (!metadata) return content;
  return content.slice(0, metadata.end).replace(/[^\r\n]/g, " ") + content.slice(metadata.end);
}
