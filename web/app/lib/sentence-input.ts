export const SENTENCE_CHARACTER_LIMIT = 200;
export const SENTENCE_WORD_LIMIT = 30;

export function normalizeSentenceInput(value: string) {
  let next = value.replace(/\r\n?/gu, "\n");
  const notices: string[] = [];

  if (next.length > SENTENCE_CHARACTER_LIMIT) {
    next = next.slice(0, SENTENCE_CHARACTER_LIMIT);
    notices.push(`句子超过 ${SENTENCE_CHARACTER_LIMIT} 字符，已保留前 ${SENTENCE_CHARACTER_LIMIT} 字符`);
  }

  const words = [...next.matchAll(/\S+/gu)];
  if (words.length > SENTENCE_WORD_LIMIT) {
    next = next.slice(0, words[SENTENCE_WORD_LIMIT].index).trimEnd();
    notices.push(`句子超过 ${SENTENCE_WORD_LIMIT} 词，已保留前 ${SENTENCE_WORD_LIMIT} 词`);
  }

  return { value: next, characterCount: next.length, notice: notices.join("；") };
}

export function isSentenceInputWithinLimits(value: string) {
  const normalized = value.replace(/\r\n?/gu, "\n");
  return normalized.length <= SENTENCE_CHARACTER_LIMIT
    && [...normalized.matchAll(/\S+/gu)].length <= SENTENCE_WORD_LIMIT;
}
