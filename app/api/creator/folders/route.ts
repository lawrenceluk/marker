import { NextRequest, NextResponse } from "next/server";
import { applyNoIndexHeaders } from "@/app/lib/robots";
import { clientFingerprint } from "@/app/lib/creators";
import { findFolderByRef, forgetFolder, readRememberedFolders, summarizeFolders } from "@/app/lib/folders";

/** Remembered folders for the home page, when it is reached client-side. At most one EVAL. */
export async function GET(request: NextRequest) {
  const folders = await summarizeFolders(readRememberedFolders(request.cookies), clientFingerprint(request.headers));
  const response = NextResponse.json({ folders });
  applyNoIndexHeaders(response.headers);
  return response;
}

/** Forget one remembered folder: home-page form (`forget=<ref>`, redirects to `/`) or JSON `{forget}`. */
export async function POST(request: NextRequest) {
  const isForm = !(request.headers.get("content-type") ?? "").includes("application/json");
  let ref: unknown;
  try {
    ref = isForm ? (await request.formData()).get("forget") : (await request.json())?.forget;
  } catch {
    ref = null;
  }
  const folder = typeof ref === "string" ? findFolderByRef(readRememberedFolders(request.cookies), ref) : null;
  const response = isForm
    ? new NextResponse(null, { status: 303, headers: { Location: "/" } })
    : NextResponse.json(folder ? { success: true } : { error: "Folder not found" }, { status: folder ? 200 : 404 });
  if (folder) forgetFolder(request.cookies, response.cookies, folder.id);
  applyNoIndexHeaders(response.headers);
  return response;
}
