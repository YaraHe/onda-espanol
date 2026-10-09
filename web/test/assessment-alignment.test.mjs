import assert from "node:assert/strict";
import test from "node:test";
import { alignAssessmentWords, practiceFocus, recentPracticeFeedback, recentScorePoints } from "../app/lib/assessment-alignment.ts";

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

test("practice focus uses only a reliable source word and ignores Azure insertions", () => {
  const focus = practiceFocus("¿Dónde está la biblioteca?", [
    assessed("eh", 0, "Insertion"), assessed("Dónde", 95), assessed("está", 91),
    assessed("la", 90), assessed("biblioteca", 52, "Mispronunciation"),
  ]);
  assert.equal(focus.reliable, true);
  assert.equal(focus.word, "biblioteca");
  assert.match(focus.goal, /biblioteca/u);
});

test("unreliable legacy word feedback falls back to a sentence goal", () => {
  const fallback = practiceFocus("Buenos días.", [assessed("Buenas", 20), assessed("adiós", 95)]);
  assert.equal(fallback.reliable, false);
  assert.equal(fallback.word, null);
  assert.match(fallback.goal, /整句/u);
  const omission = practiceFocus("Hola, mundo!", [assessed("Hola"), assessed("mundo", 0, "Omission")]);
  assert.equal(omission.word, "mundo");
  assert.equal(omission.reliable, true);
});

test("a perfect score with no reliable weakness has no generic improvement goal", () => {
  const words = [assessed("Hola"), assessed("mundo")];
  const focus = practiceFocus("Hola mundo.", words, {
    overall: 100, accuracy: 96, fluency: 94, completeness: 100, speakingRate: { wpm: 160, verdict: "适中" },
  });
  assert.equal(focus.goal, null);
  assert.equal(focus.reliable, true);
  assert.match(focus.feedback, /100/u);
});

test("a reliable weak word remains actionable even when the overall score is perfect", () => {
  const focus = practiceFocus("Hola mundo.", [assessed("Hola"), assessed("mundo", 62, "Mispronunciation")], {
    overall: 100, accuracy: 96, fluency: 94, completeness: 100,
  });
  assert.equal(focus.word, "mundo");
  assert.match(focus.goal, /mundo/u);
});

test("aggregate score dimensions produce distinct sentence-level targets without a reliable weak word", () => {
  const noWords = [{ word: "Buenos", accuracy: 80, errorType: "None", feedback: "" }];
  const accuracy = practiceFocus("Hola mundo.", noWords, { overall: 86, accuracy: 72, fluency: 91, completeness: 95 });
  const fluency = practiceFocus("Hola mundo.", noWords, { overall: 86, accuracy: 91, fluency: 74, completeness: 95 });
  const completeness = practiceFocus("Hola mundo.", noWords, { overall: 86, accuracy: 91, fluency: 89, completeness: 78 });
  assert.equal(accuracy.word, null);
  assert.match(accuracy.goal, /整句发音更准确/u);
  assert.match(fluency.goal, /自然连贯/u);
  assert.match(completeness.goal, /读完整/u);
  assert.notEqual(accuracy.goal, fluency.goal);
  assert.notEqual(fluency.goal, completeness.goal);
});

test("a valid speaking-rate signal gives a sentence-level goal when score dimensions are unavailable", () => {
  const slow = practiceFocus("Hola mundo.", null, { speakingRate: 138 });
  const fast = practiceFocus("Hola mundo.", null, { speakingRate: 194 });
  assert.match(slow.goal, /节奏/u);
  assert.match(fast.goal, /放慢/u);
  assert.notEqual(slow.goal, fast.goal);
});

test("malformed word feedback degrades to valid aggregate signals, then to an explicit data-limited goal", () => {
  const dimensionFallback = practiceFocus("Hola mundo.", [{ word: 7 }, { word: "Hola", accuracy: "bad" }], {
    overall: 82, fluency: 69,
  });
  const noDataFallback = practiceFocus("Hola mundo.", [{ word: 7 }, null]);
  assert.match(dimensionFallback.goal, /自然连贯/u);
  assert.equal(dimensionFallback.reliable, true);
  assert.match(noDataFallback.feedback, /缺少/u);
  assert.match(noDataFallback.goal, /无法定位/u);
  assert.equal(noDataFallback.reliable, false);
});

test("recent detail feedback keeps date and score tied to the selected reliable attempt", () => {
  const history = [
    { id: "latest", overall: 100, accuracy: null, fluency: null, completeness: null, speaking_rate: null, raw_feedback: null },
    { id: "usable", overall: 86, accuracy: 70, fluency: 90, completeness: 95, speaking_rate: 160, raw_feedback: null },
  ];
  const selected = recentPracticeFeedback("Hola mundo.", history);
  assert.equal(selected.attempt.id, "usable");
  assert.match(selected.focus.goal, /整句发音更准确/u);
  assert.equal(selected.reliable, true);
});

test("score trend keeps at most five valid scores and returns chronological points", () => {
  const history = Array.from({ length: 7 }, (_, index) => ({
    id: String(index), created_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), overall: index * 10,
  })).reverse();
  const points = recentScorePoints(history);
  assert.deepEqual(points.map((point) => point.id), ["2", "3", "4", "5", "6"]);
  assert.deepEqual(points.map((point) => point.score), [20, 30, 40, 50, 60]);
  assert.deepEqual(recentScorePoints([{ id: "bad", created_at: null, overall: 120 }]), []);
});
