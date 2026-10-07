export type Explanation = {
  translation: string;
  tenseMood: string;
  verbs: { form: string; infinitive: string; person: string; notes: string }[];
  structure: string;
  annotation?: {
    stress: { word: string; syllable: string; display: string }[];
    liaison: { words: string; pronounced: string; note: string }[];
    pauses: { after: string; type: string }[];
    pitchPattern: string;
  };
  memoryTip?: string;
  compare?: string;
};

export class ExplainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export async function fetchExplanation(sentence: string, lang = "es-ES", signal?: AbortSignal): Promise<Explanation> {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!baseUrl) throw new ExplainError("UPSTREAM_ERROR", "讲解服务暂时不可用，请稍后重试");

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentence, lang }),
      signal: controller.signal,
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const error = typeof body === "object" && body !== null && "error" in body ? body.error : null;
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
      const message = typeof error === "object" && error !== null && "message" in error ? error.message : null;
      throw new ExplainError(
        typeof code === "string" ? code : "UPSTREAM_ERROR",
        typeof message === "string" ? message : "查询失败，请稍后重试",
      );
    }
    if (!body || typeof body !== "object" || !("translation" in body) || typeof body.translation !== "string"
      || !("structure" in body) || typeof body.structure !== "string"
      || !("tenseMood" in body) || typeof body.tenseMood !== "string"
      || !("verbs" in body) || !Array.isArray(body.verbs)) {
      throw new ExplainError("EMPTY_UPSTREAM", "讲解内容不完整，请稍后重试");
    }
    return body as Explanation;
  } catch (cause) {
    if (cause instanceof ExplainError) throw cause;
    if (controller.signal.aborted) throw new ExplainError("UPSTREAM_ERROR", "查询超时，请重试");
    throw new ExplainError("UPSTREAM_ERROR", "网络连接失败，请检查网络后重试");
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
