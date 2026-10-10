"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { nextListeningIndex, type ListeningSentence } from "./listening-playlist";
import { releaseAudioSource } from "./release-audio-source.mjs";
import { transitionPlaybackIntent } from "./listening-playback-state.mjs";
import { TtsError, fetchDemoAudio } from "./tts";

type Phase = "idle" | "loading" | "playing" | "gap" | "paused";
type Mode = "loop" | "focus";
type Target = { entry: ListeningSentence; index: number; mode: Mode };
type IntentAction = "play" | "pause" | "replace" | "retry";
type Playback = {
  generation: number;
  phase: Phase;
  shouldPlay: boolean;
  target: Target | null;
  controller: AbortController | null;
  requestTimeout: number | null;
  gapTimer: number | null;
  audio: HTMLAudioElement | null;
  url: string | null;
};

export function useListeningPlayer(playlist: ListeningSentence[], rate: number, intervalSeconds: number, lang: string | null) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [retryTarget, setRetryTarget] = useState<Target | null>(null);
  const options = useRef({ playlist, rate, intervalSeconds, lang });
  const focusTarget = useRef<Target | null>(null);
  const focusRestore = useRef<{ target: Target; wasStarted: boolean } | null>(null);
  const playback = useRef<Playback>({
    generation: 0, phase: "idle", shouldPlay: false, target: null, controller: null,
    requestTimeout: null, gapTimer: null, audio: null, url: null,
  });

  useEffect(() => { options.current = { playlist, rate, intervalSeconds, lang }; }, [playlist, rate, intervalSeconds, lang]);

  const clearPending = useCallback(() => {
    const current = playback.current;
    current.controller?.abort();
    current.controller = null;
    if (current.requestTimeout !== null) window.clearTimeout(current.requestTimeout);
    if (current.gapTimer !== null) window.clearTimeout(current.gapTimer);
    current.requestTimeout = null;
    current.gapTimer = null;
  }, []);

  const releaseSource = useCallback(() => {
    const current = playback.current;
    releaseAudioSource(current.audio, current.url);
    current.url = null;
  }, []);

  const stop = useCallback((updateState = true) => {
    const current = playback.current;
    current.generation += 1;
    clearPending();
    releaseSource();
    current.audio = null;
    current.target = null;
    current.phase = "idle";
    current.shouldPlay = false;
    focusTarget.current = null;
    focusRestore.current = null;
    if (updateState) {
      setPhase("idle"); setActiveKey(null); setFocusKey(null); setError(""); setRetryTarget(null);
    }
  }, [clearPending, releaseSource]);

  const fail = useCallback((target: Target, message: string) => {
    const current = playback.current;
    current.generation += 1;
    clearPending();
    releaseSource();
    current.audio = null;
    current.target = null;
    current.phase = "idle";
    // Keep shouldPlay intact so a retry cannot silently turn a paused request into playback.
    setPhase("idle");
    setActiveKey(null);
    setRetryTarget(target);
    setError(message);
    if (target.mode === "focus") setFocusKey(target.entry.key);
  }, [clearPending, releaseSource]);

  const playItem = useCallback(async function playItem(target: Target, intent: IntentAction = "play") {
    const current = playback.current;
    current.generation += 1;
    const generation = current.generation;
    clearPending();
    releaseSource();
    current.target = target;
    current.shouldPlay = transitionPlaybackIntent(current.shouldPlay, intent);
    current.phase = "loading";
    setPhase("loading");
    setActiveKey(target.entry.key);
    if (target.mode === "focus") setFocusKey(target.entry.key);
    setError("");
    setRetryTarget(null);

    const controller = new AbortController();
    current.controller = controller;
    current.requestTimeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const blob = await fetchDemoAudio(target.entry.sentence, options.current.rate, controller.signal, options.current.lang ?? "es-ES");
      if (generation !== current.generation) return;
      if (current.requestTimeout !== null) window.clearTimeout(current.requestTimeout);
      current.requestTimeout = null;
      current.controller = null;
      current.url = URL.createObjectURL(blob);
      const audio = new Audio(current.url);
      current.audio = audio;
      audio.onended = () => {
        if (generation !== current.generation || current.phase !== "playing") return;
        if (target.mode === "focus") {
          audio.currentTime = 0;
          void audio.play().catch(() => {
            if (generation === current.generation && current.phase === "playing" && current.shouldPlay) {
              fail(target, "音频无法继续播放，请重试");
            }
          });
          return;
        }
        releaseSource();
        const entries = options.current.playlist;
        const nextIndex = nextListeningIndex(target.index, entries.length);
        const nextEntry = entries[nextIndex];
        if (!nextEntry) { stop(); return; }
        const next = { entry: nextEntry, index: nextIndex, mode: "loop" as const };
        current.target = next;
        current.phase = "gap";
        setPhase("gap");
        setActiveKey(nextEntry.key);
        current.gapTimer = window.setTimeout(() => {
          if (generation === current.generation) void playItem(next);
        }, options.current.intervalSeconds * 1000);
      };
      audio.onerror = () => { if (generation === current.generation) fail(target, "音频无法播放，请重试"); };
      if (!current.shouldPlay) {
        current.phase = "paused";
        setPhase("paused");
        return;
      }
      await audio.play();
      if (generation === current.generation) { current.phase = "playing"; setPhase("playing"); }
    } catch (cause) {
      if (generation !== current.generation) return;
      fail(target, cause instanceof TtsError ? cause.message : "音频无法播放，请重试");
    }
  }, [clearPending, fail, releaseSource, stop]);

  const pause = useCallback(() => {
    const current = playback.current;
    if (current.phase !== "loading" && current.phase !== "playing" && current.phase !== "gap") return;
    current.shouldPlay = transitionPlaybackIntent(current.shouldPlay, "pause");
    if (current.phase === "playing") current.audio?.pause();
    else {
      current.generation += 1;
      clearPending();
      if (current.phase === "loading") releaseSource();
    }
    current.phase = "paused";
    setPhase("paused");
  }, [clearPending, releaseSource]);

  const resume = useCallback(async () => {
    const current = playback.current;
    if (current.phase !== "paused" || !current.target) return;
    const target = current.target;
    if (!current.audio?.src) { await playItem(target, "play"); return; }
    current.shouldPlay = transitionPlaybackIntent(current.shouldPlay, "play");
    const generation = current.generation;
    current.phase = "loading";
    setPhase("loading");
    try {
      await current.audio.play();
      if (generation !== current.generation || !current.shouldPlay || current.phase !== "loading") return;
      current.phase = "playing";
      setPhase("playing");
    } catch {
      if (generation === current.generation && current.shouldPlay && current.phase === "loading") {
        fail(target, "音频无法播放，请重试");
      }
    }
  }, [fail, playItem]);

  const startLoop = useCallback(() => {
    const first = options.current.playlist[0];
    if (first && options.current.lang) void playItem({ entry: first, index: 0, mode: "loop" });
  }, [playItem]);

  const startFocus = useCallback((entry: ListeningSentence, index: number) => {
    const current = playback.current;
    if (!options.current.lang || current.target?.mode === "focus") return;
    const wasStarted = current.target?.mode === "loop";
    const restoreTarget = wasStarted ? current.target : null;
    focusRestore.current = restoreTarget ? { target: restoreTarget, wasStarted: true } : null;
    current.generation += 1;
    clearPending();
    releaseSource();
    current.audio = null;
    current.target = null;
    current.phase = "idle";
    const target: Target = { entry, index, mode: "focus" };
    focusTarget.current = target;
    setFocusKey(entry.key);
    void playItem(target);
  }, [clearPending, playItem, releaseSource]);

  const switchFocus = useCallback((entry: ListeningSentence, index: number) => {
    if (!focusTarget.current) return;
    const target: Target = { entry, index, mode: "focus" };
    focusTarget.current = target;
    void playItem(target, "replace");
  }, [playItem]);

  const regenerateFocus = useCallback(() => {
    const target = focusTarget.current;
    if (!target || !options.current.lang) return;
    void playItem(target, "replace");
  }, [playItem]);

  const endFocus = useCallback(() => {
    if (!focusTarget.current) return;
    const restore = focusRestore.current;
    stop();
    if (restore?.wasStarted && restore.target) {
      const pausedTarget: Target = { ...restore.target, mode: "loop" };
      const current = playback.current;
      current.target = pausedTarget;
      current.phase = "paused";
      setPhase("paused");
      setActiveKey(pausedTarget.entry.key);
      setError("");
      setRetryTarget(null);
    }
  }, [stop]);

  const retry = useCallback(() => {
    if (!retryTarget || !options.current.lang) return;
    if (retryTarget.mode === "focus") {
      focusTarget.current = retryTarget;
      setFocusKey(retryTarget.entry.key);
    }
    void playItem(retryTarget, "retry");
  }, [playItem, retryTarget]);

  useEffect(() => { stop(); }, [playlist, stop]);
  useEffect(() => {
    const leave = () => stop(false);
    window.addEventListener("pagehide", leave);
    return () => { window.removeEventListener("pagehide", leave); stop(false); };
  }, [stop]);

  return { phase, activeKey, focusKey, isFocusing: focusTarget.current !== null, error, canRetry: Boolean(retryTarget), startLoop, startFocus, switchFocus, regenerateFocus, endFocus, pause, resume, retry, stop };
}
