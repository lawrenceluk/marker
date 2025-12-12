"use client";

import { useEffect, useRef, useState } from "react";

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
    <div className="fixed inset-0 bg-white dark:bg-zinc-900 z-50 flex flex-col">
      <div className="flex justify-between items-center px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {isNew ? "Creating new content" : "Editing"} (Cmd/Ctrl+S to save)
        </span>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
          >
            {showEscHint ? "Esc to close" : "Cancel"}
          </button>
          <button
            onClick={onSave}
            disabled={isSaving}
            className="px-4 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 transition-colors"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
      <div className="flex-1 flex justify-center overflow-auto">
        <div className="w-full max-w-3xl px-4 py-4">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => onChange(e.target.value)}
            onPaste={handlePaste}
            placeholder="Enter your markdown content here..."
            disabled={isSaving}
            className="w-full min-h-[calc(100vh-80px)] px-4 py-3 border-0 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 font-mono text-sm focus:outline-none resize-none"
          />
        </div>
      </div>
    </div>
  );
}
