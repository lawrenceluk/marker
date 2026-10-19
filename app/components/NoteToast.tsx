"use client";

export type NoteToastKind = "switched" | "expired";

const SESSION_COPY: Record<NoteToastKind, { message: string; action: string }> = {
  switched: { message: "Note changed in another tab", action: "Reopen" },
  expired: { message: "This note was closed", action: "Open" },
};

/** Shared session toast: square paper surface, ink rule, pill action only. */
export function NoteToast(
  props:
    | { kind: NoteToastKind; onAction: () => void }
    | {
        message: string;
        action?: { label: string; onClick: () => void };
        error?: boolean;
      },
) {
  if ("kind" in props) {
    const { message, action } = SESSION_COPY[props.kind];
    return (
      <div className="note-toast" role="status">
        <p className="note-toast-message">{message}</p>
        <button type="button" className="note-toast-pill" onClick={props.onAction}>
          {action}
        </button>
      </div>
    );
  }

  const { message, action, error } = props;
  return (
    <div
      className="note-toast"
      role={error ? "alert" : "status"}
      data-tone={error ? "error" : undefined}
    >
      <p className="note-toast-message">{message}</p>
      {action && (
        <button type="button" className="note-toast-pill" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
