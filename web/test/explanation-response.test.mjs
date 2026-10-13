import assert from "node:assert/strict";
import test from "node:test";
import { ExplainError, fetchExplanation } from "../app/lib/explanation.ts";

async function withExplainResponse(payload, run) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  globalThis.window = globalThis;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test";
  globalThis.fetch = async () => Response.json(payload);
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    if (originalBaseUrl === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
    else process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
  }
}

test("valid explanation fields and valid pronunciation annotation remain available to practice", async () => {
  const annotation = {
    stress: [{ word: "biblioteca", syllable: "te", display: "biblioTEca" }],
    liaison: [],
    pauses: [],
    pitchPattern: "教学性提示",
  };
  await withExplainResponse({
    translation: "图书馆在哪里？",
    tenseMood: "现在时·陈述式",
    verbs: [{ form: "está", infinitive: "estar", person: "第三人称单数", notes: "表示位置" }],
    structure: "疑问词 + 动词 + 主语",
    annotation,
    memoryTip: "问地点使用 dónde。",
    compare: "西语疑问句以倒问号开头。",
  }, async () => {
    const result = await fetchExplanation("¿Dónde está la biblioteca?");
    assert.equal(result.translation, "图书馆在哪里？");
    assert.deepEqual(result.annotation, annotation);
    assert.equal(result.verbs[0].form, "está");
  });
});

test("malformed required grammar data returns a recoverable explanation error", async () => {
  await withExplainResponse({
    translation: "你好",
    tenseMood: "不适用",
    verbs: [null],
    structure: "问候语",
  }, async () => {
    await assert.rejects(fetchExplanation("Hola"), (error) =>
      error instanceof ExplainError && error.code === "EMPTY_UPSTREAM");
  });
});

test("malformed optional teaching data is omitted while the explanation remains usable", async () => {
  await withExplainResponse({
    translation: "你好",
    tenseMood: "不适用",
    verbs: [],
    structure: "问候语",
    annotation: { stress: "invalid", liaison: [], pauses: [], pitchPattern: "提示" },
    memoryTip: 42,
    compare: null,
  }, async () => {
    const result = await fetchExplanation("Hola");
    assert.equal(result.translation, "你好");
    assert.equal(result.annotation, undefined);
    assert.equal(result.memoryTip, undefined);
    assert.equal(result.compare, undefined);
  });
});
