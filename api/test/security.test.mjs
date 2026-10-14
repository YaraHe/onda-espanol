import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../dist/app.js";

const audio = (() => {
  const data = Buffer.alloc(32_000);
  const wav = Buffer.alloc(44 + data.length);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24); wav.writeUInt32LE(32_000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(data.length, 40); data.copy(wav, 44);
  return wav;
})();

async function assessmentRequest(server, token, sentence = "Hola mundo") {
  const form = new FormData();
  form.set("sentence", sentence);
  form.set("audio", new Blob([audio], { type: "audio/webm" }), "recording.webm");
  const request = new Request("http://localhost/api/assess", { method: "POST", body: form });
  return server.inject({ method: "POST", url: "/api/assess", headers: {
    authorization: `Bearer ${token}`, "content-type": request.headers.get("content-type"),
  }, payload: Buffer.from(await request.arrayBuffer()) });
}

test("AI APIs require a validated Supabase access token", async (t) => {
  const server = createServer({ security: { verifyAccessToken: async (token) => token === "valid" ? "user-a" : null } });
  t.after(() => server.close());
  for (const authorization of [undefined, "Bearer expired"]) {
    const response = await server.inject({ method: "POST", url: "/api/tts", headers: authorization ? { authorization } : {}, payload: { sentence: "Hola" } });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "UNAUTHORIZED");
  }
});

test("Supabase Auth validation sends the access token server-to-server and fails closed", async (t) => {
  const priorFetch = globalThis.fetch;
  const priorUrl = process.env.SUPABASE_URL;
  const priorKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  let authRequest;
  process.env.SUPABASE_URL = "https://isolated-test.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  globalThis.fetch = async (url, init) => {
    authRequest = { url: String(url), headers: init.headers };
    return new Response(JSON.stringify({ id: "validated-user" }), { status: 200 });
  };
  const server = createServer({ azureSpeechKey: "" });
  t.after(async () => {
    await server.close();
    globalThis.fetch = priorFetch;
    if (priorUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = priorUrl;
    if (priorKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = priorKey;
  });
  const response = await server.inject({ method: "POST", url: "/api/tts",
    headers: { authorization: "Bearer isolated-access-token" }, payload: { sentence: "Hola" } });
  assert.equal(response.statusCode, 502);
  assert.match(authRequest.url, /^https:\/\/isolated-test\.supabase\.co\/auth\/v1\/user$/u);
  assert.equal(authRequest.headers.Authorization, "Bearer isolated-access-token");
  assert.equal(authRequest.headers.apikey, "sb_publishable_test");
});

test("rate limits are per authenticated user and return a retry delay", async (t) => {
  let calls = 0;
  const server = createServer({
    security: {
      verifyAccessToken: async (token) => ["a", "b", "c"].includes(token) ? `user-${token}` : null,
      limits: { tts: { short: { count: 1, windowMs: 60_000 }, daily: { count: 5, windowMs: 86_400_000 } } },
      ttsGlobalLimit: { count: 2, windowMs: 60_000 },
    },
    azureSpeechKey: "test", azureSpeechRegion: "eastus",
    ttsFetch: async () => { calls += 1; return new Response("audio", { status: 200, headers: { "content-type": "audio/mpeg" } }); },
  });
  t.after(() => server.close());
  const request = (token) => server.inject({ method: "POST", url: "/api/tts", headers: { authorization: `Bearer ${token}` }, payload: { sentence: "Hola" } });
  assert.equal((await request("a")).statusCode, 200);
  const limited = await request("a");
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().error.code, "RATE_LIMITED");
  assert.ok(Number(limited.headers["retry-after"]) > 0);
  assert.equal((await request("b")).statusCode, 200);
  const globalLimited = await request("c");
  assert.equal(globalLimited.statusCode, 429);
  assert.match(globalLimited.json().error.message, /当前示范播放较多/u);
  assert.equal(calls, 2);
});

