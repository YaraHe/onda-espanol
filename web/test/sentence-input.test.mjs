import assert from "node:assert/strict";
import test from "node:test";
import { isSentenceInputWithinLimits, normalizeSentenceInput, SENTENCE_CHARACTER_LIMIT, SENTENCE_WORD_LIMIT } from "../app/lib/sentence-input.ts";

test("sentence input counts spaces, punctuation, normalized line breaks, and UTF-16 code units", () => {
  const result = normalizeSentenceInput(" ¿Sí?\r\n😀 ");
  assert.equal(result.value, " ¿Sí?\n😀 ");
  assert.equal(result.characterCount, result.value.length);
  assert.equal(result.characterCount, 9);
  assert.equal(result.notice, "");
});

test("sentence input preserves text at the character boundary and reports overlong paste", () => {
  const accepted = normalizeSentenceInput("a".repeat(SENTENCE_CHARACTER_LIMIT));
  assert.equal(accepted.value.length, SENTENCE_CHARACTER_LIMIT);
  assert.equal(accepted.notice, "");
  assert.equal(isSentenceInputWithinLimits(accepted.value), true);

  const pasted = normalizeSentenceInput("a".repeat(SENTENCE_CHARACTER_LIMIT + 1));
  assert.equal(pasted.value, "a".repeat(SENTENCE_CHARACTER_LIMIT));
  assert.equal(pasted.characterCount, SENTENCE_CHARACTER_LIMIT);
  assert.match(pasted.notice, /已保留前 200 字符/u);
  assert.equal(isSentenceInputWithinLimits("a".repeat(SENTENCE_CHARACTER_LIMIT + 1)), false);
});

test("sentence input keeps the existing 30-word boundary and reports both limits when needed", () => {
  const thirtyWords = Array.from({ length: SENTENCE_WORD_LIMIT }, (_, index) => `w${index}`).join(" ");
  const accepted = normalizeSentenceInput(thirtyWords);
  assert.equal(accepted.value, thirtyWords);
  assert.equal(accepted.notice, "");

  const pasted = normalizeSentenceInput(`${"hola ".repeat(41)}x`);
  assert.equal(pasted.value.trim().split(/\s+/u).length, SENTENCE_WORD_LIMIT);
  assert.match(pasted.notice, /200 字符/u);
  assert.match(pasted.notice, /30 词/u);
  assert.equal(isSentenceInputWithinLimits(`${"hola ".repeat(31)}x`), false);
});
