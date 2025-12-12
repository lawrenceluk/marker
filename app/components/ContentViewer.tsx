"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface ContentViewerProps {
  content: string;
  onEdit: () => void;
}

const markdownComponents: Components = {
  a: ({ node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
};

export function ContentViewer({ content, onEdit }: ContentViewerProps) {
  return (
    <div className="w-full">
      <div className="flex justify-end mb-4">
        <button
          onClick={onEdit}
          className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          Edit
        </button>
      </div>
      <div className="prose dark:prose-invert max-w-none break-words">
        {content ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {content}
          </ReactMarkdown>
        ) : (
          <p className="text-zinc-400 dark:text-zinc-500 italic">
            No content yet. Click Edit to add some.
          </p>
        )}
      </div>
    </div>
  );
}
