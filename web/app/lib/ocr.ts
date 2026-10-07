export function normalizeSpanishOcrText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}
