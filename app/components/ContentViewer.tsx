"use client";

import { commentMarkup } from "../lib/comment-markup";
import type { LocatedThread } from "../lib/comments";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface ContentViewerProps {
  content: string;
  comments?: LocatedThread[];
}

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export function ContentViewer({ content, comments }: ContentViewerProps) {
  return (
    <div className="w-full">
      <div className="prose max-w-none break-words">
        {content ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={comments ? [commentMarkup(content, comments)] : []}
            components={markdownComponents}
          >
            {content}
          </ReactMarkdown>
        ) : (
          <p className="text-zinc-500 dark:text-zinc-400 italic">
            This note is empty. Edit it to add text.
          </p>
        )}
      </div>
    </div>
  );
}
