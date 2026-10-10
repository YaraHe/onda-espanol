"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/auth-provider";
import { PageShell } from "../components/page-shell";
import { useSentenceDraft } from "../components/sentence-draft";
import { filterPersonalSentences, groupCheckboxAriaChecked, groupPersonalSentences, selectionState, toggleGroupSelection, toggleSentenceSelection } from "../lib/sentence-library.mjs";
import {
  defaultListeningPreferences, readListeningPreferences, saveListeningPreferences,
  type ListeningPreferences,
} from "../lib/listening-preferences";
import { makePersonalListeningPool, validCustomSelection } from "../lib/listening-playlist";
import { listPersonalSentences, removePersonalSentence, type PersonalSentence } from "../lib/personal-sentences";

type LoadStatus = "loading" | "ready" | "error";
type SelectionMark = "none" | "mixed" | "all";
type SentenceDay = { key: string; label: string; sentences: PersonalSentence[] };
type SentenceMonth = { key: string; label: string; days: SentenceDay[] };

function GroupMark({ state, label, onChange }: { state: SelectionMark; label: string; onChange: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (inputRef.current) inputRef.current.indeterminate = state === "mixed"; }, [state]);
  return <input ref={inputRef} type="checkbox" aria-label={label} aria-checked={groupCheckboxAriaChecked(state)} checked={state === "all"} onChange={onChange} />;
}

function formatCollectedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "收录日期未知" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

