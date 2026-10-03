"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

const SentenceDraftContext = createContext<{
  sentence: string;
  setSentence: (value: string) => void;
} | null>(null);

export function SentenceDraftProvider({ children }: { children: ReactNode }) {
  const [sentence, setSentence] = useState("");
  return (
    <SentenceDraftContext.Provider value={{ sentence, setSentence }}>
      {children}
    </SentenceDraftContext.Provider>
  );
}

export function useSentenceDraft() {
  const draft = useContext(SentenceDraftContext);
  if (!draft) throw new Error("SentenceDraftProvider is missing");
  return draft;
}
