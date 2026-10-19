"use client";

import type { ReactNode } from "react";

export function Toast({
  message,
  action,
}: {
  message: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="toast-host" role="status" aria-live="polite">
      <div className="toast">
        <span className="toast-message">{message}</span>
        {action && (
          <button type="button" className="toast-action" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
