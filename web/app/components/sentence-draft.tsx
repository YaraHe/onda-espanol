"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { Explanation } from "../lib/explanation";

const SentenceDraftContext = createContext<{
  sentence: string;
  setSentence: (value: string) => void;
  explainedSentence: string;
  explanation: Explanation | null;
  setLearning: (sentence: string, explanation: Explanation) => void;
  clearLearning: () => void;
} | null>(null);

export function SentenceDraftProvider({ children }: { children: ReactNode }) {
  const [sentence, setSentence] = useState("");
  const [explainedSentence, setExplainedSentence] = useState("");
  const [explanation, setExplanation] = useState<Explanation | null>(null);

  function setLearning(nextSentence: string, nextExplanation: Explanation) {
    setExplainedSentence(nextSentence);
    setExplanation(nextExplanation);
  }

  function clearLearning() {
    setSentence("");
    setExplainedSentence("");
    setExplanation(null);
  }

  return (
    <SentenceDraftContext.Provider value={{ sentence, setSentence, explainedSentence, explanation, setLearning, clearLearning }}>
      {children}
    </SentenceDraftContext.Provider>
  );
}

export function useSentenceDraft() {
  const draft = useContext(SentenceDraftContext);
  if (!draft) throw new Error("SentenceDraftProvider is missing");
  return draft;
}
