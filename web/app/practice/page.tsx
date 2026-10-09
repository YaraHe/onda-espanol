"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "../components/icons";
import { EmptyText, PageShell, SectionHeading } from "../components/page-shell";
import { PronunciationAnnotation } from "../components/pronunciation-annotation";
import { useSentenceDraft } from "../components/sentence-draft";
import { useUserSettings } from "../components/user-settings-provider";
import { AssessmentError, AssessmentResult, fetchAssessment } from "../lib/assessment";
import { alignAssessmentWords, practiceFocus } from "../lib/assessment-alignment";
import { savePracticeRecord, type PracticeRecordDraft } from "../lib/practice-records";
import { TtsError, fetchDemoAudio } from "../lib/tts";

const rates = [0.6, 0.8, 1, 1.2] as const;
const discardMessage = "结果未保存，确定离开吗？";

type PlaybackTarget = "sentence" | "word";
type PlaybackState = { status: "idle" | "loading" | "playing"; target: PlaybackTarget | null; text: string; error: string };

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

  return { ...state, play, stop: () => stop() };
}

function DemoPlayer({ sentence, audio, rate, setRate }: {
  sentence: string;
  audio: ReturnType<typeof usePracticeAudio>;
  rate: number;
  setRate: (value: number) => void;
}) {
  const active = audio.target === "sentence" && audio.status !== "idle";
  return (
    <section className="section-block">
      <SectionHeading>听示范</SectionHeading>
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
  const { explainedSentence, explanation, repeatPractice, recordReturnId, clearLearning } = useSentenceDraft();
  const { lang, status: dialectStatus, reload: reloadDialect } = useUserSettings();
  const practiceSentence = repeatPractice?.sentence ?? explainedSentence;
  const practiceTranslation = repeatPractice?.translation ?? explanation?.translation;
  const canPractice = Boolean(practiceSentence && practiceTranslation);
  const [audioRate, setAudioRate] = useState<number>(1);
  const audio = usePracticeAudio(lang);
  const [phase, setPhase] = useState<"idle" | "starting" | "recording" | "assessing">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [toast, setToast] = useState("");
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [saveDraft, setSaveDraft] = useState<PracticeRecordDraft | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [selectedWord, setSelectedWord] = useState<{ kind: "reference" | "insertion"; index: number } | null>(null);
  const [practiceGoal, setPracticeGoal] = useState<string | null>(repeatPractice?.focus ?? null);
  const recording = useRef<{ recorder: MediaRecorder; stream: MediaStream; started: number; chunks: Blob[] } | null>(null);
  const request = useRef<AbortController | null>(null);
  const timer = useRef<number | null>(null);
  const generation = useRef(0);
  const resultFocus = result ? practiceFocus(practiceSentence, result.words, {
    overall: result.overall,
    accuracy: result.accuracy,
    fluency: result.fluency,
    completeness: result.completeness,
    speakingRate: result.speakingRate,
  }) : null;

  useEffect(() => {
    if (!saveDraft || saveStatus !== "saving") return;
    let active = true;
    void savePracticeRecord(saveDraft).then(() => {
      if (active) setSaveStatus("saved");
    }).catch(() => {
      if (active) setSaveStatus("failed");
    });
    return () => { active = false; };
  }, [saveDraft, saveStatus]);

  const hasUnsavedResult = result !== null && (saveStatus === "saving" || saveStatus === "failed");
  function confirmDiscard(): boolean {
    return !hasUnsavedResult || window.confirm(discardMessage);
  }

  useEffect(() => {
    if (!hasUnsavedResult) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedResult]);

  useEffect(() => {
    if (!hasUnsavedResult) return;
    const guardedWindow = window as Window & { __confirmPracticeHistoryLeave?: () => boolean };
    const confirmLeave = () => window.confirm(discardMessage);
    guardedWindow.__confirmPracticeHistoryLeave = confirmLeave;
    return () => {
      if (guardedWindow.__confirmPracticeHistoryLeave === confirmLeave) {
        delete guardedWindow.__confirmPracticeHistoryLeave;
      }
    };
  }, [hasUnsavedResult]);

  useEffect(() => () => {
    generation.current += 1;
    request.current?.abort();
    if (timer.current !== null) window.clearInterval(timer.current);
    const current = recording.current;
    if (current) {
      current.recorder.onstop = null;
      if (current.recorder.state !== "inactive") current.recorder.stop();
      current.stream.getTracks().forEach((track) => track.stop());
    }
  }, []);

  async function startRecording() {
    if (!practiceTranslation || !canPractice || !lang || !confirmDiscard()) return;
    audio.stop();
    const translation = practiceTranslation;
    const assessmentSentence = practiceSentence;
    const currentGeneration = ++generation.current;
    setPhase("starting");
    setToast("");
    setResult(null);
    setSaveDraft(null);
    setSaveStatus("idle");
    setSelectedWord(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setToast("当前浏览器不支持录音，请换用支持录音的浏览器");
      setPhase("idle");
      return;
    }
    const mimeType = ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"]
      .find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      setToast("当前浏览器不支持所需录音格式");
      setPhase("idle");
      return;
    }
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (currentGeneration !== generation.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const recorder = new MediaRecorder(stream, { mimeType });
      const current = { recorder, stream, started: 0, chunks: [] as Blob[] };
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
        setPhase("idle");
        setToast("录音失败，请重试");
      };
      recorder.onstop = () => {
        current.stream.getTracks().forEach((track) => track.stop());
        recording.current = null;
        if (timer.current !== null) window.clearInterval(timer.current);
        timer.current = null;
        if (currentGeneration !== generation.current) return;
        if (performance.now() - current.started < 1000) {
          setToast("没录到声音，请重试");
          setPhase("idle");
          return;
        }
        const audio = new Blob(current.chunks, { type: recorder.mimeType || mimeType });
        if (!audio.size) {
          setToast("没录到声音，请重试");
          setPhase("idle");
          return;
        }
        if (audio.size > 10 * 1024 * 1024) {
          setToast("录音超过 10MB，请重录");
          setPhase("idle");
          return;
        }
        const controller = new AbortController();
        request.current = controller;
        const timeout = window.setTimeout(() => controller.abort(), 30_000);
        setPhase("assessing");
        void fetchAssessment(audio, assessmentSentence, controller.signal, lang)
          .then((assessment) => {
            if (currentGeneration === generation.current) {
              setResult(assessment);
              setPracticeGoal(practiceFocus(assessmentSentence, assessment.words,
                { overall: assessment.overall, accuracy: assessment.accuracy, fluency: assessment.fluency,
                  completeness: assessment.completeness, speakingRate: assessment.speakingRate }).goal);
              setSaveDraft({ id: crypto.randomUUID(), sentence: assessmentSentence, translation, result: assessment });
              setSaveStatus("saving");
            }
          })
          .catch((cause) => {
            if (currentGeneration === generation.current) setToast(cause instanceof AssessmentError ? cause.message : "评估失败，请重试");
          })
          .finally(() => {
            window.clearTimeout(timeout);
            if (request.current === controller) request.current = null;
            if (currentGeneration === generation.current) setPhase("idle");
          });
      };
      recorder.start();
      current.started = performance.now();
      setElapsed(0);
      setPhase("recording");
      timer.current = window.setInterval(() => setElapsed(Math.floor((performance.now() - current.started) / 1000)), 250);
    } catch (cause) {
      stream?.getTracks().forEach((track) => track.stop());
      if (currentGeneration !== generation.current) return;
      recording.current = null;
      setPhase("idle");
      setToast(cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "PermissionDeniedError")
        ? "请开启麦克风权限后重试" : "录音无法开始，请重试");
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
    if (!confirmDiscard()) return;
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
    onClick={() => phase === "recording" ? stopRecording() : void startRecording()}>
    {phase === "recording" ? <><Icon name="stop" />停止 · {clock}</> : phase === "assessing" ? "评估中…" : phase === "starting" ? "正在请求麦克风…" : <><Icon name="mic" />录音</>}
  </button> : undefined;

  return (
    <PageShell title="跟读练习" backHref={repeatPractice && recordReturnId ? `/records/detail?id=${encodeURIComponent(recordReturnId)}` : "/explanation"} beforeBack={confirmDiscard} action={action}>
      <div className="page-stack">
        <section className="section-block">
          <SectionHeading>原句</SectionHeading>
          {canPractice ? (
            <>
              <p className="learning-sentence" lang="es">{practiceSentence}</p>
              {repeatPractice ? <p className="translation-text">{repeatPractice.translation}</p> : explanation && <PronunciationAnnotation annotation={explanation.annotation} />}
              {practiceGoal && !result && <p className="practice-goal" role="status"><strong>本次练习目标：</strong>{practiceGoal}</p>}
            </>
          ) : (
            <><EmptyText>选定句子后，就可以听示范并练习朗读。</EmptyText><Link href="/" className="inline-link">去选句</Link></>
          )}
        </section>
        {canPractice && dialectStatus === "loading" && <p className="supporting-copy" role="status">正在加载方言设置…</p>}
        {canPractice && dialectStatus === "error" && <p className="form-error" role="alert">方言设置加载失败 <button type="button" className="inline-retry" onClick={() => void reloadDialect()}>重试</button></p>}
        {canPractice && lang && <DemoPlayer key={`${practiceSentence}:${lang}`} sentence={practiceSentence} audio={audio} rate={audioRate} setRate={setAudioRate} />}
        {phase === "assessing" && <p className="assessment-status" role="status">正在评估朗读…</p>}
        {result && <section className={`section-block assessment-result${result.overall === 100 ? " assessment-perfect" : ""}`} aria-label="评分结果">
          <SectionHeading>评分结果</SectionHeading>
          {saveStatus === "saving" && <p className="record-save-status" role="status">保存中…</p>}
          {saveStatus === "saved" && <p className="record-save-status" role="status">已保存到练习记录</p>}
          {saveStatus === "failed" && <p className="record-save-status" role="alert">保存失败，评分结果仍在本页。<button type="button" className="inline-retry" onClick={() => setSaveStatus("saving")}>重试保存</button></p>}
          <div className="assessment-overall"><strong>{Math.round(result.overall)}</strong><span>总分 / 100</span></div>
          <div className="assessment-dimensions">
            {([ ["准确度", result.accuracy], ["流利度", result.fluency], ["完整度", result.completeness] ] as const).map(([label, value]) => (
              <div className="assessment-dimension" key={label}>
                <div><span>{label}</span><span>{Math.round(value)}</span></div>
                <div className="assessment-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}><span style={{ width: `${value}%` }} /></div>
              </div>
            ))}
          </div>
          <p className="assessment-rate">语速 <strong>{result.speakingRate.wpm} 词/分 · {result.speakingRate.verdict}</strong><span>参考 {result.speakingRate.referenceWpm} 词/分</span></p>
          <div className="assessment-words">
            <h3>逐词反馈</h3>
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
            {selectedWord?.kind === "reference" && selectedAssessment && <div className="word-audio-control">
              <button type="button" className="plain-button" onClick={() => audio.target === "word" && audio.text === selectedLabel && audio.status !== "idle"
                ? audio.stop() : void audio.play(selectedLabel ?? "", audioRate, "word")}>
                <Icon name={audio.target === "word" && audio.text === selectedLabel && audio.status !== "idle" ? "stop" : "volume"} />
                {audio.target === "word" && audio.text === selectedLabel && audio.status !== "idle" ? "停止词音" : `听「${selectedLabel}」`}
              </button>
              {audio.status === "loading" && audio.target === "word" && audio.text === selectedLabel && <p className="tts-feedback" role="status">正在生成词音…</p>}
              {audio.error && audio.target === "word" && audio.text === selectedLabel && <p className="tts-feedback tts-error" role="alert">{audio.error} <button type="button" onClick={() => void audio.play(selectedLabel ?? "", audioRate, "word")}>重试</button></p>}
            </div>}
          </div>
          {resultFocus?.goal && <div className="assessment-suggestions"><h3>提升方向</h3><p>{resultFocus.goal}</p></div>}
          <div className="result-actions"><button type="button" className="secondary-button" onClick={() => void startRecording()}>再读一次</button><button type="button" className="plain-button" onClick={changeSentence}>换一句</button></div>
        </section>}
      </div>
      {toast && <div className="query-toast" role="alert">{toast}<button type="button" onClick={() => setToast("")}>关闭</button></div>}
    </PageShell>
  );
}
