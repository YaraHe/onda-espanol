"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageShell, SectionHeading } from "../components/page-shell";
import { PronunciationAnnotation } from "../components/pronunciation-annotation";
import { useSentenceDraft } from "../components/sentence-draft";

export default function ExplanationPage() {
  const router = useRouter();
  const { explainedSentence, explanation, clearLearning } = useSentenceDraft();

  function changeSentence() {
    clearLearning();
    router.push("/");
  }

  return (
    <PageShell
      title="句子讲解"
      backHref="/"
      action={explanation ? <button type="button" className="primary-button" onClick={() => router.push("/practice")}>去跟读</button> : undefined}
    >
      {!explanation ? (
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
