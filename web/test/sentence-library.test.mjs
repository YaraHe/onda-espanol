import assert from "node:assert/strict";
import test from "node:test";
import { filterPersonalSentences, groupCheckboxAriaChecked, groupPersonalSentences, selectionState, toggleGroupSelection, toggleSentenceSelection } from "../app/lib/sentence-library.mjs";

const entries = [
  { id: "oct-10-b", sentence: "¿Dónde está la biblioteca?", translation: "图书馆在哪里？", created_at: "2026-10-10T08:00:00+08:00" },
  { id: "oct-10-a", sentence: "Buenos días.", translation: "早上好。", created_at: "2026-10-10T07:00:00+08:00" },
  { id: "oct-09", sentence: "Gracias.", translation: null, created_at: "2026-10-09T08:00:00+08:00" },
  { id: "sep", sentence: "Hasta luego.", translation: "再见。", created_at: "2026-09-30T08:00:00+08:00" },
];

test("personal sentence groups are stable month then day groups in newest-first order", () => {
  const groups = groupPersonalSentences(entries);
  assert.equal(groups.length, 2);
  assert.match(groups[0].label, /2026年10月/);
  assert.equal(groups[0].days.length, 2);
  assert.equal(groups[0].days[0].sentences.length, 2);
  assert.deepEqual(groups[0].days.flatMap((day) => day.sentences.map((item) => item.id)), ["oct-10-b", "oct-10-a", "oct-09"]);
});

test("entries with invalid collection dates remain visible in a deterministic fallback group", () => {
  const groups = groupPersonalSentences([{ id: "unknown", created_at: "invalid", sentence: "Hola" }]);
  assert.equal(groups[0].label, "日期未知");
  assert.equal(groups[0].days[0].label, "收录日期未知");
});

test("group checkbox state distinguishes empty, fully selected, and partial selection", () => {
  assert.equal(selectionState(["a", "b"], new Set()), "none");
  assert.equal(selectionState(["a", "b"], new Set(["a"])), "mixed");
  assert.equal(selectionState(["a", "b"], new Set(["a", "b"])), "all");
  assert.equal(selectionState([], new Set()), "none");
});

test("group checkbox exposes only valid unchecked, checked, and mixed ARIA values", () => {
  assert.equal(groupCheckboxAriaChecked("none"), false);
  assert.equal(groupCheckboxAriaChecked("all"), true);
  assert.equal(groupCheckboxAriaChecked("mixed"), "mixed");
});

test("search matches normalized Spanish source and Chinese translation without changing selection", () => {
  const matches = filterPersonalSentences(entries, "donde ESTA");
  assert.deepEqual(matches.map((item) => item.id), ["oct-10-b"]);
  assert.deepEqual(filterPersonalSentences(entries, "博物馆"), []);
  assert.deepEqual(filterPersonalSentences(entries, "图书馆在哪里？").map((item) => item.id), ["oct-10-b"]);
});

test("month/day selection toggles only its IDs and preserves prior selections in other groups", () => {
  const original = new Set(["previous-day"]);
  const withMonth = toggleGroupSelection(original, ["today-a", "today-b"]);
  assert.deepEqual([...withMonth], ["previous-day", "today-a", "today-b"]);
  const partial = toggleSentenceSelection(withMonth, "today-a");
  assert.deepEqual([...partial], ["previous-day", "today-b"]);
  const afterUnselect = toggleGroupSelection(partial, ["today-a", "today-b"]);
  assert.deepEqual([...afterUnselect].sort(), ["previous-day", "today-a", "today-b"].sort());
  assert.deepEqual([...original], ["previous-day"]);
});

test("large sentence collections keep every entry in month/day groups and support whole-day selection", () => {
  const manyEntries = Array.from({ length: 250 }, (_, index) => {
    const day = String(10 - Math.floor(index / 25)).padStart(2, "0");
    const sentence = {
      id: `large-${index}`,
      sentence: `Frase ${index}`,
      translation: null,
      identity_key: `large-${index}`,
      created_at: `2026-10-${day}T12:00:00+08:00`,
    };
    return sentence;
  });
  const groups = groupPersonalSentences(manyEntries);
  const allIds = groups.flatMap((month) => month.days.flatMap((day) => day.sentences.map((item) => item.id)));
  const todayIds = groups[0].days[0].sentences.map((item) => item.id);
  const selectedToday = toggleGroupSelection(new Set(), todayIds);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].days.length, 10);
  assert.equal(allIds.length, 250);
  assert.equal(new Set(allIds).size, 250);
  assert.equal(todayIds.length, 25);
  assert.equal(selectionState(todayIds, selectedToday), "all");
});
