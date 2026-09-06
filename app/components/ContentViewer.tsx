"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface ContentViewerProps {
  content: string;
}

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export function ContentViewer({ content }: ContentViewerProps) {
  return (
    <div className="w-full">
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
            No content yet.
          </p>
        )}
      </div>
    </div>
  );
}
