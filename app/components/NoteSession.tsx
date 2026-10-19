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
  isNoteSwitchedResponse,
  noteApiHeaders,
  readJsonSafe,
  type NoteBinding,
} from "../lib/noteClient";

type NoteSessionContextValue = {
  binding: NoteBinding | null;
  noteFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

const NoteSessionContext = createContext<NoteSessionContextValue | null>(null);

export function NoteSessionProvider({
  binding,
  children,
}: {
  binding: NoteBinding | null;
  children: ReactNode;
}) {
  const [switched, setSwitched] = useState(false);

  const noteFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetch(input, {
        ...init,
        headers: noteApiHeaders(binding, init?.headers),
      });
      if (response.status === 409) {
        const data = await readJsonSafe(response.clone());
        if (isNoteSwitchedResponse(response.status, data)) {
          setSwitched(true);
        }
      }
      return response;
    },
    [binding]
  );

  const value = useMemo(
    () => ({ binding, noteFetch }),
    [binding, noteFetch]
  );

  return (
    <NoteSessionContext.Provider value={value}>
      {children}
      {switched && (
        <div className="note-toast" role="status">
          <span>Note changed in another tab</span>
          <button
            type="button"
            className="note-toast-pill"
            onClick={() => window.location.reload()}
          >
            Reopen
          </button>
        </div>
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
