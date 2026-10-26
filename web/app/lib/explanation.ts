import { ApiAuthenticationError, apiAuthorizationHeader } from "./api-auth";
import { getApiBaseUrl } from "./api-base.mjs";

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
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// Render Free services can take about a minute to wake after idle. Keep the
// browser request alive through that startup window; the API still enforces its
// separate 15-second upstream model timeout.
const EXPLANATION_REQUEST_TIMEOUT_MS = 75_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isVerb(value: unknown): value is Explanation["verbs"][number] {
  return isRecord(value)
    && isNonemptyString(value.form)
    && isNonemptyString(value.infinitive)
    && isNonemptyString(value.person)
    && isNonemptyString(value.notes);
}

function isAnnotation(value: unknown): value is NonNullable<Explanation["annotation"]> {
  if (!isRecord(value) || !Array.isArray(value.stress) || !Array.isArray(value.liaison) || !Array.isArray(value.pauses)
    || !isNonemptyString(value.pitchPattern)) return false;
  return value.stress.every((item) => isRecord(item)
      && isNonemptyString(item.word) && isNonemptyString(item.syllable) && isNonemptyString(item.display))
    && value.liaison.every((item) => isRecord(item)
      && isNonemptyString(item.words) && isNonemptyString(item.pronounced) && isNonemptyString(item.note))
    && value.pauses.every((item) => isRecord(item)
      && isNonemptyString(item.after) && isNonemptyString(item.type));
}

function explanationFrom(value: unknown): Explanation | null {
  if (!isRecord(value) || !isNonemptyString(value.translation) || !isNonemptyString(value.tenseMood)
    || !isNonemptyString(value.structure) || !Array.isArray(value.verbs) || !value.verbs.every(isVerb)) return null;

  const explanation: Explanation = {
    translation: value.translation,
    tenseMood: value.tenseMood,
    structure: value.structure,
    verbs: value.verbs,
  };
  if (isNonemptyString(value.memoryTip)) explanation.memoryTip = value.memoryTip;
  if (isNonemptyString(value.compare)) explanation.compare = value.compare;
  // These optional fields are teaching aids. Ignore malformed optional data so it
  // cannot break explanation rendering or leak an invalid annotation to practice.
  if (isAnnotation(value.annotation)) explanation.annotation = value.annotation;
  return explanation;
}

export async function fetchExplanation(sentence: string, lang = "es-ES", signal?: AbortSignal): Promise<Explanation> {
  const startedAt = performance.now();
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) throw new ExplainError("UPSTREAM_ERROR", "讲解服务暂时不可用，请稍后重试");

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = window.setTimeout(() => controller.abort(), EXPLANATION_REQUEST_TIMEOUT_MS);
  let sessionMs: number | undefined;
  let requestStartedAt: number | undefined;
  let requestMs: number | undefined;
  let bodyMs: number | undefined;
  let validationMs: number | undefined;
  let outcome = "error";
  try {
    const sessionStartedAt = performance.now();
    const authorization = await apiAuthorizationHeader();
    sessionMs = Math.round(performance.now() - sessionStartedAt);
    requestStartedAt = performance.now();
    const response = await fetch(`${baseUrl}/api/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authorization },
      body: JSON.stringify({ sentence, lang }),
      signal: controller.signal,
    });
    requestMs = Math.round(performance.now() - requestStartedAt);
    const bodyStartedAt = performance.now();
    const body: unknown = await response.json();
    bodyMs = Math.round(performance.now() - bodyStartedAt);
    if (!response.ok) {
      const error = typeof body === "object" && body !== null && "error" in body ? body.error : null;
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
      const message = typeof error === "object" && error !== null && "message" in error ? error.message : null;
      throw new ExplainError(
        typeof code === "string" ? code : "UPSTREAM_ERROR",
        typeof message === "string" ? message : "查询失败，请稍后重试",
      );
    }
    const validationStartedAt = performance.now();
    const explanation = explanationFrom(body);
    validationMs = Math.round(performance.now() - validationStartedAt);
    if (!explanation) {
      throw new ExplainError("EMPTY_UPSTREAM", "讲解内容不完整，请稍后重试");
    }
    outcome = "ok";
    return explanation;
  } catch (cause) {
    if (cause instanceof ExplainError) throw cause;
    if (cause instanceof ApiAuthenticationError) throw new ExplainError("UNAUTHORIZED", cause.message);
    if (controller.signal.aborted) throw new ExplainError("UPSTREAM_ERROR", "等待讲解结果超时，请检查网络后重试");
    throw new ExplainError("UPSTREAM_ERROR", "网络连接失败，请检查网络后重试");
  } finally {
    console.info("explain_client_timing", {
      session_ms: sessionMs,
      request_to_headers_ms: requestMs ?? (requestStartedAt === undefined ? undefined : Math.round(performance.now() - requestStartedAt)),
      response_body_ms: bodyMs,
      validation_ms: validationMs,
      total_ms: Math.round(performance.now() - startedAt),
      timed_out: controller.signal.aborted,
      outcome,
    });
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
