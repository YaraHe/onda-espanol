import assert from "node:assert/strict";
import test from "node:test";
import {
  filterLibrarySentences,
  librarySentences,
  pcicInventories,
  pickRandomSentence,
} from "../app/lib/sentence-library.ts";

test("the beginner library has distinct, attributed and reviewable PCIC-aligned entries", () => {
  assert.ok(librarySentences.length >= 20 && librarySentences.length <= 30);
  assert.equal(new Set(librarySentences.map((item) => item.id)).size, librarySentences.length);
  assert.equal(new Set(librarySentences.map((item) => item.sentence)).size, librarySentences.length);
  assert.deepEqual(new Set(librarySentences.map((item) => item.level)), new Set(["A1", "A2"]));
  assert.ok(Object.values(pcicInventories).every((url) => url.startsWith("https://cvc.cervantes.es/")));

  for (const item of librarySentences) {
    assert.equal(item.difficulty, item.level, item.id);
    assert.equal(item.source, "项目原创（参照 PCIC）", item.id);
    assert.ok(item.translation && item.scene && item.grammarPoint, item.id);
    assert.ok(item.sentence.trim().split(/\s+/u).length <= 30, item.id);
    for (const reference of Object.values(item.pcic)) {
      assert.match(reference, /^\d+(?:\.\d+)*\.?\s+\S/u, item.id);
    }
  }
});

test("three filters intersect and an unmatched combination is empty", () => {
  const selected = filterLibrarySentences(librarySentences, { difficulty: "A1", scene: "餐饮", grammarPoint: "gustar" });
  assert.deepEqual(selected.map((item) => item.id), ["food-04"]);
  assert.deepEqual(filterLibrarySentences(librarySentences, { difficulty: "A2", scene: "餐饮", grammarPoint: "gustar" }), []);
  assert.equal(filterLibrarySentences(librarySentences, { difficulty: "", scene: "", grammarPoint: "" }).length, librarySentences.length);
});

test("random selection stays in the library and handles empty input", () => {
  assert.equal(pickRandomSentence(librarySentences, () => 0), librarySentences[0]);
  assert.equal(pickRandomSentence(librarySentences, () => 0.999999), librarySentences.at(-1));
  assert.equal(pickRandomSentence([], () => 0), null);
});
