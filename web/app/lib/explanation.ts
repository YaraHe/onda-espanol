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
    const explanation = explanationFrom(body);
    if (!explanation) {
      throw new ExplainError("EMPTY_UPSTREAM", "讲解内容不完整，请稍后重试");
    }
    return explanation;
  } catch (cause) {
    if (cause instanceof ExplainError) throw cause;
    if (controller.signal.aborted) throw new ExplainError("UPSTREAM_ERROR", "查询超时，请重试");
    throw new ExplainError("UPSTREAM_ERROR", "网络连接失败，请检查网络后重试");
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
