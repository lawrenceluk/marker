"use client";

import { Children, createContext, isValidElement, useContext, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { commentMarkup } from "../lib/comment-markup";
import type { LocatedThread } from "../lib/comments";
import { reactionBlocks, type ReactionBlock, type ResponseEntry } from "../lib/responses";

export type ResponseChange = { block_id: string; selections: string[]; free_text: string };
type ReactionContextValue = {
  blocks: Map<number, ReactionBlock>;
  responses: ResponseEntry[];
  drafts: Record<string, ResponseChange>;
  onReaction?: (change: ResponseChange, persist: boolean) => void;
  onTextFocus?: (focused: boolean) => void;
  busy: boolean;
};
const ReactionContext = createContext<ReactionContextValue | null>(null);

function answer(context: ReactionContextValue, id: string) {
  return context.drafts[id] ?? context.responses.find(entry => entry.block_id === id);
}

const markdownComponents: Components = {
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  li: function ReactionLi({ node, children, ...props }) {
    const context = useContext(ReactionContext);
    const block = context?.blocks.get(node?.position?.start.offset ?? -1);
    if (block?.kind !== "checkbox" || !context) return <li {...props}>{children}</li>;
    const selected = answer(context, block.id)?.selections.includes(block.label) ?? block.checked;
    const text = Children.toArray(children).filter(child => !(isValidElement(child) && child.type === "input"));
    return <li {...props} className="reaction-task"><label className="reaction-task-label">
      <span className="reaction-task-control">
        <input type="checkbox" checked={selected} disabled={context.busy || !context.onReaction} onChange={event => context.onReaction?.({ block_id: block.id, selections: event.target.checked ? [block.label] : [], free_text: "" }, true)} />
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10 4 4 8-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <span>{text}</span>
    </label></li>;
  },
  pre: function ReactionAsk({ node, children, ...props }) {
    const context = useContext(ReactionContext);
    const block = context?.blocks.get(node?.position?.start.offset ?? -1);
    if (block?.kind !== "ask" || !context) return <pre {...props}>{children}</pre>;
    const current = answer(context, block.id);
    const selections = current?.selections ?? [];
    const freeText = current?.free_text ?? "";
    return <fieldset className="reaction-ask" aria-label={block.question}>
      <legend>{block.question}</legend>
      <div className="reaction-options">
        {[...block.options, ...(block.other ? ["Other"] : [])].map(option => {
          const selected = selections.includes(option);
          return <button key={option} type="button" aria-pressed={selected} disabled={context.busy || !context.onReaction} className={selected ? "reaction-option selected" : "reaction-option"} onClick={() => {
            const next = block.mode === "single" ? (selected ? [] : [option]) : (selected ? selections.filter(item => item !== option) : [...selections, option]);
            context.onReaction?.({ block_id: block.id, selections: next, free_text: next.includes("Other") ? freeText : "" }, true);
          }}>{option}</button>;
        })}
      </div>
      {selections.includes("Other") && <input className="reaction-other" aria-label={`Other answer for ${block.question}`} placeholder="Add your answer…" maxLength={1000} value={freeText} onFocus={() => context.onTextFocus?.(true)} onBlur={() => context.onTextFocus?.(false)} onChange={event => context.onReaction?.({ block_id: block.id, selections, free_text: event.target.value }, false)} />}
      <p className="reaction-hint">{block.mode === "multi" ? "Choose any that fit" : "Choose one"}</p>
    </fieldset>;
  },
};

export function ContentViewer({ content, comments, responses = [], drafts = {}, onReaction, onTextFocus, busy = false }: {
  content: string;
  comments?: LocatedThread[];
  responses?: ResponseEntry[];
  drafts?: Record<string, ResponseChange>;
  onReaction?: (change: ResponseChange, persist: boolean) => void;
  onTextFocus?: (focused: boolean) => void;
  busy?: boolean;
}) {
  const blocks = useMemo(() => new Map(reactionBlocks(content).map(block => [block.offset, block])), [content]);
  const context: ReactionContextValue = { blocks, responses, drafts, onReaction, onTextFocus, busy };
  return <ReactionContext.Provider value={context}>
    <div className="w-full"><div className="prose max-w-none break-words">
      {content ? <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={comments ? [commentMarkup(content, comments)] : []} components={markdownComponents}>{content}</ReactMarkdown> :
        <p className="text-zinc-500 dark:text-zinc-400 italic">This note is empty. Edit it to add text.</p>}
    </div></div>
  </ReactionContext.Provider>;
}