export default function MySentencesPage() {
  const router = useRouter();
  const { userId } = useAuth();
  const { setSentence } = useSentenceDraft();
  const [mode, setMode] = useState<"manage" | "select">("manage");
  const [modeReady, setModeReady] = useState(false);
  const [sentences, setSentences] = useState<PersonalSentence[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [draftSelection, setDraftSelection] = useState<Set<string>>(new Set());
  const [preferences, setPreferences] = useState<ListeningPreferences>(defaultListeningPreferences);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "error">("idle");
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind: "status" | "error" } | null>(null);

  useEffect(() => {
    let active = true;
    const nextMode = new URLSearchParams(window.location.search).get("mode") === "select" ? "select" : "manage";
    queueMicrotask(() => {
      if (!active) return;
      setMode(nextMode);
      setModeReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (!userId || !modeReady) return () => { active = false; };
    const sentenceRequest = listPersonalSentences();
    const preferenceRequest = mode === "select" ? readListeningPreferences(userId) : Promise.resolve(defaultListeningPreferences);
    void Promise.all([sentenceRequest, preferenceRequest]).then(([items, saved]) => {
      if (!active) return;
      const pool = makePersonalListeningPool(items);
      setSentences(items);
      setPreferences(saved);
      setDraftSelection(new Set(validCustomSelection(saved.customSelection, pool)));
      setExpandedMonths((current) => current.size ? current : new Set(groupPersonalSentences(items).slice(0, 1).map((group) => group.key)));
      setExpandedDays((current) => current.size ? current : new Set(groupPersonalSentences(items).flatMap((group) => group.days.slice(0, 1).map((day) => day.key))));
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
  }, [userId, reloadKey, mode, modeReady]);

  const filtered = useMemo(() => {
    return filterPersonalSentences(sentences, query);
  }, [query, sentences]);
  const groups = useMemo(() => groupPersonalSentences(filtered) as SentenceMonth[], [filtered]);
  const readyForUser = modeReady && status === "ready" && loadedUserId === userId && Boolean(userId);
  const selectedCount = draftSelection.size;
  const isSearching = Boolean(query.trim());

  function toggleSet(setter: Dispatch<SetStateAction<Set<string>>>, key: string) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleGroup(keys: string[]) {
    setDraftSelection((current) => toggleGroupSelection(current, keys));
  }

  function retryLoad() {
    setStatus("loading");
    setLoadedUserId(null);
    setNotice(null);
    setReloadKey((key) => key + 1);
  }

  async function confirmSelection() {
    if (!userId || saveStatus === "saving") return;
    setSaveStatus("saving");
    setNotice(null);
    const validIds = validCustomSelection([...draftSelection], makePersonalListeningPool(sentences));
    try {
      await saveListeningPreferences(userId, { ...preferences, scope: "custom", customSelection: validIds });
      router.replace("/listening");
    } catch {
      setSaveStatus("error");
      setNotice({ kind: "error", text: "选择尚未保存，请重试。" });
    }
  }

  function relearn(item: PersonalSentence) {
    setSentence(item.sentence);
    router.replace("/");
  }

  async function remove(item: PersonalSentence) {
    if (removingId) return;
    setRemovingId(item.id);
    setNotice(null);
    try {
      await removePersonalSentence(item.id);
      setSentences((current) => current.filter((entry) => entry.id !== item.id));
      setDraftSelection((current) => { const next = new Set(current); next.delete(item.id); return next; });
      setConfirmRemoveId(null);
      setNotice({ text: "已从个人句子中移出；已有练习记录仍可查看。", kind: "status" });
    } catch {
      setNotice({ text: "移出失败，句子仍在个人集合中。请重试。", kind: "error" });
    } finally {
      setRemovingId(null);
    }
  }

  const action = mode === "select" ? <div className="sentence-library-action">
    <button type="button" className="secondary-button" disabled={saveStatus === "saving"} onClick={() => router.replace("/listening")}>取消</button>
    <button type="button" className="primary-button" disabled={!readyForUser || saveStatus === "saving"} onClick={() => void confirmSelection()}>
      {saveStatus === "saving" ? "正在保存…" : `确认所选 · ${selectedCount} 句`}
    </button>
  </div> : undefined;

  return (
    <PageShell title={mode === "select" ? "选择句子" : "我的句子"} backHref="/listening" action={action}>
      <div className={`page-stack sentence-library-page ${mode === "select" ? "is-select-mode" : "is-manage-mode"}`}>
        {!modeReady && <p className="supporting-copy" role="status">正在打开句子库…</p>}
        {modeReady && <>
          <header className="sentence-library-intro">
            <p className="sentence-library-eyebrow">{mode === "select" ? "为这一段听力挑选内容" : "收好每一句，随时回来再听"}</p>
            <p className="sentence-library-lead">{mode === "select" ? "让熟悉的句子，慢慢变自然。" : "你讲解过的句子，都在这里。"}</p>
            <p className="supporting-copy">{mode === "select" ? "按收录时间浏览，也可以搜索西语或中文。" : "按收录时间整理，找回、重学或移出都很方便。"}</p>
          </header>
          {(status === "loading" || loadedUserId !== userId) && <p className="supporting-copy" role="status">正在加载个人句子…</p>}
          {status === "error" && loadedUserId === userId && <p className="form-error" role="alert">个人句子加载失败。<button type="button" className="inline-retry" onClick={retryLoad}>重试</button></p>}
          {readyForUser && <>
            <section className="sentence-library-tools" aria-label="句子库工具">
              <div className="sentence-library-summary">
                <span>{sentences.length} 句</span>
                {mode === "select" && <span>已选 {selectedCount} 句</span>}
              </div>
              <label className="sentence-library-search">
                <span className="sr-only">搜索西语原文或中文译文</span>
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索西语或中文" />
                {query && <button type="button" aria-label="清除搜索" onClick={() => setQuery("")}>清除</button>}
              </label>
              {notice && <p className={notice.kind === "error" ? "form-error" : "supporting-copy"} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
              {saveStatus === "error" && mode === "select" && <button type="button" className="inline-retry" onClick={() => void confirmSelection()}>重试保存</button>}
            </section>
            {!sentences.length ? <section className="section-block sentence-library-empty">
              <p className="empty-text">还没有收录的句子。去选句页输入一句西语，成功查看讲解后会自动收录。</p>
              <button type="button" className="plain-button" onClick={() => router.replace("/")}>去选句</button>
            </section> : !groups.length ? <p className="sentence-library-no-results">没有找到匹配的句子。试试西语原文或中文译文。</p> : <div className="sentence-library-groups">
              {groups.map((month) => {
                const monthEntries = month.days.flatMap((day) => day.sentences);
                const monthIds = monthEntries.map((item) => item.id);
                const monthState = selectionState(monthIds, draftSelection) as SelectionMark;
                const monthOpen = expandedMonths.has(month.key);
                return <section className="sentence-month" key={month.key}>
                  <div className="sentence-month-heading">
                    {mode === "select" && !isSearching && <GroupMark state={monthState} label={`选择${month.label}全部 ${monthIds.length} 句`} onChange={() => toggleGroup(monthIds)} />}
                    <button type="button" className="sentence-group-toggle" aria-expanded={monthOpen} onClick={() => toggleSet(setExpandedMonths, month.key)}>
                      <span className="sentence-group-chevron" aria-hidden="true">{monthOpen ? "⌄" : "›"}</span>
                      <span>{month.label}</span><span className="sentence-group-count">{monthIds.length} 句</span>
                    </button>
                  </div>
                  {monthOpen && <div className="sentence-month-days">
                    {month.days.map((day) => {
                      const dayIds = day.sentences.map((item) => item.id);
                      const dayState = selectionState(dayIds, draftSelection) as SelectionMark;
                      const dayOpen = expandedDays.has(day.key);
                      return <section className="sentence-day" key={day.key}>
                        <div className="sentence-day-heading">
                          {mode === "select" && !isSearching && <GroupMark state={dayState} label={`选择${day.label}全部 ${dayIds.length} 句`} onChange={() => toggleGroup(dayIds)} />}
                          <button type="button" className="sentence-group-toggle" aria-expanded={dayOpen} onClick={() => toggleSet(setExpandedDays, day.key)}>
                            <span className="sentence-group-chevron" aria-hidden="true">{dayOpen ? "⌄" : "›"}</span>
                            <span>{day.label}</span><span className="sentence-group-count">{dayIds.length} 句</span>
                          </button>
                        </div>
                        {dayOpen && <ul className="sentence-library-list">
                          {day.sentences.map((item) => <li className="sentence-library-item" key={item.id}>
                            {mode === "select" && <label className="sentence-item-check"><input type="checkbox" checked={draftSelection.has(item.id)} onChange={() => setDraftSelection((current) => toggleSentenceSelection(current, item.id))} aria-label={`选择 ${item.sentence}`} /></label>}
                            <div className="sentence-library-copy">
                              <p className="my-sentence-text" lang="es">{item.sentence}</p>
                              {item.translation && <p className="my-sentence-translation">{item.translation}</p>}
                              {mode === "manage" && <p className="my-sentence-date">{formatCollectedDate(item.created_at)} 收录</p>}
                              {mode === "manage" && <div className="my-sentence-actions">
                                <button type="button" className="plain-button" onClick={() => relearn(item)}>重新学习</button>
                                <button type="button" className="my-sentence-remove" disabled={Boolean(removingId)} onClick={() => { setNotice(null); setConfirmRemoveId(item.id); }}>{removingId === item.id ? "移出中…" : "移出"}</button>
                              </div>}
                              {mode === "manage" && confirmRemoveId === item.id && <div className="my-sentence-confirm" aria-label="确认移出句子">
                                <p>从个人句子中移出？已有练习记录会保留，该句将不再用于听熟。</p>
                                <button type="button" className="inline-retry" disabled={removingId === item.id} onClick={() => void remove(item)}>确认移出</button>
                                <button type="button" className="inline-retry" disabled={removingId === item.id} onClick={() => setConfirmRemoveId(null)}>取消</button>
                              </div>}
                            </div>
                          </li>)}
                        </ul>}
                      </section>;
                    })}
                  </div>}
                </section>;
              })}
            </div>}
          </>}
        </>}
      </div>
    </PageShell>
  );
}
