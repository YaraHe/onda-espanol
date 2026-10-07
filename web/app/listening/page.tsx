"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../components/auth-provider";
import { EmptyText, PageShell, SectionHeading } from "../components/page-shell";
import { useUserSettings } from "../components/user-settings-provider";
import {
  defaultListeningPreferences, readListeningPreferences, saveListeningPreferences,
  type ListeningPreferences,
} from "../lib/listening-preferences";
import {
  makeListeningPlaylist, makeListeningPool, validCustomSelection,
  type ListeningScope,
} from "../lib/listening-playlist";
import { listAllPracticeRecords, type PracticeRecordSummary } from "../lib/practice-records";
import { librarySentences } from "../lib/sentence-library";
import { useListeningPlayer } from "../lib/use-listening-player";

const scopes: { value: ListeningScope; label: string }[] = [
  { value: "learned", label: "已学" },
  { value: "all", label: "全部" },
  { value: "custom", label: "自定义" },
];

export default function ListeningPage() {
  const { userId } = useAuth();
  const { lang, status: dialectStatus, reload: reloadDialect } = useUserSettings();
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [records, setRecords] = useState<PracticeRecordSummary[]>([]);
  const [preferences, setPreferences] = useState<ListeningPreferences>({ ...defaultListeningPreferences, customSelection: [] });
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const preferencesRef = useRef(preferences);
  const loadGeneration = useRef(0);
  const currentUser = useRef(userId);
  const mounted = useRef(true);
  const saveQueue = useRef<{ userId: string | null; pending: ListeningPreferences | null; running: boolean }>({ userId, pending: null, running: false });

  const ready = loadStatus === "ready" && loadedUserId === userId;
  const pool = useMemo(() => makeListeningPool(librarySentences, loadedUserId === userId ? records : []), [loadedUserId, records, userId]);
  const playlist = useMemo(
    () => ready ? makeListeningPlaylist(pool, preferences.scope, preferences.customSelection) : [],
    [pool, preferences.scope, preferences.customSelection, ready],
  );
  const player = useListeningPlayer(playlist, preferences.rate, preferences.intervalSeconds, lang);

  useEffect(() => { preferencesRef.current = preferences; }, [preferences]);
  useEffect(() => { currentUser.current = userId; saveQueue.current = { userId, pending: null, running: false }; }, [userId]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; loadGeneration.current += 1; };
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    const generation = ++loadGeneration.current;
    setLoadStatus("loading");
    setSaveStatus("idle");
    try {
      const [saved, learned] = await Promise.all([readListeningPreferences(userId), listAllPracticeRecords()]);
      if (!mounted.current || generation !== loadGeneration.current || currentUser.current !== userId) return;
      const currentPool = makeListeningPool(librarySentences, learned);
      const loaded = { ...saved, customSelection: validCustomSelection(saved.customSelection, currentPool) };
      preferencesRef.current = loaded;
      setPreferences(loaded);
      setRecords(learned);
      setLoadedUserId(userId);
      setLoadStatus("ready");
    } catch {
      if (mounted.current && generation === loadGeneration.current && currentUser.current === userId) setLoadStatus("error");
    }
  }, [userId]);

  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);

  const flushSaveQueue = useCallback(async () => {
    const queue = saveQueue.current;
    if (!userId || queue.userId !== userId || queue.running) return;
    queue.running = true;
    while (queue.pending) {
      const next = queue.pending;
      queue.pending = null;
      if (mounted.current && currentUser.current === userId) setSaveStatus("saving");
      try { await saveListeningPreferences(userId, next); }
      catch {
        queue.pending ??= next;
        if (mounted.current && currentUser.current === userId) setSaveStatus("error");
        break;
      }
    }
    queue.running = false;
    if (!queue.pending && mounted.current && currentUser.current === userId) setSaveStatus("saved");
  }, [userId]);

  function updatePreferences(next: ListeningPreferences) {
    preferencesRef.current = next;
    setPreferences(next);
    saveQueue.current.pending = next;
    void flushSaveQueue();
  }

  function changeScope(scope: ListeningScope) {
    if (scope === preferencesRef.current.scope) return;
    player.stop();
    updatePreferences({ ...preferencesRef.current, scope });
  }

  function toggleCustom(key: string) {
    const selected = new Set(preferencesRef.current.customSelection);
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
    player.stop();
    updatePreferences({ ...preferencesRef.current, customSelection: [...selected] });
  }

  const busy = player.phase === "loading" || player.phase === "playing" || player.phase === "gap";
  const canPlay = ready && dialectStatus === "ready" && Boolean(lang) && playlist.length > 0;
  const statusText = player.phase === "loading" ? "正在生成音频…"
    : player.phase === "gap" ? "等待下一句…"
      : player.phase === "paused" ? "已暂停" : player.phase === "playing" ? "正在播放" : "";

  function primaryAction() {
    if (busy) player.pause();
    else if (player.phase === "paused") void player.resume();
    else player.startLoop();
  }

  return (
    <PageShell title="磨耳朵" backHref="/library" action={
      <button type="button" className={`primary-button${player.phase === "loading" ? " is-loading" : ""}`} disabled={!canPlay && !busy} onClick={primaryAction}>
        {busy ? "暂停" : "开始播放"}
      </button>
    }>
      <div className="page-stack listening-page">
        {(loadStatus === "loading" || (loadStatus === "ready" && !ready)) && <p className="supporting-copy" role="status">正在加载播放设置和句子…</p>}
        {loadStatus === "error" && <p className="form-error" role="alert">播放设置或练习记录加载失败。<button type="button" className="inline-retry" onClick={() => void load()}>重试</button></p>}
        {ready && <>
          {player.activeKey && <section className="listening-now" aria-live="polite">
            <p className="section-heading">当前播放</p>
            <p className="listening-now-sentence" lang={preferences.showText ? "es" : undefined}>
              {preferences.showText ? playlist.find((item) => item.key === player.activeKey)?.sentence : `第 ${playlist.findIndex((item) => item.key === player.activeKey) + 1} 句`}
            </p>
            {preferences.showTranslation && <p className="listening-translation">{playlist.find((item) => item.key === player.activeKey)?.translation || "暂无翻译"}</p>}
            <p className="field-note">{statusText}</p>
          </section>}
          {player.error && <p className="form-error" role="alert">{player.error} {player.canRetry && <button type="button" className="inline-retry" onClick={player.retry}>重试</button>}</p>}
          {dialectStatus === "loading" && <p className="supporting-copy" role="status">正在加载方言设置…</p>}
          {dialectStatus === "error" && <p className="form-error" role="alert">方言设置加载失败。<button type="button" className="inline-retry" onClick={() => void reloadDialect()}>重试</button></p>}
          <section className="section-block">
            <SectionHeading>朗读范围</SectionHeading>
            <div className="option-row" role="group" aria-label="朗读范围">
              {scopes.map((choice) => <button key={choice.value} type="button" aria-pressed={preferences.scope === choice.value} className={`option-choice${preferences.scope === choice.value ? " selected" : ""}`} onClick={() => changeScope(choice.value)}>{choice.label}</button>)}
            </div>
            {preferences.scope === "custom" && <div className="listening-custom">
              <p className="field-label">选择句子 <span className="listening-count">已选 {validCustomSelection(preferences.customSelection, pool).length} 句</span></p>
              <ul className="listening-choice-list">{pool.map((item) => <li key={item.key}><label>
                <input type="checkbox" checked={preferences.customSelection.includes(item.key)} onChange={() => toggleCustom(item.key)} />
                <span lang="es">{item.sentence}</span>
              </label></li>)}</ul>
            </div>}
          </section>
          <section className="section-block">
            <SectionHeading>播放设置</SectionHeading>
            <label className="field-group">
              <span className="field-label">语速 <strong>{preferences.rate.toFixed(1)}×</strong></span>
              <input type="range" min="0.6" max="1.2" step="0.1" value={preferences.rate} onChange={(event) => updatePreferences({ ...preferencesRef.current, rate: Number(event.target.value) })} className="range-input" />
            </label>
            <label className="field-group">
              <span className="field-label">句间间隔</span>
              <select className="select-input" value={preferences.intervalSeconds} onChange={(event) => updatePreferences({ ...preferencesRef.current, intervalSeconds: Number(event.target.value) as 1 | 2 | 4 })}>
                {[1, 2, 4].map((seconds) => <option key={seconds} value={seconds}>{seconds} 秒</option>)}
              </select>
            </label>
            {busy && <p className="field-note">语速和间隔的调整从下一句生效。</p>}
          </section>
          <section className="section-block">
            <SectionHeading>显示设置</SectionHeading>
            <label className="toggle-row"><span>显示原文</span><input type="checkbox" checked={preferences.showText} onChange={(event) => updatePreferences({ ...preferencesRef.current, showText: event.target.checked })} /></label>
            <label className="toggle-row"><span>显示翻译</span><input type="checkbox" checked={preferences.showTranslation} onChange={(event) => updatePreferences({ ...preferencesRef.current, showTranslation: event.target.checked })} /></label>
          </section>
          {saveStatus === "saving" && <p className="supporting-copy" role="status">正在保存播放设置…</p>}
          {saveStatus === "saved" && <p className="supporting-copy" role="status">播放设置已保存</p>}
          {saveStatus === "error" && <p className="form-error" role="alert">播放设置未保存。<button type="button" className="inline-retry" onClick={() => void flushSaveQueue()}>重试</button></p>}
          <section className="section-block">
            <SectionHeading>播放列表 <span className="listening-count">{playlist.length} 句</span></SectionHeading>
            {!playlist.length ? <EmptyText>{preferences.scope === "learned" ? "还没有已练习的句子，可选择「全部」" : preferences.scope === "custom" ? "请先选择要播放的句子" : "暂无可播放的句子"}</EmptyText>
              : <ul className="listening-playlist">{playlist.map((item, index) => <li key={item.key} className={player.activeKey === item.key ? "is-current" : ""}>
                <div className="listening-list-content">
                  {preferences.showText ? <span className="listening-sentence" lang="es">{item.sentence}</span> : <span className="listening-hidden">第 {index + 1} 句</span>}
                  {preferences.showTranslation && <span className="listening-translation">{item.translation || "暂无翻译"}</span>}
                  {player.activeKey === item.key && statusText && <span className="listening-current">{statusText}</span>}
                </div>
                <button type="button" className="listening-single" aria-label={`单句播放第 ${index + 1} 句`} disabled={!lang || dialectStatus !== "ready"} onClick={() => player.playSingle(item, index)}>单句播放</button>
              </li>)}</ul>}
          </section>
        </>}
      </div>
    </PageShell>
  );
}
