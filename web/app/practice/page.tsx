"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "../components/icons";
import { EmptyText, PageShell, SectionHeading } from "../components/page-shell";
import { PronunciationAnnotation } from "../components/pronunciation-annotation";
import { useSentenceDraft, type PracticeRecoveryContext } from "../components/sentence-draft";
import { useAuth } from "../components/auth-provider";
import { useUserSettings } from "../components/user-settings-provider";
import { AssessmentError, AssessmentResult, fetchAssessment } from "../lib/assessment";
import { alignAssessmentWords, practiceFocus } from "../lib/assessment-alignment";
import { reconcilePracticeRecord, savePracticeRecord, type PracticeRecordDraft } from "../lib/practice-records";
import {
  createPracticeRecoverySnapshot,
  PracticeRecordConflictError,
  readPracticeRecoverySnapshot,
  removePracticeRecoverySnapshot,
  writePracticeRecoverySnapshot,
} from "../lib/practice-recovery.mjs";
import { TtsError, fetchDemoAudio } from "../lib/tts";

const rates = [0.6, 0.8, 1, 1.2] as const;
const discardMessage = "当前评分尚未确认保存，确定离开并保留本地恢复副本吗？";

type PlaybackTarget = "sentence" | "word";
type PlaybackState = { status: "idle" | "loading" | "playing"; target: PlaybackTarget | null; text: string; error: string };
type SaveStatus = "idle" | "verifying" | "saving" | "saved" | "failed" | "conflict" | "removed";
type RecoveryStage = "ready" | "recording" | "assessing" | "score-ready" | "saving" | "failed" | "saved" | "removed";
type RecoverySnapshot = {
  version: 1;
  userId: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  context: PracticeRecoveryContext;
  stage: RecoveryStage;
  draft: PracticeRecordDraft | null;
};
type PendingAssessment = { audio: Blob; sentence: string; translation: string; lang: "es-ES" | "es-MX"; ownerUserId: string; generation: number };

const createRecoverySnapshot = createPracticeRecoverySnapshot as (input: {
  userId: string;
  context: PracticeRecoveryContext;
  stage: RecoveryStage;
  draft?: PracticeRecordDraft | null;
  previous?: RecoverySnapshot | null;
}) => RecoverySnapshot | null;

function getSessionStorage() {
  try { return window.sessionStorage; } catch { return null; }
}

function contextWithFocus(context: PracticeRecoveryContext, focus: string | null, focusWord: string | null): PracticeRecoveryContext {
  return { ...context, focus, focusWord };
}

function usePracticeAudio(lang: "es-ES" | "es-MX" | null) {
  const [state, setState] = useState<PlaybackState>({ status: "idle", target: null, text: "", error: "" });
  const playback = useRef<{ generation: number; controller: AbortController | null; audio: HTMLAudioElement | null; url: string | null; timeout: number | null }>(
    { generation: 0, controller: null, audio: null, url: null, timeout: null });

  const stop = useCallback((updateState = true) => {
    const current = playback.current;
    current.generation += 1;
    current.controller?.abort();
    current.controller = null;
    if (current.timeout !== null) window.clearTimeout(current.timeout);
    current.timeout = null;
    if (current.audio) {
      current.audio.onended = null;
      current.audio.onerror = null;
      current.audio.pause();
      current.audio.removeAttribute("src");
      current.audio.load();
    }
    current.audio = null;
    if (current.url) URL.revokeObjectURL(current.url);
    current.url = null;
    if (updateState) setState({ status: "idle", target: null, text: "", error: "" });
  }, []);

  useEffect(() => () => stop(false), [stop]);

  const play = useCallback(async (text: string, rate: number, target: PlaybackTarget) => {
    if (!lang || !text.trim()) return;
    stop(false);
    const current = playback.current;
    const generation = current.generation;
    const controller = new AbortController();
    current.controller = controller;
    current.timeout = window.setTimeout(() => controller.abort(), 15_000);
    setState({ status: "loading", target, text, error: "" });
    try {
      const blob = await fetchDemoAudio(text, rate, controller.signal, lang);
      if (generation !== playback.current.generation) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      current.url = url;
      current.audio = audio;
      audio.onended = () => { if (generation === playback.current.generation) stop(); };
      audio.onerror = () => {
        if (generation !== playback.current.generation) return;
        stop();
        setState({ status: "idle", target, text, error: "示范音频无法播放，请重试" });
      };
      await audio.play();
      if (generation === playback.current.generation) setState({ status: "playing", target, text, error: "" });
    } catch (cause) {
      if (generation !== playback.current.generation) return;
      stop();
      setState({ status: "idle", target, text, error: cause instanceof TtsError ? cause.message : "示范音频无法播放，请重试" });
    } finally {
      if (generation === playback.current.generation && current.timeout !== null) {
        window.clearTimeout(current.timeout);
        current.timeout = null;
      }
    }
  }, [lang, stop]);

  return { ...state, play, stop };
}

