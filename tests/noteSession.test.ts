import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { startRedisRest } from "./helpers/redis-rest";
import { browserNoteSession } from "./helpers/noteSession";
import {
  MAX_SESSION_HANDLES,
  NOTE_BINDING_HEADER,
  applyHandleSessionCookie,
  countSessionHandles,
  findHandleForKey,
  sessionKeyCookieName,
  sessionSecret,
  signNoteBinding,
} from "../app/lib/noteSession";

function cookieJar() {
  const jar: Record<string, string> = {};
  const requestCookies = {
    get(name: string) {
      const value = jar[name];
      return value === undefined ? undefined : { value };
    },
    getAll() {
      return Object.entries(jar).map(([name, value]) => ({ name, value }));
    },
  };
  const responseCookies = {
    set(name: string, value: string) {
      if (!value) delete jar[name];
      else jar[name] = value;
    },
  };
  return { requestCookies, responseCookies };
}

test("reuses handle for the same key and caps session handles", () => {
  const { requestCookies, responseCookies } = cookieJar();
  applyHandleSessionCookie(responseCookies, requestCookies, "aaaaaaaaaaaa", "shared-key", false);
  applyHandleSessionCookie(responseCookies, requestCookies, "bbbbbbbbbbbb", "other-key", false);
  assert.equal(findHandleForKey(requestCookies, "shared-key"), "aaaaaaaaaaaa");

  for (let i = 0; i < MAX_SESSION_HANDLES + 5; i++) {
    const handle = `h${String(i).padStart(2, "0")}abcdefghij`;
    applyHandleSessionCookie(responseCookies, requestCookies, handle, `note-${i}`, false);
  }
  assert.equal(countSessionHandles(requestCookies), MAX_SESSION_HANDLES);
});

test("sessionSecret requires MARKER_REF_SECRET on Vercel production", () => {
  const prev = process.env.MARKER_REF_SECRET;
  const prevVercel = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "production";
  delete process.env.MARKER_REF_SECRET;
  try {
    assert.throws(() => sessionSecret(), /MARKER_REF_SECRET/);
  } finally {
    process.env.VERCEL_ENV = prevVercel;
    if (prev !== undefined) process.env.MARKER_REF_SECRET = prev;
    else delete process.env.MARKER_REF_SECRET;
  }
});

test("browser API routes reject missing or mismatched bindings", async () => {
  const fixture = await startRedisRest();
  process.env.KV_REST_API_URL = fixture.url;
  process.env.KV_REST_API_TOKEN = "synthetic";
  try {
    const content = await import("../app/api/content/route");
    const revision = await import("../app/api/revision/route");
    const meta = await import("../app/api/meta/route");
    const notes = await import("../app/lib/notes");

    await notes.writeNote("bind-a", "# A\n\n- [ ] Draft item");

    const noBinding = await content.GET(
      new NextRequest("http://localhost/api/content")
    );
    assert.equal(noBinding.status, 409);
    assert.equal((await noBinding.json()).code, "note_session_expired");

    const session = browserNoteSession("bind-a");
    const swapped = await content.GET(
      new NextRequest("http://localhost/api/content", {
        headers: {
          cookie: `${sessionKeyCookieName(session.handle)}=bind-b`,
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

    const drafts = await import("../app/api/drafts/route");
    const { reactionBlocks } = await import("../app/lib/responses");
    const note = await notes.readNote("bind-a");
    const blockId = reactionBlocks(note!.content)[0]!.id;
    const queryKey = await drafts.POST(
      new NextRequest("http://localhost/api/drafts?key=bind-a", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          if_rev: note!.rev,
          changes: [
            {
              block_id: blockId,
              selections: ["Draft item"],
              free_text: "",
            },
          ],
        }),
      })
    );
    assert.equal(queryKey.status, 200);
  } finally {
    await fixture.close();
  }
});
