import assert from "node:assert/strict";
import test from "node:test";
import { collectRecentUniqueSentences } from "../app/lib/recent-practice.mjs";

test("recent practice scans past repeated pages to find five distinct sentences", async () => {
  const history = [
    ...Array.from({ length: 250 }, (_, index) => ({ id: `a-${index}`, sentence: index % 2 ? "HOLA." : " Hola. " })),
    ...["Gracias.", "¿Dónde está? ", "Buenos días.", "Adiós.", "Hasta luego."].map((sentence, index) => ({ id: `b-${index}`, sentence })),
  ];
  const offsets = [];
  const result = await collectRecentUniqueSentences(async (offset, pageSize) => {
    offsets.push(offset);
    return history.slice(offset, offset + pageSize);
  });

  assert.deepEqual(result.map((record) => record.id), ["a-0", "b-0", "b-1", "b-2", "b-3"]);
  assert.deepEqual(offsets, [0, 100, 200]);
});

test("recent practice checks all pages when history has fewer than five distinct sentences", async () => {
  const history = Array.from({ length: 215 }, (_, index) => ({
    id: `repeat-${index}`,
    sentence: index % 2 ? "¿DÓNDE   está el museo?" : "¿Dónde está el museo?",
  }));
  const offsets = [];
  const result = await collectRecentUniqueSentences(async (offset, pageSize) => {
    offsets.push(offset);
    return history.slice(offset, offset + pageSize);
  });

  assert.deepEqual(result.map((record) => record.id), ["repeat-0"]);
  assert.deepEqual(offsets, [0, 100, 200]);
});

test("recent practice ignores blank legacy rows and preserves page errors", async () => {
  const result = await collectRecentUniqueSentences(async () => [
    { id: "blank", sentence: "  " },
    { id: "first", sentence: "Hola." },
    { id: "variant", sentence: " HOLA. " },
  ], 5, 100);
  assert.deepEqual(result.map((record) => record.id), ["first"]);

  await assert.rejects(
    () => collectRecentUniqueSentences(async () => { throw new Error("network"); }),
    /network/,
  );
});

test("a later history-page failure rejects the whole recent-practice load", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `row-${index}`, sentence: "Hola." }));
  await assert.rejects(
    () => collectRecentUniqueSentences(async (offset) => {
      if (offset === 0) return firstPage;
      throw new Error("later page failed");
    }),
    /later page failed/,
  );
});