function WordAudioControl({ word, audio, rate }: {
  word: string;
  audio: ReturnType<typeof usePracticeAudio>;
  rate: number;
}) {
  const active = audio.target === "word" && audio.text === word && audio.status !== "idle";
  return <div className="word-audio-control">
    <button type="button" className="plain-button" onClick={() => active ? audio.stop() : void audio.play(word, rate, "word")}>
      <Icon name={active ? "stop" : "volume"} />{active ? "停止词音" : `听「${word}」`}
    </button>
    {audio.status === "loading" && audio.target === "word" && audio.text === word && <p className="tts-feedback" role="status">正在生成词音…</p>}
    {audio.error && audio.target === "word" && audio.text === word && <p className="tts-feedback tts-error" role="alert">{audio.error} <button type="button" onClick={() => void audio.play(word, rate, "word")}>重试</button></p>}
  </div>;
}

function DemoPlayer({ sentence, annotation, audio, rate, setRate }: {
  sentence: string;
  annotation: PracticeRecoveryContext["annotation"];
  audio: ReturnType<typeof usePracticeAudio>;
  rate: number;
  setRate: (value: number) => void;
}) {
  const active = audio.target === "sentence" && audio.status !== "idle";
  return (
    <section className="section-block practice-demo" aria-label="整句示范音频与发音提示">
      {annotation && (annotation.stress.length > 0 || annotation.liaison.length > 0 || annotation.pauses.length > 0 || annotation.pitchPattern.trim()) &&
        <div className="practice-listening-hints"><h3>听示范时留意</h3><PronunciationAnnotation annotation={annotation} />
          <p className="practice-hints-note">这些是学习提示，请结合示范音频辨别。</p>
        </div>}
      <button type="button" className="secondary-button" onClick={() => active ? audio.stop() : void audio.play(sentence, rate, "sentence")}>
        <Icon name={active ? "stop" : "volume"} />{active ? "停止" : "听示范"}
      </button>
      {audio.status === "loading" && audio.target === "sentence" && <p className="tts-feedback" role="status">正在生成示范音频…</p>}
      <div className="speed-row" aria-label="朗读语速">
        {rates.map((choice) => (
          <button key={choice} type="button" aria-pressed={rate === choice} className={rate === choice ? "speed-choice selected" : "speed-choice"}
            onClick={() => { setRate(choice); void audio.play(sentence, choice, "sentence"); }}>{choice.toFixed(1)}×</button>
        ))}
      </div>
      {audio.error && audio.target === "sentence" && <p className="tts-feedback tts-error" role="alert">{audio.error} <button type="button" onClick={() => void audio.play(sentence, rate, "sentence")}>重试</button></p>}
    </section>
  );
}

