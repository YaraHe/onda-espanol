const SAME_ORIGIN_SENTINEL = "__S4TEST_SAME_ORIGIN__";

export function getApiBaseUrl(configuredBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL) {
  if (configuredBaseUrl === SAME_ORIGIN_SENTINEL) {
    return typeof window === "undefined" ? null : window.location.origin;
  }
  const baseUrl = configuredBaseUrl?.trim();
  return baseUrl ? baseUrl.replace(/\/$/u, "") : null;
}
