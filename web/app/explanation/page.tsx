"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageShell, SectionHeading } from "../components/page-shell";
import { PronunciationAnnotation } from "../components/pronunciation-annotation";
import { useSentenceDraft } from "../components/sentence-draft";
import { useUserSettings } from "../components/user-settings-provider";
import { ExplainError, fetchExplanation } from "../lib/explanation";

export default function ExplanationPage() {
  const router = useRouter();
  const { explainedSentence, explanation, learningOrigin, recordReturnId, setRequestedExplanation, clearLearning } = useSentenceDraft();
  const { lang, status: dialectStatus, reload: reloadDialect } = useUserSettings();
  const [retry, setRetry] = useState(0);
  const [queryState, setQueryState] = useState<"loading" | "error">("loading");
  const [queryError, setQueryError] = useState("");

  useEffect(() => {
    if (learningOrigin === "select" || !explainedSentence || explanation || !lang) return;
    const controller = new AbortController();
    let active = true;
    void fetchExplanation(explainedSentence, lang, controller.signal).then((result) => {
      if (active) setRequestedExplanation(result);
    }).catch((cause) => {
      if (!active) return;
      setQueryError(cause instanceof ExplainError ? cause.message : "查询失败，请稍后重试");
      setQueryState("error");
    });
    return () => { active = false; controller.abort(); };
  }, [explainedSentence, explanation, lang, learningOrigin, retry, setRequestedExplanation]);

  function changeSentence() {
    clearLearning();
    router.push("/");
  }

  return (
    <PageShell
      title="句子讲解"
      backHref={learningOrigin === "library" ? "/library" : learningOrigin === "records" && recordReturnId ? `/records/detail?id=${encodeURIComponent(recordReturnId)}` : "/"}
      action={explanation ? <button type="button" className="primary-button" onClick={() => router.push("/practice")}>去跟读</button> : undefined}
    >
      {!explanation && learningOrigin !== "select" && explainedSentence ? (
        <div className="page-stack">
          <section className="section-block">
            <SectionHeading>原句</SectionHeading>
            <p className="learning-sentence" lang="es">{explainedSentence}</p>
          </section>
          {dialectStatus === "loading" ? <p className="supporting-copy" role="status">正在加载方言设置…</p>
            : dialectStatus === "error" ? <p className="form-error" role="alert">方言设置加载失败 <button type="button" className="inline-retry" onClick={() => void reloadDialect()}>重试</button></p>
            : queryState === "loading"
            ? <p className="supporting-copy" role="status">正在生成讲解…</p>
            : <p className="form-error" role="alert">{queryError} <button type="button" className="inline-retry" onClick={() => { setQueryState("loading"); setQueryError(""); setRetry((value) => value + 1); }}>重试</button></p>}
        </div>
      ) : !explanation ? (
        <div className="section-block">
          <p className="empty-text">先在选句页查询一句西语，讲解会显示在这里。</p>
          <Link href="/" className="inline-link">去选句</Link>
        </div>
      ) : (
        <div className="page-stack explanation-page">
          <section className="section-block">
            <SectionHeading>原句</SectionHeading>
            <p className="learning-sentence" lang="es">{explainedSentence}</p>
            <PronunciationAnnotation annotation={explanation.annotation} />
          </section>

          <section className="section-block understanding-surface">
            <div className="section-block">
              <SectionHeading>中文翻译</SectionHeading>
              <p className="translation-text">{explanation.translation}</p>
            </div>
            {explanation.memoryTip ? (
              <div className="section-block">
                <SectionHeading>核心记忆点</SectionHeading>
                <p className="memory-text">{explanation.memoryTip}</p>
              </div>
            ) : <p className="missing-part">核心记忆点：该部分未生成</p>}
          </section>

          <details className="grammar-details">
            <summary className="grammar-summary">语法分析 <span aria-hidden="true">⌄</span></summary>
            <div className="grammar-content">
              <div><SectionHeading>时态·语式</SectionHeading><p>{explanation.tenseMood}</p></div>
              <div>
                <SectionHeading>动词变位</SectionHeading>
                {explanation.verbs.length ? (
                  <ul className="verb-list">
                    {explanation.verbs.map((verb, index) => (
                      <li key={`${verb.form}-${index}`}>
                        <strong lang="es">{verb.form}</strong>（原形 <span lang="es">{verb.infinitive}</span>） · {verb.person}<br />{verb.notes}
                      </li>
                    ))}
                  </ul>
                ) : <p>本句无动词</p>}
              </div>
              <div><SectionHeading>语序结构</SectionHeading><p>{explanation.structure}</p></div>
              <div><SectionHeading>中英对比</SectionHeading><p>{explanation.compare || "该部分未生成"}</p></div>
            </div>
          </details>
          <button type="button" className="plain-button" onClick={changeSentence}>换一句</button>
        </div>
      )}
    </PageShell>
  );
}
