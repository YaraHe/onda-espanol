"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/auth-provider";
import { EmptyText, PageShell, SectionHeading } from "../components/page-shell";
import { useUserSettings } from "../components/user-settings-provider";
import {
  defaultListeningPreferences, readListeningPreferences, saveListeningPreferences,
  type ListeningPreferences,
} from "../lib/listening-preferences";
import {
  makeListeningPlaylist, makePersonalListeningPool, relativeListeningIndex, validCustomSelection,
} from "../lib/listening-playlist";
import type { ListeningScope } from "../lib/listening-scope";
import { listPersonalSentences, type PersonalSentence } from "../lib/personal-sentences";
import { useListeningPlayer } from "../lib/use-listening-player";

const scopes: { value: ListeningScope; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "custom", label: "自定义" },
];

export default function ListeningPage() {
  const router = useRouter();
  const { userId } = useAuth();
  const { lang, status: dialectStatus, reload: reloadDialect } = useUserSettings();
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [sentences, setSentences] = useState<PersonalSentence[]>([]);
  const [preferences, setPreferences] = useState<ListeningPreferences>({ ...defaultListeningPreferences, customSelection: [] });
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [confirmManageNavigation, setConfirmManageNavigation] = useState(false);
  const [pendingLibraryMode, setPendingLibraryMode] = useState<"manage" | "select">("manage");
  const manageDialogRef = useRef<HTMLDialogElement>(null);
  const preferencesRef = useRef(preferences);
  const loadGeneration = useRef(0);
  const currentUser = useRef(userId);
  const mounted = useRef(true);
  const saveQueue = useRef<{ userId: string | null; pending: ListeningPreferences | null; running: boolean }>({ userId, pending: null, running: false });

  const ready = loadStatus === "ready" && loadedUserId === userId;
  const pool = useMemo(() => makePersonalListeningPool(loadedUserId === userId ? sentences : []), [loadedUserId, sentences, userId]);
  const playlist = useMemo(
    () => ready ? makeListeningPlaylist(pool, preferences.scope, preferences.customSelection) : [],
    [pool, preferences.scope, preferences.customSelection, ready],
  );
  const player = useListeningPlayer(playlist, preferences.rate, preferences.intervalSeconds, lang);

  useEffect(() => { preferencesRef.current = preferences; }, [preferences]);
  useEffect(() => {
    const dialog = manageDialogRef.current;
    if (!dialog) return;
    if (confirmManageNavigation && !dialog.open) dialog.showModal();
    else if (!confirmManageNavigation && dialog.open) dialog.close();
  }, [confirmManageNavigation]);
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
      const [saved, ownSentences] = await Promise.all([readListeningPreferences(userId), listPersonalSentences()]);
      if (!mounted.current || generation !== loadGeneration.current || currentUser.current !== userId) return;
      const currentPool = makePersonalListeningPool(ownSentences);
      const loaded = { ...saved,
        customSelection: validCustomSelection(saved.customSelection, currentPool) };
      preferencesRef.current = loaded;
      setPreferences(loaded);
      setSentences(ownSentences);
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
    if (scope === "custom") {
      openSentenceSelector();
      return;
    }
    player.stop();
    updatePreferences({ ...preferencesRef.current, scope });
  }

  const busy = player.phase === "loading" || player.phase === "playing" || player.phase === "gap";
  const canPlay = ready && dialectStatus === "ready" && Boolean(lang) && playlist.length > 0;
  const statusText = player.phase === "loading" ? "正在生成音频…"
    : player.phase === "gap" ? "等待下一句…"
      : player.phase === "paused" ? "已暂停" : player.phase === "playing" ? (player.isFocusing ? "正在循环精听" : "正在播放") : "";

  function primaryAction() { player.startLoop(); }

  function openMySentences() {
    if (["loading", "playing", "gap", "paused"].includes(player.phase)) {
      setPendingLibraryMode("manage");
      setConfirmManageNavigation(true);
      return;
    }
    router.push("/my-sentences");
  }

  function openSentenceSelector() {
    if (["loading", "playing", "gap", "paused"].includes(player.phase)) {
      setPendingLibraryMode("select");
      setConfirmManageNavigation(true);
      return;
    }
    router.push("/my-sentences?mode=select");
  }

  function leaveForMySentences() {
    setConfirmManageNavigation(false);
    player.stop();
    router.push(pendingLibraryMode === "select" ? "/my-sentences?mode=select" : "/my-sentences");
  }

  return (
    <PageShell title="听熟" primary="listening" action={player.phase === "idle" && !player.isFocusing ?
      <button type="button" className="primary-button" disabled={!canPlay} onClick={primaryAction}>开始播放</button>
      : undefined
    }>
      <div className="page-stack listening-page">
        <header className="listening-intro">
          <p className="listening-intro-eyebrow">给耳朵一点熟悉的时间</p>
          <p className="listening-intro-lead">让熟悉的句子，慢慢变自然。</p>
          <p className="supporting-copy">选好内容，放松听一会儿。</p>
        </header>
        {(loadStatus === "loading" || (loadStatus === "ready" && !ready)) && <p className="supporting-copy" role="status">正在加载播放设置和句子…</p>}
        {loadStatus === "error" && <p className="form-error" role="alert">播放设置或个人句子加载失败。<button type="button" className="inline-retry" onClick={() => void load()}>重试</button></p>}
        {ready && <>
          {(player.activeKey || player.focusKey) && <section className={`listening-now${player.isFocusing ? " is-focus" : ""}`} aria-live="polite">
            <p className="section-heading">{player.isFocusing ? "单句精听" : "当前播放"}</p>
            <p className="listening-now-sentence" lang={preferences.showText ? "es" : undefined}>
              {preferences.showText ? pool.find((item) => item.key === (player.focusKey ?? player.activeKey))?.sentence : `第 ${pool.findIndex((item) => item.key === (player.focusKey ?? player.activeKey)) + 1} 句`}
            </p>
            {preferences.showTranslation && <p className="listening-translation">{pool.find((item) => item.key === (player.focusKey ?? player.activeKey))?.translation || "暂无翻译"}</p>}
            <p className="field-note">{player.isFocusing ? (player.phase === "paused" ? "精听已暂停" : player.phase === "loading" ? "正在准备精听音频…" : player.phase === "idle" ? "精听未开始" : "单句循环播放中") : statusText}</p>
            {player.isFocusing ? <div className="listening-task-controls listening-focus-controls" aria-label="单句精听控制">
              <button type="button" className="secondary-button" disabled={player.phase === "loading" || player.phase === "idle"} onClick={() => player.phase === "paused" ? void player.resume() : player.pause()}>{player.phase === "paused" ? "继续精听" : "暂停精听"}</button>
              <button type="button" className="secondary-button" disabled={playlist.length < 2} onClick={() => {
                const currentIndex = playlist.findIndex((item) => item.key === player.focusKey);
                const next = playlist[relativeListeningIndex(currentIndex, playlist.length, -1)];
                if (next) player.switchFocus(next, relativeListeningIndex(currentIndex, playlist.length, -1));
              }}>上一句</button>
              <button type="button" className="secondary-button" disabled={playlist.length < 2} onClick={() => {
                const currentIndex = playlist.findIndex((item) => item.key === player.focusKey);
                const nextIndex = relativeListeningIndex(currentIndex, playlist.length, 1);
                const next = playlist[nextIndex];
                if (next) player.switchFocus(next, nextIndex);
              }}>下一句</button>
              <button type="button" className="plain-button listening-end-focus" onClick={player.endFocus}>结束精听</button>
            </div> : player.activeKey && <div className="listening-task-controls listening-group-controls" aria-label="整组播放控制">
              <button type="button" className="secondary-button" disabled={!lang || dialectStatus !== "ready" || player.phase === "idle"} onClick={() => {
                const currentIndex = playlist.findIndex((item) => item.key === player.activeKey);
                const currentEntry = playlist[currentIndex];
                if (currentEntry) player.startFocus(currentEntry, currentIndex);
              }}>单句精听</button>
              <button type="button" className="primary-button" onClick={() => busy ? player.pause() : void player.resume()}>{busy ? "暂停整组" : "播放整组"}</button>
            </div>}
          </section>}
          {player.error && <p className="form-error" role="alert">{player.error} {player.canRetry && <button type="button" className="inline-retry" onClick={player.retry}>重试</button>}</p>}
          {dialectStatus === "loading" && <p className="supporting-copy" role="status">正在加载方言设置…</p>}
          {dialectStatus === "error" && <p className="form-error" role="alert">方言设置加载失败。<button type="button" className="inline-retry" onClick={() => void reloadDialect()}>重试</button></p>}
          <section className="section-block">
            <div className="listening-section-heading">
              <SectionHeading>朗读范围</SectionHeading>
              <button type="button" className="my-sentences-link" onClick={openMySentences}>我的句子</button>
            </div>
            <div className="option-row" role="group" aria-label="朗读范围">
              {scopes.map((choice) => <button key={choice.value} type="button" aria-pressed={preferences.scope === choice.value} className={`option-choice${preferences.scope === choice.value ? " selected" : ""}`} onClick={() => changeScope(choice.value)}>{choice.label}</button>)}
            </div>
            {preferences.scope === "custom" && <p className="field-note">已选 {validCustomSelection(preferences.customSelection, pool).length} 句 · <button type="button" className="inline-link-button" onClick={openSentenceSelector}>调整选择</button></p>}
          </section>
          <section className="section-block">
            <SectionHeading>播放设置</SectionHeading>
            <label className="field-group">
              <span className="field-label">语速 <strong>{preferences.rate.toFixed(1)}×</strong></span>
              <input type="range" min="0.6" max="1.2" step="0.1" value={preferences.rate} onChange={(event) => updatePreferences({ ...preferencesRef.current, rate: Number(event.target.value) })} onPointerUp={() => { if (player.isFocusing) player.regenerateFocus(); }} onKeyUp={() => { if (player.isFocusing) player.regenerateFocus(); }} className="range-input" />
            </label>
            <label className="field-group">
              <span className="field-label">句间间隔</span>
              <select className="select-input" value={preferences.intervalSeconds} onChange={(event) => updatePreferences({ ...preferencesRef.current, intervalSeconds: Number(event.target.value) as 1 | 2 | 4 })}>
                {[1, 2, 4].map((seconds) => <option key={seconds} value={seconds}>{seconds} 秒</option>)}
              </select>
            </label>
            {player.isFocusing ? <p className="field-note">更改语速会为当前句重新生成一次音频；单句循环不会重复请求。</p> : busy && <p className="field-note">语速和间隔的调整从下一句生效。</p>}
          </section>
          <section className="section-block">
            <SectionHeading>显示设置</SectionHeading>
            <label className="toggle-row"><span>显示原文</span><input type="checkbox" checked={preferences.showText} onChange={(event) => updatePreferences({ ...preferencesRef.current, showText: event.target.checked })} /></label>
            <label className="toggle-row"><span>显示翻译</span><input type="checkbox" checked={preferences.showTranslation} onChange={(event) => updatePreferences({ ...preferencesRef.current, showTranslation: event.target.checked })} /></label>
          </section>
          {saveStatus === "saving" && <p className="supporting-copy" role="status">正在保存播放设置…</p>}
          {saveStatus === "saved" && <p className="supporting-copy" role="status">播放设置已保存</p>}
          {saveStatus === "error" && <p className="form-error" role="alert">播放设置未保存。<button type="button" className="inline-retry" onClick={() => void flushSaveQueue()}>重试</button></p>}
          {!player.isFocusing && <section className="section-block">
            <SectionHeading>本次句子<span className="listening-count">{playlist.length} 句</span></SectionHeading>
            {!playlist.length ? <>
              <EmptyText>{!pool.length ? "还没有个人句子。先去选句页完成一句讲解。" : preferences.scope === "custom" ? "自定义范围没有有效句子，请重新选择。" : "暂无可播放的句子"}</EmptyText>
              {!pool.length && <Link href="/" className="inline-link">去选句</Link>}
            </> : <details className="listening-list-details"><summary>查看本次句子</summary><ul className="listening-playlist">{playlist.map((item, index) => <li key={item.key} aria-current={player.activeKey === item.key ? "true" : undefined} className={player.activeKey === item.key ? "is-current" : ""}>
                <div className="listening-list-content">
                  {preferences.showText ? <span className="listening-sentence" lang="es">{item.sentence}</span> : <span className="listening-hidden">第 {index + 1} 句</span>}
                  {preferences.showTranslation && <span className="listening-translation">{item.translation || "暂无翻译"}</span>}
                  {player.activeKey === item.key && statusText && <span className="listening-current">{statusText}</span>}
                </div>
              </li>)}</ul></details>}
          </section>}
        </>}
      </div>
      <dialog ref={manageDialogRef} className="listening-leave-dialog" aria-labelledby="leave-listening-title" onCancel={(event) => { event.preventDefault(); setConfirmManageNavigation(false); }}>
        <h2 id="leave-listening-title">离开听熟？</h2>
        <p>离开后本次播放会停止。返回后可以重新开始，但不会接续当前播放位置。</p>
        <div className="listening-leave-actions">
          <button type="button" className="secondary-button" onClick={() => setConfirmManageNavigation(false)}>继续听</button>
          <button type="button" className="primary-button" onClick={leaveForMySentences}>{pendingLibraryMode === "select" ? "停止并选择" : "停止并查看"}</button>
        </div>
      </dialog>
    </PageShell>
  );
}
