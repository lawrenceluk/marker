import { NextRequest, NextResponse } from "next/server";
import { applyNoIndexHeaders } from "@/app/lib/robots";
import { activateFolder, findFolderByRef, readRememberedFolders } from "@/app/lib/folders";
import { parseTagFilter } from "@/app/lib/creators";
import { folderHref } from "@/app/lib/folderHref";

/** Reopen a remembered folder from the home page: no Redis, the `/c` page checks the id. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const folder = findFolderByRef(readRememberedFolders(request.cookies), ref);
  const filter = parseTagFilter(request.nextUrl.searchParams.getAll("tag"));
  if ("error" in filter) {
    const response = NextResponse.json({ error: filter.error }, { status: 400 });
    applyNoIndexHeaders(response.headers);
    response.headers.set("Cache-Control", "no-store, private");
    return response;
  }
  const destination = folderHref(filter.tags, "updated");
  const response = new NextResponse(null, { status: 303, headers: { Location: folder ? destination : "/" } });
  if (folder) activateFolder(request.cookies, response.cookies, folder.id);
  applyNoIndexHeaders(response.headers);
  return response;
}
