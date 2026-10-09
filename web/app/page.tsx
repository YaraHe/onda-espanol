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
import { listPersonalSentences, removePersonalSentence, type PersonalSentence } from "./lib/personal-sentences";
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
  const [personal, setPersonal] = useState<PersonalSentence[]>([]);
  const [personalStatus, setPersonalStatus] = useState<"loading" | "ready" | "error">("loading");
  const [personalUserId, setPersonalUserId] = useState<string | null>(null);
  const [showAllPersonal, setShowAllPersonal] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [personalNotice, setPersonalNotice] = useState("");
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

  useEffect(() => {
    let active = true;
    if (!userId) return () => { active = false; };
    void listPersonalSentences().then((items) => {
      if (active) { setPersonal(items); setPersonalUserId(userId); setPersonalStatus("ready"); }
    }).catch(() => {
      if (active) { setPersonalUserId(userId); setPersonalStatus("error"); }
    });
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

  async function reloadPersonal() {
    setPersonalStatus("loading");
    setPersonalNotice("");
    try {
      setPersonal(await listPersonalSentences());
      setPersonalUserId(userId);
      setPersonalStatus("ready");
    } catch {
      setPersonalStatus("error");
    }
  }

  async function removeSentence(item: PersonalSentence) {
    setRemovingId(item.id);
    setPersonalNotice("");
    try {
      await removePersonalSentence(item.id);
      setPersonal((current) => current.filter((entry) => entry.id !== item.id));
      setConfirmRemoveId(null);
      setPersonalNotice("已移出个人句子，已有练习记录仍可查看。");
    } catch {
      setPersonalNotice("移出失败，句子仍在个人集合中，请重试。");
    } finally {
      setRemovingId(null);
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
        <section className="section-block personal-sentences" aria-label="我的句子">
          <h2 className="section-heading">我的句子</h2>
          {(personalStatus === "loading" || personalUserId !== userId) && <p className="supporting-copy" role="status">正在加载个人句子…</p>}
          {personalStatus === "error" && personalUserId === userId && <p className="form-error" role="alert">个人句子加载失败。<button type="button" className="inline-retry" onClick={() => void reloadPersonal()}>重试</button></p>}
          {personalStatus === "ready" && personalUserId === userId && (personal.length
            ? <>
                <ul className="personal-sentence-list">{(showAllPersonal ? personal : personal.slice(0, 5)).map((item) => <li key={item.id}>
                  <button type="button" className="personal-recall" lang="es" onClick={() => { setSentence(item.sentence); setHadInput(true); }}>{item.sentence}</button>
                  <button type="button" className="personal-remove" disabled={removingId === item.id} aria-label={`移出 ${item.sentence}`} onClick={() => setConfirmRemoveId(item.id)}>{removingId === item.id ? "移出中…" : "移出"}</button>
                  {confirmRemoveId === item.id && <div className="personal-remove-confirm">
                    <p>从个人句子中移出？已有练习记录会保留。</p>
                    <button type="button" className="inline-retry" disabled={removingId === item.id} onClick={() => void removeSentence(item)}>确认移出</button>
                    <button type="button" className="inline-retry" onClick={() => setConfirmRemoveId(null)}>取消</button>
                  </div>}
                </li>)}</ul>
                {personal.length > 5 && <button type="button" className="inline-retry" onClick={() => setShowAllPersonal((value) => !value)}>{showAllPersonal ? "收起" : `查看全部 ${personal.length} 句`}</button>}
              </>
            : <p className="empty-text">还没有个人句子。输入或识别一句西语，查询成功后会自动收录。</p>)}
          {personalNotice && <p className="supporting-copy" role="status">{personalNotice}</p>}
        </section>
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
