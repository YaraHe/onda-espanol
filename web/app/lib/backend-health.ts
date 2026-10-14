import { getApiBaseUrl } from "./api-base.mjs";

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
