import assert from "node:assert/strict";
import test from "node:test";
import { collectPersonalSentencePages } from "../app/lib/personal-sentence-pages.mjs";

test("personal sentence pagination collects every page in order and stops on a short page", async () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({ id: `sentence-${index}` }));
  const offsets = [];
  const result = await collectPersonalSentencePages(async (offset, pageSize) => {
    offsets.push([offset, pageSize]);
    return { data: rows.slice(offset, offset + pageSize), error: null };
  });

  assert.deepEqual(offsets, [[0, 100], [100, 100], [200, 100]]);
  assert.deepEqual(result, rows);
});

test("an empty first page returns an empty collection", async () => {
  let calls = 0;
  const result = await collectPersonalSentencePages(async () => {
    calls += 1;
    return { data: [], error: null };
  });

  assert.deepEqual(result, []);
  assert.equal(calls, 1);
});

test("a later page failure rejects instead of returning partial sentence data", async () => {
  let calls = 0;
  await assert.rejects(collectPersonalSentencePages(async (offset) => {
    calls += 1;
    return offset === 0
      ? { data: Array.from({ length: 100 }, (_, index) => index), error: null }
      : { data: null, error: new Error("network unavailable") };
  }), /个人句子加载失败，请重试/u);
  assert.equal(calls, 2);
});
