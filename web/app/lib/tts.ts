import { ApiAuthenticationError, apiSession } from "./api-auth";
import { getApiBaseUrl } from "./api-base.mjs";

export class TtsError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const audioCache = new Map<string, Blob>();
const AUDIO_CACHE_MAX_ENTRIES = 100;

export async function fetchDemoAudio(sentence: string, rate: number, signal: AbortSignal, lang = "es-ES"): Promise<Blob> {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) throw new TtsError("UPSTREAM_ERROR", "示范朗读暂时不可用，请稍后重试");

  try {
    const session = await apiSession();
    const key = JSON.stringify([session.userId, lang, rate, sentence]);
    const cached = audioCache.get(key);
    if (cached) {
      audioCache.delete(key);
      audioCache.set(key, cached);
      return cached;
    }
    const response = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: session.Authorization },
      body: JSON.stringify({ sentence, lang, rate }),
      signal,
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const error = body && typeof body === "object" && "error" in body ? body.error : null;
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      const message = error && typeof error === "object" && "message" in error ? error.message : null;
      throw new TtsError(
        typeof code === "string" ? code : "UPSTREAM_ERROR",
        typeof message === "string" ? message : "示范朗读失败，请重试",
      );
    }
    if (!response.headers.get("content-type")?.startsWith("audio/mpeg")) {
      throw new TtsError("UPSTREAM_ERROR", "示范音频格式无效，请重试");
    }
    const audio = await response.blob();
    if (!audio.size) throw new TtsError("UPSTREAM_ERROR", "示范音频为空，请重试");
    audioCache.set(key, audio);
    if (audioCache.size > AUDIO_CACHE_MAX_ENTRIES) audioCache.delete(audioCache.keys().next().value!);
    return audio;
  } catch (cause) {
    if (cause instanceof TtsError) throw cause;
    if (cause instanceof ApiAuthenticationError) throw new TtsError("UNAUTHORIZED", cause.message);
    if (signal.aborted) throw new TtsError("UPSTREAM_ERROR", "示范朗读响应超时，请重试");
    throw new TtsError("UPSTREAM_ERROR", "网络连接失败，请检查网络后重试");
  }
}
