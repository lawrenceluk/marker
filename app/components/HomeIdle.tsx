"use client";

import { CopyButton } from "./CopyButton";
import { KeyInput } from "./KeyInput";
import { MARKER_AGENT_PROMPT } from "../lib/agentPrompt";

interface HomeIdleProps {
  onSubmit: (key: string) => void;
  onRandomize: () => void;
  isLoading: boolean;
  isRandomizing?: boolean;
}

export function HomeIdle({
  onSubmit,
  onRandomize,
  isLoading,
  isRandomizing = false,
}: HomeIdleProps) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Marker
          </h1>
          <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            A private markdown pastebin. Each note lives at a secret key that is
            both its address and its password — no accounts. Use it in the browser,
            or from AI agents over a small HTTP API.
          </p>
        </div>
        <CopyButton
          text={MARKER_AGENT_PROMPT}
          label="Copy prompt for agent"
          copiedLabel="Copied agent prompt"
          className="w-full px-4 py-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
        />
      </div>
      <KeyInput
        onSubmit={onSubmit}
        onRandomize={onRandomize}
        isLoading={isLoading}
        isRandomizing={isRandomizing}
      />
    </div>
  );
}
