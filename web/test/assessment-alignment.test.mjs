import assert from "node:assert/strict";
import test from "node:test";
import { alignAssessmentWords } from "../app/lib/assessment-alignment.ts";

const assessed = (word, accuracy = 90, errorType = "None") => ({ word, accuracy, errorType, feedback: word });

function renderedSource(aligned) {
  return aligned.words.map((word) => word.prefix + word.leading + word.text + word.trailing).join("") + aligned.suffix;
}

test("leading and middle insertions stay separate from the punctuated source sentence", () => {
  const sentence = "¿Dónde está la biblioteca?";
  const aligned = alignAssessmentWords(sentence, [
    assessed("eh", 0, "Insertion"), assessed("Dónde"), assessed("está"),
    assessed("pues", 0, "Insertion"), assessed("la"), assessed("biblioteca"),
  ]);
  assert.equal(renderedSource(aligned), sentence);
  assert.equal(aligned.words[0].leading, "¿");
  assert.equal(aligned.words.at(-1).trailing, "?");
  assert.deepEqual(aligned.words.map((word) => word.text), ["Dónde", "está", "la", "biblioteca"]);
  assert.deepEqual(aligned.words.map((word) => word.assessment?.word), ["Dónde", "está", "la", "biblioteca"]);
  assert.deepEqual(aligned.insertions.map((item) => [item.assessment.word, item.beforeWordIndex]), [["eh", 0], ["pues", 2]]);
  assert.equal(aligned.unalignedCount, 0);
});

test("omission attaches to its reference word without losing adjacent punctuation", () => {
  const sentence = "¡Hola, mundo!";
  const aligned = alignAssessmentWords(sentence, [assessed("Hola"), assessed("mundo", 0, "Omission")]);
  assert.equal(renderedSource(aligned), sentence);
  assert.equal(aligned.words[0].leading, "¡");
  assert.equal(aligned.words[0].trailing, ",");
  assert.equal(aligned.words[1].trailing, "!");
  assert.equal(aligned.words[1].assessment?.errorType, "Omission");
  assert.equal(aligned.words[1].assessment?.accuracy, 0);
});

test("repeated words receive distinct scores in reference order", () => {
  const sentence = "Como como pan, como.";
  const aligned = alignAssessmentWords(sentence, [
    assessed("como", 0, "Insertion"), assessed("Como", 95), assessed("como", 0, "Omission"),
    assessed("pan", 83), assessed("como", 61), assessed("pues", 0, "Insertion"),
  ]);
  assert.equal(renderedSource(aligned), sentence);
  assert.deepEqual(aligned.words.map((word) => word.assessment?.accuracy), [95, 0, 83, 61]);
  assert.deepEqual(aligned.insertions.map((item) => item.beforeWordIndex), [0, 4]);
});

test("spacing, line breaks, quotation marks and punctuation retain their source positions", () => {
  const sentence = "  ¡Hola,  mundo!\n¿Otra vez?  ";
  const aligned = alignAssessmentWords(sentence, [
    assessed("Hola"), assessed("mundo"), assessed("Otra"), assessed("vez"),
  ]);
  assert.equal(renderedSource(aligned), sentence);
  assert.equal(aligned.words[0].start, 3);
  assert.equal(aligned.words[3].text, "vez");
  assert.equal(aligned.words[3].trailing, "?");
  assert.equal(aligned.suffix, "  ");
});

test("ambiguous repeated words and mismatched words are left unscored", () => {
  const repeated = alignAssessmentWords("uno uno.", [assessed("uno", 25)]);
  assert.deepEqual(repeated.words.map((word) => word.assessment), [null, null]);
  assert.equal(repeated.unalignedCount, 1);

  const mismatch = alignAssessmentWords("Buenos días.", [assessed("Buenas", 25), assessed("días", 92)]);
  assert.equal(mismatch.words[0].assessment, null);
  assert.equal(mismatch.words[1].assessment?.accuracy, 92);
  assert.equal(mismatch.unalignedCount, 1);
});

test("an insertion before an unmatched repeated word has no reliable source position", () => {
  const sentence = "uno uno.";
  const aligned = alignAssessmentWords(sentence, [assessed("x", 0, "Insertion"), assessed("uno", 91)]);
  assert.equal(renderedSource(aligned), sentence);
  assert.deepEqual(aligned.words.map((word) => word.assessment), [null, null]);
  assert.deepEqual(aligned.insertions.map((item) => [item.assessment.word, item.beforeWordIndex]), [["x", null]]);
  assert.equal(aligned.unalignedCount, 1);
});

test("an insertion after an unmatched repeated word also has no reliable source position", () => {
  const aligned = alignAssessmentWords("uno uno.", [assessed("uno", 91), assessed("x", 0, "Insertion")]);
  assert.deepEqual(aligned.words.map((word) => word.assessment), [null, null]);
  assert.equal(aligned.insertions[0].beforeWordIndex, null);
});

test("accent differences allow alignment while the displayed source stays exact", () => {
  const sentence = "¿Dónde?";
  const aligned = alignAssessmentWords(sentence, [assessed("donde", 70)]);
  assert.equal(renderedSource(aligned), sentence);
  assert.equal(aligned.words[0].text, "Dónde");
  assert.equal(aligned.words[0].assessment?.accuracy, 70);
});
