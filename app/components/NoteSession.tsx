"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  NOTE_BINDING_HEADER,
  isNoteExpiredResponse,
  isNoteSwitchedResponse,
  noteApiHeaders,
  readJsonSafe,
  withPersistKeyUrl,
  type NoteBinding,
} from "../lib/noteClient";
import { NoteToast, type NoteToastKind } from "./NoteToast";

type NoteSessionContextValue = {
  binding: NoteBinding | null;
  noteFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

const NoteSessionContext = createContext<NoteSessionContextValue | null>(null);

export function NoteSessionProvider({
  binding,
  persistKey = null,
  children,
}: {
  binding: NoteBinding | null;
  /** Persistent document links may pass the key from the URL on API calls. */
  persistKey?: string | null;
  children: ReactNode;
}) {
  const [toast, setToast] = useState<NoteToastKind | null>(null);

  const noteFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? withPersistKeyUrl(input, persistKey)
          : input instanceof URL
            ? withPersistKeyUrl(input.toString(), persistKey)
            : input;
      const response = await fetch(url, {
        ...init,
        headers: noteApiHeaders(binding, init?.headers, persistKey),
      });
      if (response.status === 409) {
        const data = await readJsonSafe(response.clone());
        if (isNoteSwitchedResponse(response.status, data)) {
          setToast("switched");
        } else if (isNoteExpiredResponse(response.status, data)) {
          setToast("expired");
        }
      }
      return response;
    },
    [binding, persistKey]
  );

  const value = useMemo(
    () => ({ binding, noteFetch }),
    [binding, noteFetch]
  );

  return (
    <NoteSessionContext.Provider value={value}>
      {children}
      {toast && (
        <NoteToast
          kind={toast}
          onAction={() => window.location.reload()}
        />
      )}
    </NoteSessionContext.Provider>
  );
}

export function useNoteSession(): NoteSessionContextValue {
  const ctx = useContext(NoteSessionContext);
  if (!ctx) {
    return {
      binding: null,
      noteFetch: (input, init) =>
        fetch(input, {
          ...init,
          headers: noteApiHeaders(null, init?.headers),
        }),
    };
  }
  return ctx;
}

/** @internal for tests */
export { NOTE_BINDING_HEADER };
