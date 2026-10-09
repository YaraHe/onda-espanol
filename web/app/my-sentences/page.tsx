"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/auth-provider";
import { PageShell } from "../components/page-shell";
import { useSentenceDraft } from "../components/sentence-draft";
import { listPersonalSentences, removePersonalSentence, type PersonalSentence } from "../lib/personal-sentences";

type LoadStatus = "loading" | "ready" | "error";

export default function MySentencesPage() {
  const router = useRouter();
  const { userId } = useAuth();
  const { setSentence } = useSentenceDraft();
  const [sentences, setSentences] = useState<PersonalSentence[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind: "status" | "error" } | null>(null);

  useEffect(() => {
    let active = true;
    if (!userId) return () => { active = false; };
    void listPersonalSentences().then((items) => {
      if (!active) return;
      setSentences(items);
      setLoadedUserId(userId);
      setStatus("ready");
      setConfirmRemoveId(null);
      setNotice(null);
    }).catch(() => {
      if (!active) return;
      setLoadedUserId(userId);
      setStatus("error");
    });

    return () => { active = false; };
  }, [userId, reloadKey]);

  function relearn(item: PersonalSentence) {
    setSentence(item.sentence);
    router.replace("/");
  }

  function retryLoad() {
    setStatus("loading");
    setLoadedUserId(null);
    setNotice(null);
    setReloadKey((key) => key + 1);
  }

  async function remove(item: PersonalSentence) {
    if (removingId) return;
    setRemovingId(item.id);
    setNotice(null);
    try {
      await removePersonalSentence(item.id);
      setSentences((current) => current.filter((entry) => entry.id !== item.id));
      setConfirmRemoveId(null);
      setNotice({ text: "已从个人句子中移出；已有练习记录仍可查看。", kind: "status" });
    } catch {
      setNotice({ text: "移出失败，句子仍在个人集合中。请重试。", kind: "error" });
    } finally {
      setRemovingId(null);
    }
  }

  const readyForUser = status === "ready" && loadedUserId === userId && Boolean(userId);

  return (
    <PageShell title="我的句子" backHref="/listening">
      <div className="page-stack my-sentences-page">
        {(status === "loading" || loadedUserId !== userId) && <p className="supporting-copy" role="status">正在加载个人句子…</p>}
        {status === "error" && loadedUserId === userId && <p className="form-error" role="alert">个人句子加载失败。<button type="button" className="inline-retry" onClick={retryLoad}>重试</button></p>}
        {readyForUser && <>
          <div className="my-sentences-summary">
            <p className="supporting-copy">成功讲解后收录</p>
            <p className="field-note">{sentences.length} 句</p>
          </div>
          {notice && <p className={notice.kind === "error" ? "form-error" : "supporting-copy"} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
          {!sentences.length ? <section className="section-block my-sentences-empty">
            <p className="empty-text">还没有收录的句子。去选句页输入一句西语，成功查看讲解后会自动收录。</p>
            <button type="button" className="plain-button" onClick={() => router.replace("/")}>去选句</button>
          </section> : <ul className="my-sentence-list" aria-label="个人句子">
            {sentences.map((item) => <li className="my-sentence-item" key={item.id}>
              <p className="my-sentence-text" lang="es">{item.sentence}</p>
              {item.translation && <p className="my-sentence-translation">{item.translation}</p>}
              <p className="my-sentence-date">{new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(new Date(item.created_at))} 收录</p>
              <div className="my-sentence-actions">
                <button type="button" className="plain-button" onClick={() => relearn(item)}>重新学习</button>
                <button type="button" className="my-sentence-remove" disabled={Boolean(removingId)} onClick={() => { setNotice(null); setConfirmRemoveId(item.id); }}>{removingId === item.id ? "移出中…" : "移出"}</button>
              </div>
              {confirmRemoveId === item.id && <div className="my-sentence-confirm" aria-label="确认移出句子">
                <p>从个人句子中移出？已有练习记录会保留，该句将不再用于听熟。</p>
                <button type="button" className="inline-retry" disabled={removingId === item.id} onClick={() => void remove(item)}>确认移出</button>
                <button type="button" className="inline-retry" disabled={removingId === item.id} onClick={() => setConfirmRemoveId(null)}>取消</button>
              </div>}
            </li>)}
          </ul>}
        </>}
      </div>
    </PageShell>
  );
}
