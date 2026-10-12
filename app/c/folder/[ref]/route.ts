import { NextRequest, NextResponse } from "next/server";
import { applyNoIndexHeaders } from "@/app/lib/robots";
import { activateFolder, findFolderByRef, readRememberedFolders } from "@/app/lib/folders";

/** Reopen a remembered folder from the home page: no Redis, the `/c` page checks the id. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const folder = findFolderByRef(readRememberedFolders(request.cookies), ref);
  const response = new NextResponse(null, { status: 303, headers: { Location: folder ? "/c" : "/" } });
  if (folder) activateFolder(request.cookies, response.cookies, folder.id);
  applyNoIndexHeaders(response.headers);
  return response;
}