export default function PracticePage() {
  const router = useRouter();
  const { status: authStatus, userId } = useAuth();
  const { explainedSentence, explanation, repeatPractice, recordReturnId, learningOrigin,
    practiceContext, restorePracticeContext, clearLearning } = useSentenceDraft();
  const { lang, status: dialectStatus, reload: reloadDialect } = useUserSettings();
  const [audioRate, setAudioRate] = useState<number>(1);
  const audio = usePracticeAudio(lang);
  const stopPracticeAudio = audio.stop;
  const [phase, setPhase] = useState<"idle" | "starting" | "recording" | "recorded" | "assessing">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [pendingAssessment, setPendingAssessment] = useState<PendingAssessment | null>(null);
  const [pendingNeedsConfirmation, setPendingNeedsConfirmation] = useState(false);
  const [toast, setToast] = useState("");
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [perfectScoreArrival, setPerfectScoreArrival] = useState(false);
  const [saveDraft, setSaveDraft] = useState<PracticeRecordDraft | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryUserId, setRecoveryUserId] = useState<string | null>(null);
  const [practiceOwnerUserId, setPracticeOwnerUserId] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState("");
  const [snapshotWarning, setSnapshotWarning] = useState("");
  const [selectedWord, setSelectedWord] = useState<{ kind: "reference" | "insertion"; index: number } | null>(null);
  const [practiceGoal, setPracticeGoal] = useState<string | null>(repeatPractice?.focus ?? practiceContext?.focus ?? null);
  const [practiceTargetWord, setPracticeTargetWord] = useState<string | null>(repeatPractice?.focusWord ?? practiceContext?.focusWord ?? null);
  const recording = useRef<{ recorder: MediaRecorder; stream: MediaStream; started: number; chunks: Blob[]; limitReached: boolean } | null>(null);
  const request = useRef<AbortController | null>(null);
  const timer = useRef<number | null>(null);
  const maxRecordingTimer = useRef<number | null>(null);
  const perfectScoreTimer = useRef<number | null>(null);
  const generation = useRef(0);
  const initializedUser = useRef<string | null>(null);
  const activeTaskOwner = useRef<string | null>(null);
  const recoverySnapshot = useRef<RecoverySnapshot | null>(null);
  const practiceContextRef = useRef(practiceContext);
  const practiceGoalRef = useRef(practiceGoal);
  const practiceTargetWordRef = useRef(practiceTargetWord);
  const saveDraftRef = useRef(saveDraft);
  const userIdRef = useRef(userId);
  useEffect(() => () => {
    if (perfectScoreTimer.current !== null) window.clearTimeout(perfectScoreTimer.current);
  }, []);
  useLayoutEffect(() => {
    practiceContextRef.current = practiceContext;
    practiceGoalRef.current = practiceGoal;
    practiceTargetWordRef.current = practiceTargetWord;
    saveDraftRef.current = saveDraft;
    userIdRef.current = userId;
  }, [practiceContext, practiceGoal, practiceTargetWord, saveDraft, userId]);
  const practiceSessionOwned = recoveryReady && recoveryUserId === userId && practiceOwnerUserId === userId;
  const practiceSentence = practiceSessionOwned ? (repeatPractice?.sentence ?? explainedSentence) : "";
  const practiceTranslation = practiceSessionOwned
    ? (repeatPractice?.translation ?? explanation?.translation ?? practiceContext?.translation)
    : undefined;
  const canPractice = Boolean(practiceSentence && practiceTranslation);
  const resultFocus = result ? practiceFocus(practiceSentence, result.words, {
    overall: result.overall,
    accuracy: result.accuracy,
    fluency: result.fluency,
    completeness: result.completeness,
    speakingRate: result.speakingRate,
  }) : null;

  const persistRecovery = useCallback((stage: RecoveryStage, draft: PracticeRecordDraft | null = saveDraftRef.current,
    focus = practiceGoalRef.current, context = practiceContextRef.current, focusWord = practiceTargetWordRef.current): boolean => {
    const activeUserId = userIdRef.current;
    if (!activeUserId || activeTaskOwner.current !== activeUserId || !context
      || (draft && draft.ownerUserId !== activeUserId)) return false;
    const snapshot = createRecoverySnapshot({
      userId: activeUserId,
      context: contextWithFocus(context, focus, focusWord),
      stage,
      draft,
      previous: recoverySnapshot.current,
    });
    if (!snapshot) {
      setSnapshotWarning("当前练习无法生成恢复副本；请保持页面打开，直到评分保存完成。");
      return false;
    }
    recoverySnapshot.current = snapshot;
    const written = writePracticeRecoverySnapshot(getSessionStorage(), snapshot);
    setSnapshotWarning(written ? "" : "浏览器暂时无法保存刷新恢复副本；当前页面仍会尝试保存评分。");
    return written;
  }, []);

  useEffect(() => {
    let active = true;
    const previousUserId = initializedUser.current;
    const nextUserId = authStatus === "signed-in" ? userId : null;
    const accountChanged = previousUserId !== null && previousUserId !== nextUserId;
    if (accountChanged) {
      generation.current += 1;
      request.current?.abort();
      request.current = null;
      const activeRecording = recording.current;
      recording.current = null;
      if (activeRecording) {
        activeRecording.recorder.onstop = null;
        activeRecording.recorder.onerror = null;
        if (activeRecording.recorder.state !== "inactive") activeRecording.recorder.stop();
        activeRecording.stream.getTracks().forEach((track) => track.stop());
      }
      if (timer.current !== null) window.clearInterval(timer.current);
      timer.current = null;
      if (maxRecordingTimer.current !== null) window.clearTimeout(maxRecordingTimer.current);
      maxRecordingTimer.current = null;
      if (perfectScoreTimer.current !== null) window.clearTimeout(perfectScoreTimer.current);
      perfectScoreTimer.current = null;
      stopPracticeAudio();
      activeTaskOwner.current = null;
      setPracticeOwnerUserId(null);
      recoverySnapshot.current = null;
      setPhase("idle");
      setResult(null);
      setPerfectScoreArrival(false);
      setSaveDraft(null);
      setSaveStatus("idle");
      setPendingAssessment(null);
      setPendingNeedsConfirmation(false);
      setSelectedWord(null);
      setPracticeTargetWord(null);
      setToast("");
    }
    if (authStatus !== "signed-in" || !userId) {
      initializedUser.current = null;
      activeTaskOwner.current = null;
      queueMicrotask(() => {
        if (!active) return;
        setPracticeOwnerUserId(null);
        setRecoveryReady(false);
        setRecoveryUserId(null);
      });
      return () => { active = false; };
    }
    initializedUser.current = userId;
    queueMicrotask(() => {
      if (!active) return;
    setRecoveryReady(false);
    setRecoveryUserId(null);
    recoverySnapshot.current = null;
    setResult(null);
    setPerfectScoreArrival(false);
    setSaveDraft(null);
    setSaveStatus("idle");
    setPracticeGoal(practiceContextRef.current?.focus ?? null);
    setPracticeTargetWord(practiceContextRef.current?.focusWord ?? null);
    setRecoveryNotice("");
    setSnapshotWarning("");

    if (previousUserId && previousUserId !== userId) {
      setPhase("idle");
      setToast("");
    }

    const storage = getSessionStorage();
    const loaded = readPracticeRecoverySnapshot(storage, userId);
    const saved = loaded.status === "found" ? loaded.snapshot : null;
    const currentTask = accountChanged ? null : practiceContextRef.current;

    if (saved && (!currentTask || currentTask.taskId === saved.context.taskId)) {
      recoverySnapshot.current = saved;
      activeTaskOwner.current = userId;
      setPracticeOwnerUserId(userId);
      if (!currentTask) restorePracticeContext(saved.context);
      setPracticeGoal(saved.context.focus);
      setPracticeTargetWord(saved.context.focusWord);
      if (saved.stage === "recording" || saved.stage === "assessing") {
        setRecoveryNotice(saved.stage === "recording"
          ? "刷新中断了录音，请重新录制；录音内容没有保存。"
          : "评分请求在刷新时中断，结果无法确认；请重新录制，不会自动重评。录音内容没有保存。");
        const context = currentTask ?? saved.context;
        const resetSnapshot = createRecoverySnapshot({ userId, context, stage: "ready", previous: saved });
        if (resetSnapshot) {
          recoverySnapshot.current = resetSnapshot;
          writePracticeRecoverySnapshot(storage, resetSnapshot);
        }
      } else if (saved.draft) {
        setResult(saved.draft.result);
        setSaveDraft(saved.draft);
        setSaveStatus("verifying");
        const snapshot = saved;
        void reconcilePracticeRecord(saved.draft).then((outcome) => {
          if (initializedUser.current !== userId) return;
          if (outcome === "saved") {
            setSaveStatus("saved");
            persistRecovery("saved", saved.draft, snapshot.context.focus, snapshot.context);
          } else if (snapshot.stage === "saved" || snapshot.stage === "removed") {
            setSaveStatus("removed");
            setRecoveryNotice("这条评分已不在云端记录中；本地恢复副本不会自动重新写回。");
            persistRecovery("removed", saved.draft, snapshot.context.focus, snapshot.context);
          } else {
            setSaveStatus("failed");
            setRecoveryNotice("尚未找到这条云端评分。评分已保留，可用原记录 ID 安全重试保存。");
            persistRecovery("failed", saved.draft, snapshot.context.focus, snapshot.context);
          }
        }).catch((error) => {
          if (initializedUser.current !== userId) return;
          if (error instanceof PracticeRecordConflictError) {
            setSaveStatus("conflict");
            setRecoveryNotice("云端已有同 ID 的不同评分。已保留本地结果，不会覆盖云端记录；请先查看云端记录。");
          } else {
            setSaveStatus("failed");
            setRecoveryNotice("暂时无法核对云端保存状态。评分仍在本地恢复副本中，请联网后重试。");
          }
        });
      }
    } else if (currentTask) {
      if (saved) removePracticeRecoverySnapshot(storage, userId);
      activeTaskOwner.current = userId;
      setPracticeOwnerUserId(userId);
      const nextSnapshot = createRecoverySnapshot({ userId, context: currentTask, stage: "ready" });
      recoverySnapshot.current = nextSnapshot;
      const written = writePracticeRecoverySnapshot(storage, nextSnapshot);
      if (!written) setSnapshotWarning("浏览器暂时无法保存刷新恢复副本；当前页面仍可正常练习。");
      if (loaded.status === "expired") setRecoveryNotice("上次任务恢复副本已过期，已开始当前练习任务。");
      else if (loaded.status === "invalid") setRecoveryNotice("上次恢复副本不可读取，已开始当前练习任务。");
    } else {
      activeTaskOwner.current = null;
      setPracticeOwnerUserId(null);
      recoverySnapshot.current = null;
      if (loaded.status === "expired") setRecoveryNotice("上次练习恢复副本已过期，请从选句或记录页重新开始。");
      else if (loaded.status === "invalid") setRecoveryNotice("上次练习恢复副本不可读取，请从选句或记录页重新开始。");
      else if (loaded.status === "unavailable") setSnapshotWarning("浏览器不允许读取此标签页的恢复数据。");
    }

    setRecoveryUserId(userId);
    setRecoveryReady(true);
    });
    return () => { active = false; };
  }, [authStatus, userId, restorePracticeContext, persistRecovery, stopPracticeAudio]);

  useEffect(() => {
    if (!saveDraft || saveStatus !== "saving" || authStatus !== "signed-in"
      || !userId || saveDraft.ownerUserId !== userId || activeTaskOwner.current !== userId) return;
    let active = true;
    persistRecovery("saving", saveDraft);
    void savePracticeRecord(saveDraft, userId).then(() => {
      if (!active) return;
      persistRecovery("saved", saveDraft);
      setSaveStatus("saved");
      setRecoveryNotice("");
    }).catch((error) => {
      if (!active) return;
      if (error instanceof PracticeRecordConflictError) {
        persistRecovery("failed", saveDraft);
        setSaveStatus("conflict");
        setRecoveryNotice("云端已有同 ID 的不同评分。已保留本地结果，不会覆盖云端记录；请先查看云端记录。");
      } else {
        persistRecovery("failed", saveDraft);
        setSaveStatus("failed");
      }
    });
    return () => { active = false; };
  }, [saveDraft, saveStatus, authStatus, userId, persistRecovery]);

  const hasUnsavedResult = result !== null && saveStatus !== "saved" && saveStatus !== "idle";
  const hasPendingAudio = pendingAssessment !== null;
  function confirmDiscard(message = discardMessage): boolean {
    return (!hasUnsavedResult && !hasPendingAudio) || window.confirm(hasPendingAudio && !hasUnsavedResult
      ? "当前录音尚未评分，离开会丢弃这段录音。确定继续吗？" : message);
  }

  useEffect(() => {
    if (!hasUnsavedResult && !hasPendingAudio) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedResult, hasPendingAudio]);

  useEffect(() => {
    if (!hasUnsavedResult && !hasPendingAudio) return;
    const guardedWindow = window as Window & { __confirmPracticeHistoryLeave?: () => boolean };
    const confirmLeave = () => window.confirm(discardMessage);
    guardedWindow.__confirmPracticeHistoryLeave = confirmLeave;
    return () => {
      if (guardedWindow.__confirmPracticeHistoryLeave === confirmLeave) {
        delete guardedWindow.__confirmPracticeHistoryLeave;
      }
    };
  }, [hasUnsavedResult, hasPendingAudio]);

  useEffect(() => () => {
    generation.current += 1;
    request.current?.abort();
    if (timer.current !== null) window.clearInterval(timer.current);
    if (maxRecordingTimer.current !== null) window.clearTimeout(maxRecordingTimer.current);
    const current = recording.current;
    if (current) {
      current.recorder.onstop = null;
      if (current.recorder.state !== "inactive") current.recorder.stop();
      current.stream.getTracks().forEach((track) => track.stop());
    }
  }, []);

  async function submitPendingAssessment(pending = pendingAssessment) {
    if (!pending || pending.ownerUserId !== userIdRef.current || pending.ownerUserId !== activeTaskOwner.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    let succeeded = false;
    setPhase("assessing");
    setToast("");
    persistRecovery("assessing", null);
    try {
      const assessment = await fetchAssessment(pending.audio, pending.sentence, controller.signal, pending.lang);
      if (pending.generation !== generation.current || userIdRef.current !== pending.ownerUserId
        || activeTaskOwner.current !== pending.ownerUserId) return;
      const focus = practiceFocus(pending.sentence, assessment.words, {
        overall: assessment.overall, accuracy: assessment.accuracy, fluency: assessment.fluency,
        completeness: assessment.completeness, speakingRate: assessment.speakingRate,
      });
      const draft = { id: crypto.randomUUID(), ownerUserId: pending.ownerUserId,
        sentence: pending.sentence, translation: pending.translation, result: assessment };
      persistRecovery("score-ready", draft, focus.goal, practiceContextRef.current, focus.word);
      setResult(assessment);
      if (perfectScoreTimer.current !== null) window.clearTimeout(perfectScoreTimer.current);
      const shouldCelebrate = assessment.overall === 100
        && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setPerfectScoreArrival(shouldCelebrate);
      perfectScoreTimer.current = shouldCelebrate
        ? window.setTimeout(() => {
          setPerfectScoreArrival(false);
          perfectScoreTimer.current = null;
        }, 1500)
        : null;
      setPracticeGoal(focus.goal);
      setPracticeTargetWord(focus.word);
      setSaveDraft(draft);
      setSaveStatus("saving");
      setPendingAssessment(null);
      setPendingNeedsConfirmation(false);
      succeeded = true;
    } catch (cause) {
      if (pending.generation === generation.current && userIdRef.current === pending.ownerUserId
        && activeTaskOwner.current === pending.ownerUserId) {
        persistRecovery("ready", null);
        setToast(cause instanceof AssessmentError ? cause.message : "评估失败，录音仍保留在当前页面，可手动重试");
      }
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) request.current = null;
      if (pending.generation === generation.current && userIdRef.current === pending.ownerUserId) {
        setPhase(succeeded ? "idle" : "recorded");
      }
    }
  }

  async function startRecording() {
    if (authStatus !== "signed-in" || !userId || activeTaskOwner.current !== userId
      || !practiceTranslation || !canPractice || !lang
      || !confirmDiscard("当前评分尚未确认保存。再读一次会放弃这份未保存的评分，确定继续吗？")) return;
    if (hasUnsavedResult && userId) removePracticeRecoverySnapshot(getSessionStorage(), userId);
    audio.stop();
    const translation = practiceTranslation;
    const assessmentSentence = practiceSentence;
    const assessmentOwnerUserId = userId;
    const currentGeneration = ++generation.current;
    setPhase("starting");
    setToast("");
    setResult(null);
    if (perfectScoreTimer.current !== null) window.clearTimeout(perfectScoreTimer.current);
    perfectScoreTimer.current = null;
    setPerfectScoreArrival(false);
    setSaveDraft(null);
    setSaveStatus("idle");
    setPendingAssessment(null);
    setPendingNeedsConfirmation(false);
    setSelectedWord(null);
    persistRecovery("recording", null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setToast("当前浏览器不支持录音，请换用支持录音的浏览器");
      setPhase("idle");
      persistRecovery("ready", null);
      return;
    }
    const mimeType = ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"]
      .find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      setToast("当前浏览器不支持所需录音格式");
      setPhase("idle");
      persistRecovery("ready", null);
      return;
    }
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (currentGeneration !== generation.current || userIdRef.current !== assessmentOwnerUserId
        || activeTaskOwner.current !== assessmentOwnerUserId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const recorder = new MediaRecorder(stream, { mimeType });
      const current = { recorder, stream, started: 0, chunks: [] as Blob[], limitReached: false };
      recording.current = current;
      recorder.ondataavailable = (event) => {
        if (event.data.size) current.chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (currentGeneration !== generation.current) return;
        generation.current += 1;
        recorder.onstop = null;
        recording.current = null;
        stream?.getTracks().forEach((track) => track.stop());
        if (timer.current !== null) window.clearInterval(timer.current);
        timer.current = null;
        if (maxRecordingTimer.current !== null) window.clearTimeout(maxRecordingTimer.current);
        maxRecordingTimer.current = null;
        setPhase("idle");
        setToast("录音失败，请重试");
        persistRecovery("ready", null);
      };
      recorder.onstop = () => {
        current.stream.getTracks().forEach((track) => track.stop());
        recording.current = null;
        if (timer.current !== null) window.clearInterval(timer.current);
        timer.current = null;
        if (maxRecordingTimer.current !== null) window.clearTimeout(maxRecordingTimer.current);
        maxRecordingTimer.current = null;
        if (currentGeneration !== generation.current) return;
        if (performance.now() - current.started < 1000) {
          setToast("没录到声音，请重试");
          setPhase("idle");
          persistRecovery("ready", null);
          return;
        }
        const audio = new Blob(current.chunks, { type: recorder.mimeType || mimeType });
        if (!audio.size) {
          setToast("没录到声音，请重试");
          setPhase("idle");
          persistRecovery("ready", null);
          return;
        }
        if (audio.size > 10 * 1024 * 1024) {
          setToast("录音超过 10MB，请重录");
          setPhase("idle");
          persistRecovery("ready", null);
          return;
        }
        const pending = { audio, sentence: assessmentSentence, translation, lang,
          ownerUserId: assessmentOwnerUserId, generation: currentGeneration };
        setPendingAssessment(pending);
        if (current.limitReached) {
          setPendingNeedsConfirmation(true);
          setPhase("recorded");
          setToast("");
          return;
        }
        setPendingNeedsConfirmation(false);
        void submitPendingAssessment(pending);
      };
      recorder.start();
      current.started = performance.now();
      setElapsed(0);
      setPhase("recording");
      timer.current = window.setInterval(() => setElapsed(Math.floor((performance.now() - current.started) / 1000)), 250);
      maxRecordingTimer.current = window.setTimeout(() => {
        if (recording.current !== current || current.recorder.state !== "recording") return;
        current.limitReached = true;
        setElapsed(30);
        stopRecording();
      }, 29_500);
    } catch (cause) {
      stream?.getTracks().forEach((track) => track.stop());
      if (currentGeneration !== generation.current) return;
      recording.current = null;
      setPhase("idle");
      setToast(cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "PermissionDeniedError")
        ? "请开启麦克风权限后重试" : "录音无法开始，请重试");
      persistRecovery("ready", null);
    }
  }

  function stopRecording() {
    const current = recording.current;
    if (current?.recorder.state === "recording") {
      setPhase("assessing");
      current.recorder.stop();
    }
  }

  function changeSentence() {
    if (!confirmDiscard("当前评分尚未确认保存。换一句会停止保留这份评分的本地恢复副本，仍要继续吗？")) return;
    if (userId) removePracticeRecoverySnapshot(getSessionStorage(), userId);
    clearLearning();
    router.push("/");
  }

  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const aligned = result ? alignAssessmentWords(practiceSentence, result.words) : null;
  const selectedAssessment = selectedWord?.kind === "reference"
    ? aligned?.words[selectedWord.index]?.assessment
    : selectedWord?.kind === "insertion" ? aligned?.insertions[selectedWord.index]?.assessment : null;
  const selectedLabel = selectedWord?.kind === "reference"
    ? aligned?.words[selectedWord.index]?.text
    : selectedWord?.kind === "insertion" ? `多读「${aligned?.insertions[selectedWord.index]?.assessment.word}」` : null;
  const action = canPractice && lang ? <button type="button" className={`primary-button ${phase === "recording" ? "recording-button" : ""} ${phase === "assessing" ? "is-loading" : ""}`}
    disabled={phase === "starting" || phase === "assessing"}
    onClick={() => phase === "recording" ? stopRecording() : phase === "recorded" ? void submitPendingAssessment() : void startRecording()}>
    {phase === "recording" ? <><Icon name="stop" />停止 · {clock}</> : phase === "assessing" ? "评估中…" : phase === "starting" ? "正在请求麦克风…"
      : phase === "recorded" ? pendingNeedsConfirmation ? "确认完整并评分" : "重试评分"
        : result ? "再读一次" : <><Icon name="mic" />录音</>}
  </button> : undefined;

  return (
    <PageShell title="跟读练习" backHref={learningOrigin === "records" && recordReturnId ? `/records/detail?id=${encodeURIComponent(recordReturnId)}` : "/explanation"} beforeBack={confirmDiscard} action={action}>
      {!recoveryReady || recoveryUserId !== userId ? (
        <p className="supporting-copy" role="status">正在恢复当前练习…</p>
      ) : (
      <div className="page-stack practice-page">
        {recoveryNotice && <p className="supporting-copy" role="status">{recoveryNotice}</p>}
        {snapshotWarning && <p className="form-error" role="alert">{snapshotWarning}</p>}
        <section className="section-block">
          {canPractice ? (
            <>
              <p className="learning-sentence" lang="es">{practiceSentence}</p>
              {practiceGoal && !result && <div className="practice-goal" role="status"><p><strong>本次练习目标：</strong>{practiceGoal}</p>
                {practiceTargetWord && lang && <WordAudioControl word={practiceTargetWord} audio={audio} rate={audioRate} />}
              </div>}
            </>
          ) : (
            <><EmptyText>选定句子后，就可以听示范并练习朗读。</EmptyText><Link href="/" className="inline-link">去选句</Link></>
          )}
        </section>
        {canPractice && dialectStatus === "loading" && <p className="supporting-copy" role="status">正在加载方言设置…</p>}
        {canPractice && dialectStatus === "error" && <p className="form-error" role="alert">方言设置加载失败 <button type="button" className="inline-retry" onClick={() => void reloadDialect()}>重试</button></p>}
        {canPractice && lang && <DemoPlayer key={`${practiceSentence}:${lang}`} sentence={practiceSentence}
          annotation={repeatPractice ? null : explanation?.annotation ?? practiceContext?.annotation ?? null}
          audio={audio} rate={audioRate} setRate={setAudioRate} />}
        {canPractice && <p className="field-note">单次录音最长 30 秒；接近上限会自动停止，并由你确认是否评分。</p>}
        {phase === "recording" && elapsed >= 25 && <p className="assessment-status" role="status">录音即将到达 30 秒上限，请准备结束</p>}
        {pendingAssessment && phase === "recorded" && <div className="assessment-status" role="status">
          <p>{pendingNeedsConfirmation
            ? "录音已在 30 秒上限前停止。确认句子已经读完后再评分；如果尚未读完，可以重新录制。"
            : "评分尚未完成，录音仍保留在当前页面。你可以手动重试，或重新录制。"}</p>
          <button type="button" className="inline-retry" onClick={() => void startRecording()}>重新录制</button>
        </div>}
        {canPractice && practiceTranslation && <p className="practice-translation"><span>句意</span>{practiceTranslation}</p>}
        {phase === "assessing" && <p className="assessment-status" role="status">正在评估朗读…</p>}
        {result && <section className="section-block assessment-result" aria-label="评分结果">
          <SectionHeading>评分结果</SectionHeading>
          {saveStatus === "verifying" && <p className="record-save-status" role="status">正在核对云端保存状态…</p>}
          {saveStatus === "saving" && <p className="record-save-status" role="status">保存中…</p>}
          {saveStatus === "saved" && <p className="record-save-status" role="status">已保存到练习记录 · <Link className="inline-link" href={`/records/detail?id=${encodeURIComponent(saveDraft?.id ?? "")}`}>查看记录</Link></p>}
          {saveStatus === "failed" && <p className="record-save-status" role="alert">保存失败，评分结果仍在本页。<button type="button" className="inline-retry" onClick={() => setSaveStatus("saving")}>重试保存</button></p>}
          {saveStatus === "conflict" && <p className="record-save-status" role="alert">{recoveryNotice || "云端已有同 ID 的不同评分，本地结果未覆盖云端记录。"} {saveDraft && <Link className="inline-link" href={`/records/detail?id=${encodeURIComponent(saveDraft.id)}`}>查看云端记录</Link>}</p>}
          {saveStatus === "removed" && <p className="record-save-status" role="alert">{recoveryNotice || "云端没有找到这条已保存评分；本地副本不会自动重新写入。"}</p>}
          <div className={`assessment-overall${perfectScoreArrival && result.overall === 100 ? " celebrating" : ""}`}>
            {perfectScoreArrival && result.overall === 100 && <span className="assessment-sparkles" aria-hidden="true">
              {[
                [4, 18, 13, 0], [16, 77, 5, 90], [27, 8, 8, 160], [37, 91, 4, 240],
                [44, 12, 6, 70], [59, 88, 10, 180], [72, 9, 5, 280], [82, 78, 8, 120],
                [96, 22, 13, 210], [94, 87, 5, 320], [7, 51, 7, 350], [88, 47, 6, 60],
              ].map(([left, top, size, delay], index) => <i key={index} className={index % 3 === 1 ? "mote" : "spark"}
                style={{ left: `${left}%`, top: `${top}%`, width: `${size}px`, height: `${size}px`, animationDelay: `${delay}ms` }}>
                {index % 3 === 1 ? <svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="3.5" /></svg>
                  : <svg viewBox="0 0 20 20"><path d={index % 2 === 0
                    ? "M10 .8 12.2 7.8 19.2 10 12.2 12.2 10 19.2 7.8 12.2 .8 10 7.8 7.8Z"
                    : "M10 1 11.8 8.2 19 10 11.8 11.8 10 19 8.2 11.8 1 10 8.2 8.2Z"} /></svg>}
              </i>)}
            </span>}
            <strong>{Math.round(result.overall)}</strong><span>总分 / 100</span>
          </div>
          {result.overall === 100
            ? null
            : resultFocus?.goal && <div className="assessment-suggestions"><h3>下次留意</h3><p>{resultFocus.goal}</p></div>}
          <div className="assessment-words">
            <h3>逐词反馈</h3>
            <p className="assessment-word-help">有下划线的词值得再练；点词查看反馈，可靠对齐的词可听示范。</p>
            <div className="assessment-word-list" lang="es">
              {aligned?.words.map((word, index) => <Fragment key={`${word.start}-${index}`}>
                <span>{word.prefix}</span>
                <span className="assessment-word-group">
                  {word.leading}
                  {word.assessment ? <button type="button" className={`assessment-word ${word.assessment.accuracy < 80 || word.assessment.errorType !== "None" ? "needs-work" : ""} ${selectedWord?.kind === "reference" && selectedWord.index === index ? "selected" : ""}`}
                    aria-pressed={selectedWord?.kind === "reference" && selectedWord.index === index}
                    onClick={() => setSelectedWord({ kind: "reference", index })}>{word.text}</button>
                    : <span className="assessment-word-unscored">{word.text}</span>}
                  {word.trailing}
                </span>
              </Fragment>)}
              <span>{aligned?.suffix}</span>
            </div>
            {aligned && aligned.insertions.length > 0 && <div className="assessment-insertions">
              <p>多读词</p>
              {aligned.insertions.map((item, index) => <button type="button" key={index}
                aria-pressed={selectedWord?.kind === "insertion" && selectedWord.index === index}
                onClick={() => setSelectedWord({ kind: "insertion", index })}>
                「{item.assessment.word}」 · {item.beforeWordIndex === null ? "位置未确定" : item.beforeWordIndex === 0 ? "句首" : item.beforeWordIndex === aligned.words.length ? "句末" : `第 ${item.beforeWordIndex} 词后`}
              </button>)}
            </div>}
            {aligned && (aligned.unalignedCount > 0 || aligned.words.some((word) => !word.assessment))
              && <p className="assessment-word-feedback">部分词未能可靠对齐，未在原句上标出词级分数</p>}
            {selectedAssessment && <p className="assessment-word-feedback">{selectedLabel} · {Math.round(selectedAssessment.accuracy)}分：{selectedAssessment.feedback}</p>}
            {selectedWord?.kind === "reference" && selectedAssessment && selectedLabel &&
              <WordAudioControl word={selectedLabel} audio={audio} rate={audioRate} />}
          </div>
          <div className="assessment-dimensions">
            {([ ["准确度", result.accuracy], ["流利度", result.fluency], ["完整度", result.completeness] ] as const).map(([label, value]) => (
              <div className="assessment-dimension" key={label}>
                <div><span>{label}</span><span>{Math.round(value)}</span></div>
                <div className="assessment-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}><span style={{ width: `${value}%` }} /></div>
              </div>
            ))}
          </div>
          <p className="assessment-rate">语速 <strong>{result.speakingRate.wpm} 词/分 · {result.speakingRate.verdict}</strong><span>参考 {result.speakingRate.referenceWpm} 词/分</span></p>
          <div className="result-actions"><button type="button" className="plain-button" onClick={changeSentence}>换一句</button></div>
        </section>}
      </div>
      )}
      {toast && <div className="query-toast" role="alert">{toast}<button type="button" onClick={() => setToast("")}>关闭</button></div>}
    </PageShell>
  );
}
