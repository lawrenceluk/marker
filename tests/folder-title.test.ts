import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { startRedisRest } from "./helpers/redis-rest";

const NAMED = "named_folder_creator_0123456789";
const UNNAMED = "unnamed_folder_creator_012345678";

test("folder page title follows creator_name, with generic fallbacks", async () => {
  const fixture = await startRedisRest();
  process.env.KV_REST_API_URL = fixture.url;
  process.env.KV_REST_API_TOKEN = "synthetic";
  process.env.VERCEL_ENV = "preview";
  try {
    const { GENERIC_FOLDER_TITLE, folderTitle, parseFolderParams } = await import("../app/c/folderPage");
    const { listCreatorNotes } = await import("../app/lib/creators");
    const contentApi = await import("../app/api/content/route");

    const post = (body: unknown) =>
      contentApi.POST(new NextRequest("http://localhost/api/content", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" },
        body: JSON.stringify(body),
      }));
    assert.equal((await post({ key: "folder-title-named", content: "# A", creator_id: NAMED, creator_name: "Lawrence's plans" })).status, 200);
    assert.equal((await post({ key: "folder-title-unnamed", content: "# B", creator_id: UNNAMED })).status, 200);

    const titleFor = async (id: string) => {
      const result = await listCreatorNotes(id, { client: "test" });
      return folderTitle(result.status === "ok" ? result.listing : null);
    };
    assert.equal(await titleFor(NAMED), "Lawrence's plans · Marker");
    assert.equal(await titleFor(UNNAMED), "Untitled folder · Marker");
    assert.equal(await titleFor("missing_folder_creator_0123456"), GENERIC_FOLDER_TITLE);
    assert.equal(folderTitle(null), GENERIC_FOLDER_TITLE);

    assert.deepEqual(parseFolderParams({}), { tags: [], sort: "updated", cursor: 0, filterError: null });
    assert.deepEqual(parseFolderParams({ tag: ["q4", "plans"], sort: "title", cursor: "50" }), {
      tags: ["plans", "q4"], sort: "title", cursor: 50, filterError: null,
    });
    const bad = parseFolderParams({ tag: "has space", sort: "bogus", cursor: "-3" });
    assert.deepEqual([bad.tags, bad.sort, bad.cursor], [[], "updated", 0]);
    assert.equal(typeof bad.filterError, "string");
  } finally {
    await fixture.close();
  }
});
