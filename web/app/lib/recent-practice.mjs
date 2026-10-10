import { sentenceIdentity } from "./sentence-identity.mjs";

/**
 * Read newest-first pages until enough distinct, non-empty sentences are found
 * or the complete history has been exhausted.
 * @template {{ id: string, sentence: string }} T
 * @param {(offset: number, pageSize: number) => Promise<T[]>} fetchPage
 * @param {number} limit
 * @param {number} pageSize
 * @returns {Promise<T[]>}
 */
export async function collectRecentUniqueSentences(fetchPage, limit = 5, pageSize = 100) {
  if (limit <= 0 || pageSize <= 0) return [];

  const sentences = [];
  const seen = new Set();
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(offset, pageSize);
    for (const record of page) {
      if (!record.sentence.trim()) continue;
      const identity = sentenceIdentity(record.sentence);
      if (seen.has(identity)) continue;
      seen.add(identity);
      sentences.push(record);
      if (sentences.length === limit) return sentences;
    }
    if (page.length < pageSize) return sentences;
  }
}
