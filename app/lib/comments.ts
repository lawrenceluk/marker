import { locate, quoteAt, type Anchor, type Location } from "./anchors";

export type Message = { author: "You" | "Agent"; text: string; at: number };
export type Thread = {
  id: string;
  anchor: Anchor;
  created_rev: number;
  resolved: boolean;
  messages: Message[];
};
export type LocatedThread = Thread & { location: Location };
export type CommentOperation =
  | { action: "create"; start: number; end: number; text: string }
  | { action: "reply"; id: string; text: string }
  | { action: "resolve" | "reopen"; id: string };

export function locateThreads(
  content: string,
  threads: Thread[],
): LocatedThread[] {
  return threads.map((thread) => ({
    ...thread,
    location: locate(content, thread.anchor),
  }));
}

/** Validate before any write. Limits bound the single comments field and Lua work. */
export function applyComments(
  content: string,
  threads: Thread[],
  operations: unknown,
  rev: number,
  author: Message["author"],
): Thread[] {
  if (
    !Array.isArray(operations) ||
    !operations.length ||
    operations.length > 50
  )
    throw new Error("Provide 1–50 operations");
  const next: Thread[] = structuredClone(threads);
  for (const op of operations) {
    if (!op || typeof op !== "object") throw new Error("Invalid operation");
    if (op.action === "create" || op.action === "reply") {
      if (
        typeof op.text !== "string" ||
        !op.text.trim() ||
        op.text.length > 4000
      )
        throw new Error("Comment text must be 1–4000 characters");
    }
    if (op.action === "create") {
      if (
        !Number.isInteger(op.start) ||
        !Number.isInteger(op.end) ||
        op.start < 0 ||
        op.end <= op.start ||
        op.end > content.length ||
        op.end - op.start > 8000
      )
        throw new Error("Invalid source selection (maximum 8000 characters)");
      if (next.length >= 100) throw new Error("Maximum 100 threads per note");
      const anchor = quoteAt(content, op.start, op.end);
      const location = locate(content, anchor);
      if (location.state !== "attached" || location.start !== op.start)
        throw new Error("Selection is ambiguous; select more surrounding text");
      next.push({
        id: crypto.randomUUID(),
        anchor,
        created_rev: rev,
        resolved: false,
        messages: [{ author, text: op.text.trim(), at: Date.now() }],
      });
    } else {
      const thread = next.find((t) => t.id === op.id);
      if (!thread) throw new Error("Thread not found");
      if (op.action === "reply") {
        if (thread.messages.length >= 100)
          throw new Error("Maximum 100 messages per thread");
        thread.messages.push({ author, text: op.text.trim(), at: Date.now() });
      } else if (op.action === "resolve" || op.action === "reopen")
        thread.resolved = op.action === "resolve";
      else throw new Error("Unknown operation");
    }
  }
  if (new TextEncoder().encode(JSON.stringify(next)).length > 256 * 1024)
    throw new Error("Comments exceed 256 KiB limit");
  return next;
}
