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
  return records.filter((record) => sentenceIdentity(record.sentence) === identity);
}
