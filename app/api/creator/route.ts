import { NextRequest, NextResponse } from "next/server";
import { applyNoIndexHeaders } from "@/app/lib/robots";
import {
  CREATOR_SORTS,
  clientFingerprint,
  listCreatorNotes,
  parseTagFilter,
  requestCreatorId,
  type CreatorSort,
} from "@/app/lib/creators";

function json(data: unknown, status = 200) {
  const response = NextResponse.json(data, { status });
  applyNoIndexHeaders(response.headers);
  return response;
}

const NOT_FOUND = { error: "Creator not found" };

/** A creator's folder: `Authorization: Bearer <creator_id>` or the `/c` cookie. One EVAL. */
export async function GET(request: NextRequest) {
  const id = requestCreatorId(request);
  if (!id) return json(NOT_FOUND, 404);

  const params = request.nextUrl.searchParams;
  const filter = parseTagFilter(params.getAll("tag"));
  if ("error" in filter) return json({ error: filter.error }, 400);

  const sort = (params.get("sort") ?? "updated") as CreatorSort;
  if (!CREATOR_SORTS.includes(sort)) {
    return json({ error: `sort must be one of: ${CREATOR_SORTS.join(", ")}` }, 400);
  }

  const rawCursor = params.get("cursor");
  const cursor = rawCursor === null ? 0 : Number(rawCursor);
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    return json({ error: "cursor must be a non-negative integer" }, 400);
  }

  const result = await listCreatorNotes(id, {
    tags: filter.tags,
    sort,
    cursor,
    client: clientFingerprint(request.headers),
  });
  if (result.status === "limited") return json({ error: "Too many failed creator lookups; try again later" }, 429);
  if (result.status === "not_found") return json(NOT_FOUND, 404);
  return json(result.listing);
}
