import { getApiBaseUrl } from "./api-base.mjs";

// A page entry may start a wake-up, but ordinary navigation must not keep a
// free instance alive. The timestamp also prevents duplicate effect mounts.
const PREWARM_INTERVAL_MS = 10 * 60_000;
const PREWARM_TIMEOUT_MS = 75_000;
let lastPrewarmAt = 0;

export async function fetchBackendHealth(signal?: AbortSignal): Promise<void> {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) throw new Error("Backend URL is not configured");

  const response = await fetch(`${baseUrl}/health`, { signal });
  if (!response.ok) throw new Error(`Backend health returned ${response.status}`);

  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("status" in body) || body.status !== "ok") {
    throw new Error("Backend health response is invalid");
  }
}

export function prewarmBackend(): void {
  if (!getApiBaseUrl()) return;
  const now = Date.now();
  if (now - lastPrewarmAt < PREWARM_INTERVAL_MS) return;
  lastPrewarmAt = now;

  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), PREWARM_TIMEOUT_MS);
  void fetchBackendHealth(controller.signal).then(
    () => console.info("explain_prewarm_timing", { health_ms: Math.round(performance.now() - startedAt), outcome: "ok" }),
    () => console.info("explain_prewarm_timing", { health_ms: Math.round(performance.now() - startedAt), outcome: "error" }),
  ).finally(() => window.clearTimeout(timeout));
}
