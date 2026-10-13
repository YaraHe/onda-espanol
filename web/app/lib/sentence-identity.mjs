/**
 * Canonical identity for matching the same Spanish sentence across the
 * personal collection, listening candidates, and practice history. The `v1`
 * punctuation rules are deliberately boundary-only; they never rewrite the
 * sentence stored or displayed to the learner.
 * @param {string} sentence
 */
export function sentenceIdentity(sentence) {
  const normalized = sentence.trim().normalize("NFC").replace(/\s+/gu, " ").toLocaleLowerCase("es").replace(/\.{3}/gu, "…");
  if (!normalized) return "";

  const hasQuestionBoundary = normalized.startsWith("¿") || normalized.endsWith("?");
  const hasExclamationBoundary = normalized.startsWith("¡") || normalized.endsWith("!");
  if (hasQuestionBoundary && !hasExclamationBoundary) {
    const core = normalized.replace(/^¿/u, "").replace(/\?$/u, "");
    if (core && !/[¿?¡!]/u.test(core)) return `q:${core}`;
  }
  if (hasExclamationBoundary && !hasQuestionBoundary) {
    const core = normalized.replace(/^¡/u, "").replace(/!$/u, "");
    if (core && !/[¿?¡!]/u.test(core)) return `e:${core}`;
  }
  if (/[¿?¡!]/u.test(normalized)) return `x:${normalized}`;

  if (normalized.endsWith(".") && !normalized.endsWith("..")) {
    const core = normalized.slice(0, -1);
    if (core && !core.endsWith(".")) return `s:${core}`;
  }
  return `s:${normalized}`;
}

/**
 * @template {{ sentence: string }} T
 * @param {T[]} records
 * @param {string} sentence
 * @returns {T[]}
 */
export function matchingSentenceRecords(records, sentence) {
  const identity = sentenceIdentity(sentence);
  if (!identity) return [];
  return records.filter((record) => sentenceIdentity(record.sentence) === identity);
}

/**
 * Keep the first (newest) row for each canonical sentence identity.
 * Callers must provide rows newest-first. Empty legacy sentences remain separate.
 * @template {{ id: string, sentence: string }} T
 * @param {T[]} records
 * @returns {T[]}
 */
export function latestUniqueSentenceRecords(records) {
  const seen = new Set();
  return records.filter((record) => {
    const identity = sentenceIdentity(record.sentence);
    const key = identity ? `sentence:${identity}` : `record:${record.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
