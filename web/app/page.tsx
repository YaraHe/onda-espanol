"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./components/icons";
import { useAuth } from "./components/auth-provider";
import { PageShell } from "./components/page-shell";
import { SentenceEntry } from "./components/sentence-entry";
import { useSentenceDraft } from "./components/sentence-draft";
import { useUserSettings } from "./components/user-settings-provider";
import { ExplainError, fetchExplanation } from "./lib/explanation";
import { listPracticeRecords, recentSentences } from "./lib/practice-records";

export default function SelectPage() {
  const router = useRouter();
  const { userId } = useAuth();
  const { sentence, setSentence, setLearning } = useSentenceDraft();
  const { lang, status: dialectStatus, reload: reloadDialect } = useUserSettings();
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [recentStatus, setRecentStatus] = useState<"loading" | "ready" | "error">("loading");
  const [recentUserId, setRecentUserId] = useState<string | null>(null);
  const [hadInput, setHadInput] = useState(Boolean(sentence));

  useEffect(() => {
    let active = true;
    if (!userId) return () => { active = false; };
    void listPracticeRecords().then((records) => {
      if (active) {
        setRecent(recentSentences(records));
        setRecentUserId(userId);
        setRecentStatus("ready");
      }
    }).catch(() => { if (active) { setRecentUserId(userId); setRecentStatus("error"); } });
    return () => { active = false; };
  }, [userId]);

  async function reloadRecent() {
    setRecentStatus("loading");
    try {
      setRecent(recentSentences(await listPracticeRecords()));
      setRecentUserId(userId);
      setRecentStatus("ready");
    } catch {
      setRecentStatus("error");
    }
  }

  async function query() {
    const selected = sentence.trim();
    if (!selected || pending || !lang) return;
    setToast("");
    setPending(true);
    try {
      const explanation = await fetchExplanation(selected, lang);
      setLearning(selected, explanation);
      router.push("/explanation");
    } catch (cause) {
      setToast(cause instanceof ExplainError ? cause.message : "查询失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <PageShell title="选句" primary="select">
      <div className="page-stack select-page">
        <SentenceEntry onEdit={() => setHadInput(true)} />
        {(recentStatus !== "ready" || recent.length > 0 || hadInput) && <section className="section-block recent-practices" aria-label="最近练习">
          <h2 className="section-heading">最近练习</h2>
          {(recentStatus === "loading" || recentUserId !== userId) && <p className="supporting-copy" role="status">正在加载最近练习…</p>}
          {recentStatus === "error" && recentUserId === userId && <p className="supporting-copy" role="alert">最近练习加载失败 <button type="button" className="inline-retry" onClick={() => void reloadRecent()}>重试</button></p>}
          {recentStatus === "ready" && recentUserId === userId && (recent.length
            ? <ul className="recent-practice-list">{recent.map((item) => <li key={item}><button type="button" lang="es" onClick={() => { setSentence(item); setHadInput(true); }}>{item}</button></li>)}</ul>
            : <p className="empty-text">暂无</p>)}
        </section>}
        <div className="select-submit">
          {dialectStatus === "loading" && <p className="supporting-copy" role="status">正在加载方言设置…</p>}
          {dialectStatus === "error" && <p className="form-error" role="alert">方言设置加载失败 <button type="button" className="inline-retry" onClick={() => void reloadDialect()}>重试</button></p>}
          <button type="button" disabled={!sentence.trim() || pending || !lang} className={`primary-button${pending ? " is-loading" : ""}`} onClick={() => void query()}>
            <Icon name="search" />{pending ? "查询中…" : "查询"}
          </button>
        </div>
      </div>
      {toast && <div className="query-toast" role="alert">{toast}<button type="button" onClick={() => setToast("")}>关闭</button></div>}
    </PageShell>
  );
}
