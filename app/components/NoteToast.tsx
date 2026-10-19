"use client";

export type NoteToastKind = "switched" | "expired";

const COPY: Record<
  NoteToastKind,
  { message: string; action: string }
> = {
  switched: { message: "Note changed in another tab", action: "Reopen" },
  expired: { message: "This note was closed", action: "Open" },
};

/** Shared session toast: square paper surface, ink rule, pill action only. */
export function NoteToast({
  kind,
  onAction,
}: {
  kind: NoteToastKind;
  onAction: () => void;
}) {
  const { message, action } = COPY[kind];
  return (
    <div className="note-toast" role="status">
      <p className="note-toast-message">{message}</p>
      <button type="button" className="note-toast-pill" onClick={onAction}>
        {action}
      </button>
    </div>
  );
}
