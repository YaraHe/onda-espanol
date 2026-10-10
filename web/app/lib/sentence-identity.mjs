/**
 * Canonical identity for matching the same sentence across personal collection,
 * listening candidates, and practice history. Keep punctuation and accents so
 * potentially different Spanish sentences are never merged accidentally.
 * @param {string} sentence
 */
export function sentenceIdentity(sentence) {
  return sentence.trim().normalize("NFC").replace(/\s+/gu, " ").toLocaleLowerCase("es");
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
