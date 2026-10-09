export type AssessmentResult = {
  overall: number;
  accuracy: number;
  fluency: number;
  completeness: number;
  speakingRate: { wpm: number; referenceWpm: number; verdict: "偏慢" | "适中" | "偏快" };
  words: { word: string; accuracy: number; errorType: string; feedback: string }[];
  suggestions: string[];
};

export class AssessmentError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function isAssessment(value: unknown): value is AssessmentResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<AssessmentResult>;
  const validScore = (score: unknown) => typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100;
  return validScore(result.overall) && validScore(result.accuracy) && validScore(result.fluency)
    && validScore(result.completeness)
    && !!result.speakingRate && Number.isFinite(result.speakingRate.wpm)
    && Number.isFinite(result.speakingRate.referenceWpm)
    && ["偏慢", "适中", "偏快"].includes(result.speakingRate.verdict)
    && Array.isArray(result.words) && result.words.length > 0
    && result.words.every((word) => typeof word.word === "string" && validScore(word.accuracy)
      && typeof word.errorType === "string" && typeof word.feedback === "string")
    && Array.isArray(result.suggestions) && result.suggestions.every((item) => typeof item === "string");
}

export async function fetchAssessment(audio: Blob, sentence: string, signal: AbortSignal, lang = "es-ES"): Promise<AssessmentResult> {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!baseUrl) throw new AssessmentError("UPSTREAM_ERROR", "发音评估暂时不可用，请稍后重试");

  const form = new FormData();
  form.append("audio", audio, audio.type.startsWith("audio/mp4") ? "recording.mp4" : "recording.webm");
  form.append("sentence", sentence);
  form.append("lang", lang);

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/assess`, { method: "POST", body: form, signal });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = body && typeof body === "object" && "error" in body ? body.error : null;
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      const message = error && typeof error === "object" && "message" in error ? error.message : null;
      throw new AssessmentError(typeof code === "string" ? code : "UPSTREAM_ERROR",
        typeof message === "string" ? message : "评估失败，请重试");
    }
    if (!isAssessment(body)) throw new AssessmentError("UPSTREAM_ERROR", "评估结果不完整，请重试");
    return body;
  } catch (cause) {
    if (cause instanceof AssessmentError) throw cause;
    if (signal.aborted) throw new AssessmentError("UPSTREAM_ERROR", "发音评估响应超时，请重试");
    throw new AssessmentError("UPSTREAM_ERROR", "网络连接失败，请检查网络后重试");
  }
}
