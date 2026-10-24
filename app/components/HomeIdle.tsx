"use client";

import { CopyButton } from "./CopyButton";
import { KeyInput } from "./KeyInput";
import { secondaryButtonClass } from "./controlStyles";
import { HOME_AGENT_PROMPT } from "../lib/agentPrompt";
import type { FolderSummary } from "../lib/folders";
import { RememberedFolders } from "./RememberedFolders";
import { PreviewTag } from "./Preview";

interface HomeIdleProps {
  onSubmit: (key: string) => void;
  onRandomize: () => void;
  isLoading: boolean;
  isRandomizing?: boolean;
  folders?: FolderSummary[];
}

export function HomeIdle({
  onSubmit,
  onRandomize,
  isLoading,
  isRandomizing = false,
  folders,
}: HomeIdleProps) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-8">
      <PreviewTag className="self-end" />
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">
            Marker
          </h1>
          <p className="text-sm leading-relaxed text-muted">
            A private markdown pastebin. Each note lives at a secret key that is
            both its address and its password — no accounts. Use it in the browser,
            or from AI agents over a small HTTP API; agents can read the instructions at{" "}
            <a href="/llms.txt" className="underline underline-offset-2">/llms.txt</a>.
          </p>
        </div>
        <CopyButton
          text={HOME_AGENT_PROMPT}
          label="Copy agent prompt"
          copiedLabel="Copied agent prompt"
          className={`w-full ${secondaryButtonClass("md")}`}
        />
      </div>
      <KeyInput
        onSubmit={onSubmit}
        onRandomize={onRandomize}
        isLoading={isLoading}
        isRandomizing={isRandomizing}
      />
      <RememberedFolders initial={folders} />
    </div>
  );
}
