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
  makeListeningPlaylist, makePersonalListeningPool, validCustomSelection,
  type ListeningScope,
} from "../lib/listening-playlist";
import { listPersonalSentences, type PersonalSentence } from "../lib/personal-sentences";
import { useListeningPlayer } from "../lib/use-listening-player";

const scopes: { value: ListeningScope; label: string }[] = [
  { value: "all", label: "全部个人句子" },
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
      const loaded = { ...saved, scope: saved.scope === "learned" ? "all" as const : saved.scope,
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

  function openMySentences() {
    if (["loading", "playing", "gap", "paused"].includes(player.phase)) {
      setConfirmManageNavigation(true);
      return;
    }
    router.push("/my-sentences");
  }

  function leaveForMySentences() {
    setConfirmManageNavigation(false);
    player.stop();
    router.push("/my-sentences");
  }

  return (
    <PageShell title="听熟" primary="listening" action={
      <button type="button" className={`primary-button${player.phase === "loading" ? " is-loading" : ""}`} disabled={!canPlay && !busy} onClick={primaryAction}>
        {busy ? "暂停" : player.phase === "paused" ? "继续" : "开始播放"}
      </button>
    }>
      <div className="page-stack listening-page">
        {(loadStatus === "loading" || (loadStatus === "ready" && !ready)) && <p className="supporting-copy" role="status">正在加载播放设置和句子…</p>}
        {loadStatus === "error" && <p className="form-error" role="alert">播放设置或个人句子加载失败。<button type="button" className="inline-retry" onClick={() => void load()}>重试</button></p>}
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
            <div className="listening-section-heading">
              <SectionHeading>朗读范围</SectionHeading>
              <button type="button" className="my-sentences-link" onClick={openMySentences}>我的句子</button>
            </div>
            <div className="option-row" role="group" aria-label="朗读范围">
              {scopes.map((choice) => <button key={choice.value} type="button" aria-pressed={preferences.scope === choice.value} className={`option-choice${preferences.scope === choice.value ? " selected" : ""}`} onClick={() => changeScope(choice.value)}>{choice.label}</button>)}
            </div>
            {preferences.scope === "custom" && <details className="listening-custom">
              <summary className="field-label">选择句子 <span className="listening-count">已选 {validCustomSelection(preferences.customSelection, pool).length} 句</span></summary>
              <ul className="listening-choice-list">{pool.map((item) => <li key={item.key}><label>
                <input type="checkbox" checked={preferences.customSelection.includes(item.key)} onChange={() => toggleCustom(item.key)} />
                <span lang="es">{item.sentence}</span>
              </label></li>)}</ul>
            </details>}
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
            <SectionHeading>本次 {playlist.length} 句</SectionHeading>
            {!playlist.length ? <>
              <EmptyText>{!pool.length ? "还没有个人句子。先去选句页完成一句讲解。" : preferences.scope === "custom" ? "自定义范围没有有效句子，请重新选择。" : "暂无可播放的句子"}</EmptyText>
              {!pool.length && <Link href="/" className="inline-link">去选句</Link>}
            </> : <details className="listening-list-details"><summary>查看本次句子</summary><ul className="listening-playlist">{playlist.map((item, index) => <li key={item.key} className={player.activeKey === item.key ? "is-current" : ""}>
                <div className="listening-list-content">
                  {preferences.showText ? <span className="listening-sentence" lang="es">{item.sentence}</span> : <span className="listening-hidden">第 {index + 1} 句</span>}
                  {preferences.showTranslation && <span className="listening-translation">{item.translation || "暂无翻译"}</span>}
                  {player.activeKey === item.key && statusText && <span className="listening-current">{statusText}</span>}
                </div>
                <button type="button" className="listening-single" aria-label={`单句播放第 ${index + 1} 句`} disabled={!lang || dialectStatus !== "ready" || player.phase !== "playing"} onClick={() => player.playSingle(item, index)}>单句播放</button>
              </li>)}</ul></details>}
          </section>
        </>}
      </div>
      <dialog ref={manageDialogRef} className="listening-leave-dialog" aria-labelledby="leave-listening-title" onCancel={(event) => { event.preventDefault(); setConfirmManageNavigation(false); }}>
        <h2 id="leave-listening-title">离开听熟？</h2>
        <p>离开后本次播放会停止。返回后可以重新开始，但不会接续当前播放位置。</p>
        <div className="listening-leave-actions">
          <button type="button" className="secondary-button" onClick={() => setConfirmManageNavigation(false)}>继续听</button>
          <button type="button" className="primary-button" onClick={leaveForMySentences}>停止并查看</button>
        </div>
      </dialog>
    </PageShell>
  );
}
