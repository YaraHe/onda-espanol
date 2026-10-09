"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Explanation } from "../lib/explanation";

const SentenceDraftContext = createContext<{
  sentence: string;
  setSentence: (value: string) => void;
  explainedSentence: string;
  explanation: Explanation | null;
  learningOrigin: "select" | "records";
  recordReturnId: string | null;
  repeatPractice: { sentence: string; translation: string } | null;
  setLearning: (sentence: string, explanation: Explanation) => void;
  setRequestedExplanation: (explanation: Explanation) => void;
  prepareRecordExplanation: (sentence: string, recordId: string) => void;
  prepareRecordPractice: (sentence: string, translation: string, recordId: string) => void;
  clearLearning: () => void;
} | null>(null);

export function SentenceDraftProvider({ children }: { children: ReactNode }) {
  const [sentence, setSentence] = useState("");
  const [explainedSentence, setExplainedSentence] = useState("");
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [learningOrigin, setLearningOrigin] = useState<"select" | "records">("select");
  const [recordReturnId, setRecordReturnId] = useState<string | null>(null);
  const [repeatPractice, setRepeatPractice] = useState<{ sentence: string; translation: string } | null>(null);

  function setLearning(nextSentence: string, nextExplanation: Explanation) {
    setExplainedSentence(nextSentence);
    setExplanation(nextExplanation);
    setLearningOrigin("select");
    setRecordReturnId(null);
    setRepeatPractice(null);
  }

  function prepareRecordExplanation(nextSentence: string, recordId: string) {
    setSentence(nextSentence);
    setExplainedSentence(nextSentence);
    setExplanation(null);
    setLearningOrigin("records");
    setRecordReturnId(recordId);
    setRepeatPractice(null);
  }

  function prepareRecordPractice(nextSentence: string, translation: string, recordId: string) {
    setSentence(nextSentence);
    setExplainedSentence(nextSentence);
    setExplanation(null);
    setLearningOrigin("records");
    setRecordReturnId(recordId);
    setRepeatPractice({ sentence: nextSentence, translation });
  }

  const setRequestedExplanation = useCallback((nextExplanation: Explanation) => {
    setExplanation(nextExplanation);
  }, []);

  const clearLearning = useCallback(() => {
    setSentence("");
    setExplainedSentence("");
    setExplanation(null);
    setLearningOrigin("select");
    setRecordReturnId(null);
    setRepeatPractice(null);
  }, []);

  return (
    <SentenceDraftContext.Provider value={{ sentence, setSentence, explainedSentence, explanation, learningOrigin, recordReturnId, repeatPractice, setLearning, setRequestedExplanation, prepareRecordExplanation, prepareRecordPractice, clearLearning }}>
      {children}
    </SentenceDraftContext.Provider>
  );
}

export function useSentenceDraft() {
  const draft = useContext(SentenceDraftContext);
  if (!draft) throw new Error("SentenceDraftProvider is missing");
  return draft;
}
