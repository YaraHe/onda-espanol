import assert from "node:assert/strict";
import test from "node:test";
import { fetchExplanation } from "../app/lib/explanation.ts";
import { fetchDemoAudio } from "../app/lib/tts.ts";
import { fetchAssessment } from "../app/lib/assessment.ts";

test("the selected dialect reaches explanation, TTS and assessment requests", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const requests = [];
  globalThis.window = globalThis;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test";
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: options.body });
    if (url.endsWith("/api/explain")) {
      return Response.json({ translation: "你好", tenseMood: "现在时", structure: "问候", verbs: [] });
    }
    if (url.endsWith("/api/tts")) {
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
    }
    return Response.json({
      overall: 90, accuracy: 90, fluency: 90, completeness: 90,
      speakingRate: { wpm: 120, referenceWpm: 160, verdict: "适中" },
      words: [{ word: "Hola", accuracy: 90, errorType: "None", feedback: "良好" }],
      suggestions: [],
    });
  };

  try {
    const signal = new AbortController().signal;
    await fetchExplanation("Hola", "es-MX", signal);
    await fetchDemoAudio("Hola", 1, signal, "es-MX");
    await fetchAssessment(new Blob([1], { type: "audio/webm" }), "Hola", signal, "es-MX");
    assert.deepEqual(requests.map(({ url }) => new URL(url).pathname), ["/api/explain", "/api/tts", "/api/assess"]);
    assert.equal(JSON.parse(requests[0].body).lang, "es-MX");
    assert.equal(JSON.parse(requests[1].body).lang, "es-MX");
    assert.equal(requests[2].body.get("lang"), "es-MX");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    if (originalBaseUrl === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
    else process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
  }
});
