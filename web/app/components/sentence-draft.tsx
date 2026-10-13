"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Explanation } from "../lib/explanation";

export type PracticeRecoveryContext = {
  taskId: string;
  sentence: string;
  translation: string;
  annotation: Explanation["annotation"] | null;
  origin: "select" | "records";
  recordReturnId: string | null;
  focus: string | null;
  focusWord: string | null;
  repeatPractice: boolean;
};

const SentenceDraftContext = createContext<{
  sentence: string;
  setSentence: (value: string) => void;
  explainedSentence: string;
  explanation: Explanation | null;
  learningOrigin: "select" | "records";
  recordReturnId: string | null;
  repeatPractice: { sentence: string; translation: string; focus: string | null; focusWord: string | null } | null;
  practiceTaskId: string | null;
  practiceContext: PracticeRecoveryContext | null;
  restorePracticeContext: (context: PracticeRecoveryContext) => void;
  setLearning: (sentence: string, explanation: Explanation) => void;
  setRequestedExplanation: (explanation: Explanation) => void;
  prepareRecordExplanation: (sentence: string, recordId: string) => void;
  prepareRecordPractice: (sentence: string, translation: string, recordId: string, focus: string | null, focusWord: string | null) => void;
  clearLearning: () => void;
} | null>(null);

export function SentenceDraftProvider({ children }: { children: ReactNode }) {
  const [sentence, setSentence] = useState("");
  const [explainedSentence, setExplainedSentence] = useState("");
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [learningOrigin, setLearningOrigin] = useState<"select" | "records">("select");
  const [recordReturnId, setRecordReturnId] = useState<string | null>(null);
  const [repeatPractice, setRepeatPractice] = useState<{ sentence: string; translation: string; focus: string | null; focusWord: string | null } | null>(null);
  const [practiceTaskId, setPracticeTaskId] = useState<string | null>(null);
  const [recoveredPractice, setRecoveredPractice] = useState<Pick<PracticeRecoveryContext, "translation" | "annotation" | "focus" | "focusWord"> | null>(null);

  function setLearning(nextSentence: string, nextExplanation: Explanation) {
    setPracticeTaskId(crypto.randomUUID());
    setExplainedSentence(nextSentence);
    setExplanation(nextExplanation);
    setLearningOrigin("select");
    setRecordReturnId(null);
    setRepeatPractice(null);
    setRecoveredPractice(null);
  }

  function prepareRecordExplanation(nextSentence: string, recordId: string) {
    setPracticeTaskId(crypto.randomUUID());
    setSentence(nextSentence);
    setExplainedSentence(nextSentence);
    setExplanation(null);
    setLearningOrigin("records");
    setRecordReturnId(recordId);
    setRepeatPractice(null);
    setRecoveredPractice(null);
  }

  function prepareRecordPractice(nextSentence: string, translation: string, recordId: string, focus: string | null, focusWord: string | null) {
    setPracticeTaskId(crypto.randomUUID());
    setSentence(nextSentence);
    setExplainedSentence(nextSentence);
    setExplanation(null);
    setLearningOrigin("records");
    setRecordReturnId(recordId);
    setRepeatPractice({ sentence: nextSentence, translation, focus, focusWord });
    setRecoveredPractice(null);
  }

  const setRequestedExplanation = useCallback((nextExplanation: Explanation) => {
    setExplanation(nextExplanation);
    setRecoveredPractice(null);
  }, []);

  const practiceContext: PracticeRecoveryContext | null = practiceTaskId
    ? (() => {
      const currentSentence = repeatPractice?.sentence ?? explainedSentence;
      const currentTranslation = repeatPractice?.translation ?? explanation?.translation ?? recoveredPractice?.translation;
      if (!currentSentence || !currentTranslation) return null;
      return {
        taskId: practiceTaskId,
        sentence: currentSentence,
        translation: currentTranslation,
        annotation: explanation?.annotation ?? recoveredPractice?.annotation ?? null,
        origin: learningOrigin,
        recordReturnId,
        focus: repeatPractice?.focus ?? recoveredPractice?.focus ?? null,
        focusWord: repeatPractice?.focusWord ?? recoveredPractice?.focusWord ?? null,
        repeatPractice: repeatPractice !== null,
      };
    })()
    : null;

  const restorePracticeContext = useCallback((context: PracticeRecoveryContext) => {
    setPracticeTaskId(context.taskId);
    setSentence(context.sentence);
    setExplainedSentence(context.sentence);
    setExplanation(null);
    setLearningOrigin(context.origin);
    setRecordReturnId(context.recordReturnId);
    setRepeatPractice(context.repeatPractice
      ? { sentence: context.sentence, translation: context.translation, focus: context.focus, focusWord: context.focusWord }
      : null);
    setRecoveredPractice({ translation: context.translation, annotation: context.annotation, focus: context.focus, focusWord: context.focusWord });
  }, []);

  const clearLearning = useCallback(() => {
    setPracticeTaskId(null);
    setSentence("");
    setExplainedSentence("");
    setExplanation(null);
    setLearningOrigin("select");
    setRecordReturnId(null);
    setRepeatPractice(null);
    setRecoveredPractice(null);
  }, []);

  return (
    <SentenceDraftContext.Provider value={{ sentence, setSentence, explainedSentence, explanation, learningOrigin, recordReturnId, repeatPractice, practiceTaskId, practiceContext, restorePracticeContext, setLearning, setRequestedExplanation, prepareRecordExplanation, prepareRecordPractice, clearLearning }}>
      {children}
    </SentenceDraftContext.Provider>
  );
}

export function useSentenceDraft() {
  const draft = useContext(SentenceDraftContext);
  if (!draft) throw new Error("SentenceDraftProvider is missing");
  return draft;
}
