"use client";

import { useEffect, useRef, useState } from "react";
import { CopyButton } from "./CopyButton";
import { primaryButtonClass, secondaryButtonClass } from "./controlStyles";
import { useAssetUrls } from "./NoteImage";

interface ContentEditorProps {
  content: string;
  onChange: (content: string) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  isNew: boolean;
  /** Whether this deployment can store images. */
  imagesEnabled?: boolean;
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Alt text from a file name: no extension, no markdown-significant brackets. */
function altFromName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[[\]\\\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter(file => file.type.startsWith("image/"));
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
  imagesEnabled = false,
}: ContentEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef(content);
  const [uploads, setUploads] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { register } = useAssetUrls() ?? {};
  const uploading = uploads > 0;

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  function replaceContent(next: string) {
    contentRef.current = next;
    onChange(next);
  }

  /** Inserts as its own paragraph at the caret, so the image renders as a block. */
  function insertAtCaret(snippet: string) {
    const current = contentRef.current;
    const textarea = textareaRef.current;
    const start = textarea && document.activeElement === textarea ? textarea.selectionStart : current.length;
    const end = textarea && document.activeElement === textarea ? textarea.selectionEnd : current.length;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const lead = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const trail = after === "" ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    replaceContent(before + lead + snippet + trail + after);
    const caret = before.length + lead.length + snippet.length + trail.length;
    setTimeout(() => {
      textarea?.setSelectionRange(caret, caret);
      textarea?.focus();
    }, 0);
  }

  async function uploadImage(file: File) {
    if (!IMAGE_TYPES.includes(file.type)) {
      setUploadError("Images must be PNG, JPEG, GIF, or WebP.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setUploadError("Images are limited to 5 MB.");
      return;
    }
    if (isNew) {
      setUploadError("Save this note first, then add images.");
      return;
    }
    setUploadError(null);
    setUploads(count => count + 1);
    let snippet: string | null = null;
    try {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_type: file.type, size: file.size }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) throw new Error("Save this note first, then add images.");
      if (!res.ok) throw new Error(data.error || "Couldn't add image. Try again.");
      snippet = `![${altFromName(file.name)}](marker-asset:${data.asset_id})`;
      insertAtCaret(snippet);
      const put = await fetch(data.upload_url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error("Upload failed. Try again.");
      register?.(data.asset_id, data.url);
    } catch (err) {
      if (snippet) {
        const current = contentRef.current;
        const at = current.indexOf(snippet);
        if (at >= 0) replaceContent(current.slice(0, at) + current.slice(at + snippet.length).replace(/^\n/, ""));
      }
      setUploadError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "Upload failed. Try again.");
    } finally {
      setUploads(count => count - 1);
    }
  }

  function uploadAll(files: File[]) {
    for (const file of files) void uploadImage(file);
  }
  const lastEscPressRef = useRef<number | null>(null);
  const [showEscHint, setShowEscHint] = useState(false);
  const escTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (!isSaving && !uploading) {
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
  }, [onSave, onCancel, isSaving, uploading]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const pastedImages = imagesEnabled ? imageFiles(e.clipboardData.files) : [];
    if (pastedImages.length > 0) {
      e.preventDefault();
      uploadAll(pastedImages);
      return;
    }

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
            {imagesEnabled && <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSaving}
                className={`px-4 py-2 ${secondaryButtonClass}`}
              >
                {uploading ? "Uploading…" : "Insert image"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={IMAGE_TYPES.join(",")}
                multiple
                hidden
                aria-label="Choose images"
                onChange={(e) => {
                  uploadAll(imageFiles(e.target.files));
                  e.target.value = "";
                }}
              />
            </>}
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
              disabled={isSaving || uploading}
              className={`px-4 py-2 ${primaryButtonClass}`}
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
      <div className="flex-1 flex justify-center overflow-auto">
        <div className="w-full max-w-3xl px-4 py-4">
          {uploadError && (
            <p role="alert" className="mb-2 px-4 text-sm text-danger">{uploadError}</p>
          )}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => onChange(e.target.value)}
            onPaste={handlePaste}
            onDragOver={(e) => {
              if (imagesEnabled && e.dataTransfer.types.includes("Files")) e.preventDefault();
            }}
            onDrop={(e) => {
              const dropped = imagesEnabled ? imageFiles(e.dataTransfer.files) : [];
              if (dropped.length === 0) return;
              e.preventDefault();
              uploadAll(dropped);
            }}
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
