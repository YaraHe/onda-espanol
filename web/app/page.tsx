"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./components/icons";
import { useAuth } from "./components/auth-provider";
import { PageShell } from "./components/page-shell";
import { SentenceEntry } from "./components/sentence-entry";
import { useSentenceDraft } from "./components/sentence-draft";
import { useUserSettings } from "./components/user-settings-provider";
import { ExplainError, fetchExplanation } from "./lib/explanation";
import { prewarmBackend } from "./lib/backend-health";
import { clearExplainPresentationTiming, markExplainQueryStart, markExplainResultReady } from "./lib/explain-presentation-timing";
import { listRecentPracticeSentences } from "./lib/practice-records";
import { isSentenceInputWithinLimits } from "./lib/sentence-input";

export default function SelectPage() {
  const router = useRouter();
  const { userId } = useAuth();
  const { sentence, setSentence, setLearning } = useSentenceDraft();
  const { lang, status: dialectStatus, reload: reloadDialect } = useUserSettings();
  const [pending, setPending] = useState(false);
  const pendingRequest = useRef(false);
  const [longWait, setLongWait] = useState(false);
  const [toast, setToast] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [recentStatus, setRecentStatus] = useState<"loading" | "ready" | "error">("loading");
  const [recentUserId, setRecentUserId] = useState<string | null>(null);
  const [hadInput, setHadInput] = useState(Boolean(sentence));

  useEffect(() => {
    if (userId) prewarmBackend();
  }, [userId]);

  useEffect(() => {
    let active = true;
    if (!userId) return () => { active = false; };
    void listRecentPracticeSentences().then((sentences) => {
      if (active) {
        setRecent(sentences);
        setRecentUserId(userId);
        setRecentStatus("ready");
      }
    }).catch(() => { if (active) { setRecentUserId(userId); setRecentStatus("error"); } });
    return () => { active = false; };
  }, [userId]);

  async function reloadRecent() {
    setRecentStatus("loading");
    try {
      setRecent(await listRecentPracticeSentences());
      setRecentUserId(userId);
      setRecentStatus("ready");
    } catch {
      setRecentStatus("error");
    }
  }

  async function query() {
    const selected = sentence.trim();
    if (!selected || !isSentenceInputWithinLimits(sentence) || pendingRequest.current || !lang) return;
    pendingRequest.current = true;
    setToast("");
    setPending(true);
    setLongWait(false);
    markExplainQueryStart();
    const waitHint = window.setTimeout(() => setLongWait(true), 8_000);
    try {
      const explanation = await fetchExplanation(selected, lang);
      setLearning(selected, explanation);
      markExplainResultReady();
      router.push("/explanation");
    } catch (cause) {
      clearExplainPresentationTiming();
      setToast(cause instanceof ExplainError ? cause.message : "查询失败，请稍后重试");
    } finally {
      window.clearTimeout(waitHint);
      pendingRequest.current = false;
      setPending(false);
      setLongWait(false);
    }
  }

  const renderSubmit = (viewport: "desktop" | "mobile") => (
    <div className={`select-submit select-submit-${viewport}`}>
      {dialectStatus === "loading" && <p className="supporting-copy" role="status">正在加载方言设置…</p>}
      {dialectStatus === "error" && <p className="form-error" role="alert">方言设置加载失败 <button type="button" className="inline-retry" onClick={() => void reloadDialect()}>重试</button></p>}
      <button type="button" disabled={!sentence.trim() || !isSentenceInputWithinLimits(sentence) || pending || !lang} className={`primary-button${pending ? " is-loading" : ""}`} onClick={() => void query()}>
        <Icon name="search" />{pending ? "查询中…" : "查询"}
      </button>
      {pending && <p className="supporting-copy query-wait-state" role="status">
        {longWait ? "仍在等待讲解结果。首次访问时，服务也可能需要一些时间唤醒。" : "正在获取讲解，请稍候…"}
      </p>}
    </div>
  );

  return (
    <PageShell title="选句" primary="select">
      <div className="page-stack select-page">
        <SentenceEntry onEdit={() => setHadInput(true)} />
        {renderSubmit("desktop")}
        {(recentStatus !== "ready" || recent.length > 0 || hadInput) && <section className="section-block recent-practices" aria-label="最近练习">
          <h2 className="section-heading">最近练习</h2>
          {(recentStatus === "loading" || recentUserId !== userId) && <p className="supporting-copy" role="status">正在加载最近练习…</p>}
          {recentStatus === "error" && recentUserId === userId && <p className="supporting-copy" role="alert">最近练习加载失败 <button type="button" className="inline-retry" onClick={() => void reloadRecent()}>重试</button></p>}
          {recentStatus === "ready" && recentUserId === userId && (recent.length
            ? <ul className="recent-practice-list">{recent.map((item) => <li key={item}><button type="button" lang="es" onClick={() => { setSentence(item); setHadInput(true); }}>{item}</button></li>)}</ul>
            : <p className="empty-text">暂无</p>)}
        </section>}
        {renderSubmit("mobile")}
      </div>
      {toast && <div className="query-toast" role="alert"><span>{toast}</span><div className="query-toast-actions"><button type="button" onClick={() => void query()}>重试</button><button type="button" onClick={() => setToast("")}>关闭</button></div></div>}
    </PageShell>
  );
}