test("invalid payloads do not consume any user's upstream quota", async (t) => {
  const calls = { explain: 0, assess: 0, tts: 0 };
  let transcodeCalls = 0;
  const tooLongAudio = Buffer.from(audio);
  tooLongAudio.writeUInt32LE(1_000, 28);
  const sentence = { isSpanish: true, translation: "你好", tenseMood: "不适用", verbs: [], structure: "问候语" };
  const assessment = { RecognitionStatus: "Success", NBest: [{ AccuracyScore: 80, FluencyScore: 80,
    CompletenessScore: 100, PronScore: 80,
    Words: [{ Word: "Hola", Offset: 0, Duration: 10_000_000, AccuracyScore: 80, ErrorType: "None" }] }] };
  const once = { short: { count: 1, windowMs: 60_000 }, daily: { count: 1, windowMs: 86_400_000 } };
  const server = createServer({
    security: { verifyAccessToken: async (token) => token === "a" ? "user-a" : null,
      limits: { explain: once, assess: once, tts: once } },
    deepSeekKey: "test", azureSpeechKey: "test", azureSpeechRegion: "eastus",
    explainFetch: async () => { calls.explain += 1; return new Response(JSON.stringify({ choices: [
      { message: { content: JSON.stringify(sentence) }, finish_reason: "stop" },
    ] }), { status: 200 }); },
    assessTranscode: async () => ++transcodeCalls === 1 ? tooLongAudio : audio,
    assessFetch: async () => { calls.assess += 1; return new Response(JSON.stringify(assessment), { status: 200 }); },
    ttsFetch: async () => { calls.tts += 1; return new Response("audio", { status: 200,
      headers: { "content-type": "audio/mpeg" } }); },
  });
  t.after(() => server.close());

  const explain = (payload) => server.inject({ method: "POST", url: "/api/explain",
    headers: { authorization: "Bearer a" }, payload });
  const tts = (payload) => server.inject({ method: "POST", url: "/api/tts",
    headers: { authorization: "Bearer a" }, payload });
  assert.equal((await explain({ sentence: " " })).statusCode, 400);
  assert.equal((await tts({ sentence: " " })).statusCode, 400);
  assert.equal((await assessmentRequest(server, "a", " ")).statusCode, 400);
  const tooLong = await assessmentRequest(server, "a");
  assert.equal(tooLong.statusCode, 400);
  assert.equal(tooLong.json().error.code, "RECORDING_TOO_LONG");

  assert.equal((await explain({ sentence: "¡Hola!" })).statusCode, 200);
  assert.equal((await tts({ sentence: "Hola" })).statusCode, 200);
  assert.equal((await assessmentRequest(server, "a")).statusCode, 200);
  assert.deepEqual(calls, { explain: 1, assess: 1, tts: 1 });

  assert.equal((await explain({ sentence: "¡Hola!" })).statusCode, 429);
  assert.equal((await tts({ sentence: "Hola" })).statusCode, 429);
  assert.equal((await assessmentRequest(server, "a")).statusCode, 429);
  assert.deepEqual(calls, { explain: 1, assess: 1, tts: 1 });
});

test("failed upstream calls consume quota because a provider attempt occurred", async (t) => {
  let calls = 0;
  const once = { short: { count: 1, windowMs: 60_000 }, daily: { count: 1, windowMs: 86_400_000 } };
  const server = createServer({
    security: { verifyAccessToken: async () => "user-a", limits: { tts: once } },
    azureSpeechKey: "test", azureSpeechRegion: "eastus",
    ttsFetch: async () => { calls += 1; throw new Error("simulated upstream timeout"); },
  });
  t.after(() => server.close());
  const request = () => server.inject({ method: "POST", url: "/api/tts",
    headers: { authorization: "Bearer token" }, payload: { sentence: "Hola" } });
  assert.equal((await request()).statusCode, 502);
  assert.equal((await request()).statusCode, 429);
  assert.equal(calls, 1);
});

test("each internal explain retry is counted as a separate upstream attempt", async (t) => {
  let calls = 0;
  const once = { short: { count: 1, windowMs: 60_000 }, daily: { count: 1, windowMs: 86_400_000 } };
  const server = createServer({
    security: { verifyAccessToken: async () => "user-a", limits: { explain: once } },
    deepSeekKey: "test",
    explainFetch: async () => { calls += 1; return new Response(JSON.stringify({ choices: [
      { message: { content: "{}" }, finish_reason: "stop" },
    ] }), { status: 200 }); },
  });
  t.after(() => server.close());
  const response = await server.inject({ method: "POST", url: "/api/explain",
    headers: { authorization: "Bearer token" }, payload: { sentence: "Hola" } });
  assert.equal(response.statusCode, 429);
  assert.equal(response.json().error.code, "RATE_LIMITED");
  assert.equal(calls, 1);
});

test("only one Azure assessment can be in flight per API process", async (t) => {
  let releaseUpstream;
  let providerCalls = 0;
  let transcodeCalls = 0;
  let upstreamStarted;
  const started = new Promise((resolve) => { upstreamStarted = resolve; });
  const server = createServer({
    security: { verifyAccessToken: async (token) => token === "a" ? "user-a" : token === "b" ? "user-b" : null,
      limits: { assess: { short: { count: 1, windowMs: 60_000 }, daily: { count: 1, windowMs: 86_400_000 } } } },
    azureSpeechKey: "test", azureSpeechRegion: "eastus",
    assessTranscode: async () => { transcodeCalls += 1; return audio; },
    assessFetch: async () => {
      providerCalls += 1;
      const response = new Response(JSON.stringify({
        RecognitionStatus: "Success", NBest: [{ AccuracyScore: 80, FluencyScore: 80, CompletenessScore: 100, PronScore: 80,
          Words: [{ Word: "Hola", Offset: 0, Duration: 10_000_000, AccuracyScore: 80, ErrorType: "None" }] }],
      }), { status: 200 });
      if (providerCalls > 1) return response;
      upstreamStarted();
      return new Promise((resolve) => { releaseUpstream = () => resolve(response); });
    },
  });
  t.after(() => server.close());
  const first = assessmentRequest(server, "a");
  await started;
  const busy = await assessmentRequest(server, "b");
  assert.equal(busy.statusCode, 429);
  assert.equal(busy.json().error.code, "SERVICE_BUSY");
  assert.equal(transcodeCalls, 1);
  releaseUpstream();
  assert.equal((await first).statusCode, 200);
  assert.equal((await assessmentRequest(server, "b")).statusCode, 200);
  const limited = await assessmentRequest(server, "b");
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().error.code, "RATE_LIMITED");
  assert.equal(providerCalls, 2);
  assert.equal(transcodeCalls, 2);
});
