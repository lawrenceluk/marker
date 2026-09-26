"use client";

import { useEffect, useRef, useState } from "react";
import { CopyButton } from "./CopyButton";
import { primaryButtonClass, secondaryButtonClass } from "./controlStyles";

interface ContentEditorProps {
  content: string;
  onChange: (content: string) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  isNew: boolean;
}

function isValidUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function ContentEditor({
  content,
  onChange,
  onSave,
  onCancel,
  isSaving,
  isNew,
}: ContentEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastEscPressRef = useRef<number | null>(null);
  const [showEscHint, setShowEscHint] = useState(false);
  const escTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (!isSaving) {
          onSave();
        }
        return;
      }

      if (e.key === "Escape") {
        const now = Date.now();
        const lastPress = lastEscPressRef.current;

        if (lastPress !== null && now - lastPress < 500) {
          e.preventDefault();
          if (!isSaving) {
            onCancel();
          }
          lastEscPressRef.current = null;
          setShowEscHint(false);
          if (escTimeoutRef.current) {
            clearTimeout(escTimeoutRef.current);
            escTimeoutRef.current = null;
          }
        } else {
          lastEscPressRef.current = now;
          setShowEscHint(true);
          if (escTimeoutRef.current) {
            clearTimeout(escTimeoutRef.current);
          }
          escTimeoutRef.current = setTimeout(() => {
            setShowEscHint(false);
            lastEscPressRef.current = null;
            escTimeoutRef.current = null;
          }, 500);
        }
      } else {
        lastEscPressRef.current = null;
        setShowEscHint(false);
        if (escTimeoutRef.current) {
          clearTimeout(escTimeoutRef.current);
          escTimeoutRef.current = null;
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (escTimeoutRef.current) {
        clearTimeout(escTimeoutRef.current);
      }
    };
  }, [onSave, onCancel, isSaving]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const hasSelection = selectionStart !== selectionEnd;

    if (!hasSelection) return;

    const pastedText = e.clipboardData.getData("text/plain").trim();
    if (!isValidUrl(pastedText)) return;

    e.preventDefault();

    const selectedText = content.substring(selectionStart, selectionEnd);
    const linkMarkdown = `[${selectedText}](${pastedText})`;

    const newContent =
      content.substring(0, selectionStart) +
      linkMarkdown +
      content.substring(selectionEnd);

    onChange(newContent);

    // Set cursor position after the inserted link
    setTimeout(() => {
      const newPosition = selectionStart + linkMarkdown.length;
      textarea.setSelectionRange(newPosition, newPosition);
      textarea.focus();
    }, 0);
  }

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      <div className="border-b border-hairline">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap justify-between items-center gap-2 px-4 py-4">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {isNew ? "New note" : "Editing note"} · Cmd/Ctrl+S to save
          </span>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={content} disabled={isSaving} />
            <button
              onClick={onCancel}
              disabled={isSaving}
              className={`px-4 py-2 ${secondaryButtonClass}`}
            >
              {showEscHint ? "Esc again to cancel" : "Cancel"}
            </button>
            <button
              onClick={onSave}
              disabled={isSaving}
              className={`px-4 py-2 ${primaryButtonClass}`}
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
      <div className="flex-1 flex justify-center overflow-auto">
        <div className="w-full max-w-3xl px-4 py-4">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => onChange(e.target.value)}
            onPaste={handlePaste}
            placeholder="Write markdown…"
            aria-label="Note content"
            disabled={isSaving}
            className="w-full min-h-[calc(100vh-80px)] px-4 py-3 border-0 bg-background text-foreground placeholder-zinc-400 dark:placeholder-zinc-500 font-mono text-sm focus:outline-none resize-none"
          />
        </div>
      </div>
    </div>
  );
}
