import { NextRequest, NextResponse } from "next/server";
import { applyNoIndexHeaders } from "@/app/lib/robots";
import { activateFolder, findFolderByRef, readRememberedFolders } from "@/app/lib/folders";
import { creatorHash, folderRef, parseTagFilter } from "@/app/lib/creators";
import { CREATOR_COOKIE, normalizeCreatorId } from "@/app/lib/creatorId";
import { folderHref } from "@/app/lib/folderHref";

/** Resolve held credentials, or ask for this folder's id. A ref alone never authorizes a listing. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const folder = findFolderByRef(readRememberedFolders(request.cookies), ref);
  const active = normalizeCreatorId(request.cookies.get(CREATOR_COOKIE)?.value);
  const id = folder?.id ?? (active && folderRef(creatorHash(active)) === ref ? active : null);
  const filter = parseTagFilter(request.nextUrl.searchParams.getAll("tag"));
  if ("error" in filter) {
    const response = NextResponse.json({ error: filter.error }, { status: 400 });
    applyNoIndexHeaders(response.headers);
    response.headers.set("Cache-Control", "no-store, private");
    return response;
  }
  const destination = folderHref(filter.tags, "updated");
  const gate = new URLSearchParams({ folder: ref });
  for (const tag of filter.tags) gate.append("tag", tag);
  const response = new NextResponse(null, { status: 303, headers: { Location: id ? destination : `/c?${gate}` } });
  if (id) activateFolder(request.cookies, response.cookies, id);
  applyNoIndexHeaders(response.headers);
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}
