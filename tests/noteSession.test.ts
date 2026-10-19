import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { startRedisRest } from "./helpers/redis-rest";
import { browserNoteSession } from "./helpers/noteSession";
import {
  NOTE_BINDING_HEADER,
  sessionKeyCookieName,
  signNoteBinding,
} from "../app/lib/noteSession";

test("browser API routes reject missing or mismatched bindings", async () => {
  const fixture = await startRedisRest();
  process.env.KV_REST_API_URL = fixture.url;
  process.env.KV_REST_API_TOKEN = "synthetic";
  try {
    const content = await import("../app/api/content/route");
    const revision = await import("../app/api/revision/route");
    const meta = await import("../app/api/meta/route");
    const notes = await import("../app/lib/notes");

    await notes.writeNote("bind-a", "# A");

    const noBinding = await content.GET(
      new NextRequest("http://localhost/api/content")
    );
    assert.equal(noBinding.status, 400);

    const session = browserNoteSession("bind-a");
    const other = browserNoteSession("bind-b");
    const swapped = await content.GET(
      new NextRequest("http://localhost/api/content", {
        headers: {
          cookie: `${sessionKeyCookieName(other.handle)}=bind-a`,
          [NOTE_BINDING_HEADER]: session.binding,
        },
      })
    );
    assert.equal(swapped.status, 409);
    assert.equal((await swapped.json()).code, "note_switched");

    const wrongMac = await content.GET(
      new NextRequest("http://localhost/api/content", {
        headers: {
          ...session.headers,
          [NOTE_BINDING_HEADER]: signNoteBinding(session.handle, "wrong-key"),
        },
      })
    );
    assert.equal(wrongMac.status, 409);

    const ok = await content.GET(
      new NextRequest("http://localhost/api/content", {
        headers: session.headers,
      })
    );
    assert.equal(ok.status, 200);

    const revOk = await revision.GET(
      new NextRequest("http://localhost/api/revision", {
        headers: session.headers,
      })
    );
    assert.equal(revOk.status, 200);

    const seen = await meta.PATCH(
      new NextRequest("http://localhost/api/meta", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...session.headers },
        body: JSON.stringify({ seen: true, rev: 0 }),
      })
    );
    assert.equal(seen.status, 200);
  } finally {
    await fixture.close();
  }
});
