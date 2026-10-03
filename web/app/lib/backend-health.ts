export async function fetchBackendHealth(signal?: AbortSignal): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!baseUrl) throw new Error("Backend URL is not configured");

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, { signal });
  if (!response.ok) throw new Error(`Backend health returned ${response.status}`);

  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("status" in body) || body.status !== "ok") {
    throw new Error("Backend health response is invalid");
  }
}
