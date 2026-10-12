import type { CreatorSort } from "./creators";

export function folderHref(tags: string[], sort: CreatorSort, cursor = 0) {
  const params = new URLSearchParams();
  for (const tag of tags) params.append("tag", tag);
  if (sort !== "updated") params.set("sort", sort);
  if (cursor) params.set("cursor", String(cursor));
  const query = params.toString();
  return query ? `/c?${query}` : "/c";
}
