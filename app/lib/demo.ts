import { remapComments } from "./remap-comments";
import { redis } from "./redis";
import { storagePrefix } from "./namespace";
import { applyComments } from "./comments";

export const DEMO_KEY = "commenting-demo-v1";
const CONTENT = `# A plan we can work on together

Try selecting **a little text** and leaving a comment. On your phone, long-press a word, adjust the handles, then tap Comment on selection.

## The launch plan

Invite five people to try the first version.

Keep the first week quiet so we can learn what feels awkward.

Write a short guide after the first round of feedback.

## Try the agent flow

Tell Point One to check the comments on this preview. It can read open threads, reply as Agent, and edit the note and resolve a thread in one revision-checked request.

This is a shared synthetic sandbox. Everyone with this demo link can edit it. It expires after seven days; opening it after expiry creates a fresh demo.
`;

/** Create once, atomically, in Preview only. Never reset an existing demo. */
export async function ensurePreviewDemo(key: string) {
  if (process.env.VERCEL_ENV !== "preview" || key !== DEMO_KEY) return;
  const oldContent = CONTENT + "\nThe obsolete launch date is Friday.\n";
  let comments = applyComments(
    oldContent,
    [],
    [
      {
        action: "create",
        start: oldContent.indexOf("Invite five people"),
        end: oldContent.indexOf("Invite five people") + 18,
        text: "Should we start with three people instead?",
      },
      {
        action: "create",
        start: oldContent.indexOf("short guide"),
        end: oldContent.indexOf("short guide") + 11,
        text: "Keep the guide brief.",
      },
      {
        action: "create",
        start: oldContent.indexOf("obsolete launch date"),
        end: oldContent.indexOf("obsolete launch date") + 20,
        text: "This date needs another look.",
      },
    ],
    1,
    "You",
  );
  comments = applyComments(
    oldContent,
    comments,
    [
      {
        action: "reply",
        id: comments[0].id,
        text: "Three sounds reasonable. Leave this open until you choose.",
      },
      {
        action: "reply",
        id: comments[1].id,
        text: "Agreed — a short guide is in the plan.",
      },
      { action: "resolve", id: comments[1].id },
    ],
    1,
    "Agent",
  );
  comments = remapComments(oldContent, CONTENT, comments);
  const prefix = storagePrefix();
  await redis.eval(
    `
if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'content', ARGV[1], 'comments', ARGV[2], 'rev', '1', 'created_at', ARGV[3], 'updated_at', ARGV[3])
redis.call('EXPIRE', KEYS[1], 604800)
return 1
`,
    [`${prefix}note:${key}`, `${prefix}content:${key}`],
    [CONTENT, JSON.stringify(comments), String(Date.now())],
  );
}
