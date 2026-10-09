import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../dist/app.js";

test("health reports a running server", async (t) => {
  const server = createServer();
  t.after(() => server.close());

  const response = await server.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
});

async function multipart({ sentence = "¿Dónde está la biblioteca?", lang = "es-ES", audio = Uint8Array.from([1, 2, 3]), type = "audio/webm" } = {}) {
  const form = new FormData();
  form.set("sentence", sentence);
  form.set("lang", lang);
  form.set("audio", new Blob([audio], { type }), "recording.webm");
  const request = new Request("http://localhost/api/assess", { method: "POST", body: form });
  return { headers: { "content-type": request.headers.get("content-type") }, payload: Buffer.from(await request.arrayBuffer()) };
}

function wavSeconds(seconds) {
  const dataBytes = seconds * 32000;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

const azureAssessment = {
  RecognitionStatus: "Success",
  NBest: [{
    AccuracyScore: 82, FluencyScore: 78, CompletenessScore: 100, PronScore: 84,
    Words: [
      { Word: "Dónde", Offset: 0, Duration: 5_000_000, AccuracyScore: 95, ErrorType: "None" },
      { Word: "está", Offset: 5_000_000, Duration: 5_000_000, AccuracyScore: 92, ErrorType: "None" },
      { Word: "la", Offset: 10_000_000, Duration: 5_000_000, AccuracyScore: 91, ErrorType: "None" },
      { Word: "biblioteca", Offset: 15_000_000, Duration: 5_000_000, AccuracyScore: 52, ErrorType: "Mispronunciation" },
    ],
  }],
};

test("assess accepts multipart audio and maps actual Azure word-level fields", async (t) => {
  let call;
  const server = createServer({
    azureSpeechKey: "test-key", azureSpeechRegion: "eastus",
    assessTranscode: async () => wavSeconds(2),
    assessFetch: async (url, options) => {
      call = { url, options };
      return new Response(JSON.stringify(azureAssessment), { status: 200 });
    },
  });
  t.after(() => server.close());
  const response = await server.inject({ method: "POST", url: "/api/assess", ...await multipart() });
  assert.equal(response.statusCode, 200);
  const result = response.json();
  assert.deepEqual(Object.keys(result).sort(), ["overall", "accuracy", "fluency", "completeness", "speakingRate", "words", "suggestions"].sort());
  assert.equal(result.overall, 84);
  assert.equal(result.accuracy, 82);
  assert.deepEqual(result.speakingRate, { wpm: 120, referenceWpm: 160, verdict: "偏慢" });
  assert.equal(result.words[3].word, "biblioteca");
  assert.equal(result.words[3].accuracy, 52);
  assert.equal(result.words[3].errorType, "Mispronunciation");
  assert.match(result.words[3].feedback, /发音不够准确/);
  assert.match(result.suggestions.join(" "), /biblioteca/);
  assert.match(call.url, /language=es-ES&format=detailed/);
  assert.equal(call.options.headers["Content-Type"], "audio/wav; codecs=audio/pcm; samplerate=16000");
  assert.deepEqual(JSON.parse(Buffer.from(call.options.headers["Pronunciation-Assessment"], "base64").toString()), {
    ReferenceText: "¿Dónde está la biblioteca?", GradingSystem: "HundredMark", Granularity: "Word", Dimension: "Comprehensive", EnableMiscue: true,
  });
});

test("assess rejects invalid and short audio before Azure", async (t) => {
  let called = 0;
  const server = createServer({
    azureSpeechKey: "test-key", azureSpeechRegion: "eastus",
    assessTranscode: async () => wavSeconds(0.5),
    assessFetch: async () => { called += 1; return new Response(JSON.stringify(azureAssessment)); },
  });
  t.after(() => server.close());
  const invalid = await server.inject({ method: "POST", url: "/api/assess", ...await multipart({ type: "audio/wav" }) });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, "INVALID_AUDIO");
  const short = await server.inject({ method: "POST", url: "/api/assess", ...await multipart() });
  assert.equal(short.statusCode, 400);
  assert.equal(short.json().error.code, "AUDIO_TOO_SHORT");
  assert.equal(called, 0);
});

test("assess does not recommend an Azure insertion as a source sentence word", async (t) => {
  const withInsertion = structuredClone(azureAssessment);
  withInsertion.NBest[0].Words.splice(1, 0, {
    Word: "eh", Offset: 5_000_000, Duration: 1_000_000, AccuracyScore: 0, ErrorType: "Insertion",
  });
  const server = createServer({
    azureSpeechKey: "test-key", azureSpeechRegion: "eastus",
    assessTranscode: async () => wavSeconds(3),
    assessFetch: async () => new Response(JSON.stringify(withInsertion), { status: 200 }),
  });
  t.after(() => server.close());
  const response = await server.inject({ method: "POST", url: "/api/assess", ...await multipart() });
  assert.equal(response.statusCode, 200);
  assert.doesNotMatch(response.json().suggestions.join(" "), /「eh」/u);
  assert.match(response.json().suggestions.join(" "), /biblioteca/u);
});

test("assess does not recommend a misrecognized word absent from the reference sentence", async (t) => {
  const mismatched = structuredClone(azureAssessment);
  mismatched.NBest[0].Words[3] = {
    ...mismatched.NBest[0].Words[3], Word: "inventada", AccuracyScore: 0, ErrorType: "Mispronunciation",
  };
  const server = createServer({
    azureSpeechKey: "test-key", azureSpeechRegion: "eastus",
    assessTranscode: async () => wavSeconds(2),
    assessFetch: async () => new Response(JSON.stringify(mismatched), { status: 200 }),
  });
  t.after(() => server.close());
  const response = await server.inject({ method: "POST", url: "/api/assess", ...await multipart() });
  assert.equal(response.statusCode, 200);
  assert.doesNotMatch(response.json().suggestions.join(" "), /「inventada」/u);
});

test("assess rejects no-match audio and incomplete Azure scores", async (t) => {
  let upstream = { RecognitionStatus: "NoMatch" };
  const server = createServer({
    azureSpeechKey: "test-key", azureSpeechRegion: "eastus",
    assessTranscode: async () => wavSeconds(2),
    assessFetch: async () => new Response(JSON.stringify(upstream)),
  });
  t.after(() => server.close());
  const request = await multipart();
  const noMatch = await server.inject({ method: "POST", url: "/api/assess", ...request });
  assert.equal(noMatch.statusCode, 400);
  assert.equal(noMatch.json().error.code, "INVALID_AUDIO");
  upstream = { RecognitionStatus: "Success", NBest: [{
    PronScore: 0, AccuracyScore: 0, FluencyScore: 0, CompletenessScore: 0,
    Words: azureAssessment.NBest[0].Words.map((word) => ({ ...word, AccuracyScore: 0, ErrorType: "Omission", Offset: 0, Duration: 0 })),
  }] };
  const silence = await server.inject({ method: "POST", url: "/api/assess", ...request });
  assert.equal(silence.statusCode, 400);
  assert.equal(silence.json().error.code, "INVALID_AUDIO");
  upstream = { ...azureAssessment, NBest: [{ ...azureAssessment.NBest[0], PronScore: undefined }] };
  const incomplete = await server.inject({ method: "POST", url: "/api/assess", ...request });
  assert.equal(incomplete.statusCode, 502);
  assert.equal(incomplete.json().error.code, "UPSTREAM_ERROR");
  upstream = { ...azureAssessment, NBest: [{ ...azureAssessment.NBest[0], Words: azureAssessment.NBest[0].Words.map((word, index) => index === 0 ? { ...word, Offset: undefined } : word) }] };
  const missingTiming = await server.inject({ method: "POST", url: "/api/assess", ...request });
  assert.equal(missingTiming.statusCode, 502);
  assert.equal(missingTiming.json().error.code, "UPSTREAM_ERROR");
});

test("assess reports oversized multipart audio with the API error contract", async (t) => {
  const server = createServer();
  t.after(() => server.close());
  const request = await multipart({ audio: Buffer.alloc(10 * 1024 * 1024 + 65 * 1024) });
  const response = await server.inject({ method: "POST", url: "/api/assess", ...request });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "INVALID_AUDIO");
});

test("tts validates input before calling Azure", async (t) => {
  let called = 0;
  const server = createServer({
    azureSpeechKey: "test-key", azureSpeechRegion: "test-region",
    ttsFetch: async () => { called += 1; return new Response(Uint8Array.from([1])); },
  });
  t.after(() => server.close());
  for (const [payload, code] of [
    [{ sentence: " " }, "EMPTY_SENTENCE"],
    [{ sentence: 12 }, "INVALID_PARAM"],
    [{ sentence: "a".repeat(201) }, "INVALID_PARAM"],
    [{ sentence: "Hola", lang: "en-US" }, "INVALID_PARAM"],
    [{ sentence: "Hola", rate: 0.5 }, "INVALID_PARAM"],
    [{ sentence: "Hola", rate: 1.3 }, "INVALID_PARAM"],
    [{ sentence: "Hola", rate: "1" }, "INVALID_PARAM"],
  ]) {
    const response = await server.inject({ method: "POST", url: "/api/tts", payload });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, code);
  }
  assert.equal(called, 0);
});

test("tts streams MP3 with locale voice, speed and XML escaping", async (t) => {
  const requests = [];
  const audio = Uint8Array.from([0xff, 0xfb, 0x90, 0x64]);
  const server = createServer({
    azureSpeechKey: "test-key", azureSpeechRegion: "eastus",
    ttsFetch: async (url, options) => {
      requests.push({ url, options });
      return new Response(audio, { status: 200, headers: { "content-type": "audio/mpeg" } });
    },
  });
  t.after(() => server.close());
  const first = await server.inject({ method: "POST", url: "/api/tts", payload: { sentence: "¿Dónde está la biblioteca?" } });
  assert.equal(first.statusCode, 200);
  assert.match(first.headers["content-type"], /^audio\/mpeg/);
  assert.equal(first.headers["cache-control"], "no-store");
  assert.deepEqual(first.rawPayload, Buffer.from(audio));
  assert.equal(requests[0].url, "https://eastus.tts.speech.microsoft.com/cognitiveservices/v1");
  assert.equal(requests[0].options.headers["X-Microsoft-OutputFormat"], "audio-16khz-128kbitrate-mono-mp3");
  assert.match(requests[0].options.body, /name="es-ES-ElviraNeural"/);
  assert.match(requests[0].options.body, /rate="0%"/);

  const second = await server.inject({ method: "POST", url: "/api/tts", payload: { sentence: "Hola & <amigos>", lang: "es-MX", rate: 1.2 } });
  assert.equal(second.statusCode, 200);
  assert.match(requests[1].options.body, /name="es-MX-DaliaNeural"/);
  assert.match(requests[1].options.body, /rate="20%"/);
  assert.match(requests[1].options.body, /Hola &amp; &lt;amigos&gt;/);
});

test("tts reports Azure failure without returning audio", async (t) => {
  const server = createServer({
    azureSpeechKey: "test-key", azureSpeechRegion: "eastus",
    ttsFetch: async () => new Response("unavailable", { status: 503 }),
  });
  t.after(() => server.close());
  const response = await server.inject({ method: "POST", url: "/api/tts", payload: { sentence: "Hola" } });
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().error.code, "UPSTREAM_ERROR");
});

function deepSeekResponse(content, finishReason = "stop") {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) }, finish_reason: finishReason }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

const completeExplanation = {
  isSpanish: true,
  translation: "图书馆在哪里？",
  tenseMood: "现在时·陈述式",
  verbs: [{ form: "está", infinitive: "estar", person: "第三人称单数", notes: "表示位置" }],
  structure: "疑问词 + 动词 + 主语",
  annotation: {
    stress: [{ word: "biblioteca", syllable: "te", display: "biblioTEca" }],
    liaison: [], pauses: [], pitchPattern: "句末下降",
  },
  memoryTip: "问地点用 dónde + estar",
  compare: "和英语语序相近",
};

test("explain validates input and returns only the documented fields", async (t) => {
  let called = 0;
  const server = createServer({
    deepSeekKey: "test-key",
    explainFetch: async (_url, options) => {
      called += 1;
      const request = JSON.parse(options.body);
      assert.equal(request.model, "deepseek-flash");
      assert.deepEqual(request.thinking, { type: "disabled" });
      return deepSeekResponse(completeExplanation);
    },
  });
  t.after(() => server.close());

  for (const [payload, code] of [
    [{ sentence: "  " }, "EMPTY_SENTENCE"],
    [{ sentence: "Hola", lang: "en-US" }, "INVALID_PARAM"],
    [{ sentence: "a ".repeat(31) }, "INVALID_PARAM"],
    [{ sentence: "a".repeat(201) }, "INVALID_PARAM"],
  ]) {
    const response = await server.inject({ method: "POST", url: "/api/explain", payload });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, code);
  }
  assert.equal(called, 0);

  const response = await server.inject({ method: "POST", url: "/api/explain", payload: { sentence: " ¿Dónde está la biblioteca? " } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), (({ isSpanish, ...contract }) => contract)(completeExplanation));
  assert.equal(called, 1);
});

test("explain retries incomplete upstream data once and degrades optional sections", async (t) => {
  let called = 0;
  const server = createServer({
    deepSeekKey: "test-key",
    explainFetch: async () => {
      called += 1;
      return deepSeekResponse(called === 1
        ? { ...completeExplanation, translation: "" }
        : { ...completeExplanation, annotation: undefined, memoryTip: undefined, compare: undefined });
    },
  });
  t.after(() => server.close());

  const response = await server.inject({ method: "POST", url: "/api/explain", payload: { sentence: "Hola" } });
  assert.equal(response.statusCode, 200);
  assert.equal(called, 2);
  assert.equal(response.json().translation, completeExplanation.translation);
  assert.equal("annotation" in response.json(), false);
  assert.equal("memoryTip" in response.json(), false);
  assert.equal("compare" in response.json(), false);
});

test("explain reports non-Spanish input and exhausted retries", async (t) => {
  const nonSpanish = createServer({ deepSeekKey: "test-key", explainFetch: async () => deepSeekResponse({ isSpanish: false }) });
  t.after(() => nonSpanish.close());
  const rejected = await nonSpanish.inject({ method: "POST", url: "/api/explain", payload: { sentence: "Where is the library?" } });
  assert.equal(rejected.statusCode, 422);
  assert.equal(rejected.json().error.code, "NOT_SPANISH");

  let called = 0;
  const incomplete = createServer({ deepSeekKey: "test-key", explainFetch: async () => {
    called += 1;
    return deepSeekResponse({ ...completeExplanation, verbs: [{ form: "está" }] });
  } });
  t.after(() => incomplete.close());
  const response = await incomplete.inject({ method: "POST", url: "/api/explain", payload: { sentence: "¿Dónde está la biblioteca?" } });
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().error.code, "EMPTY_UPSTREAM");
  assert.equal(called, 2);
});

test("explain retries a no-verb claim contradicted by está", async (t) => {
  let called = 0;
  const server = createServer({
    deepSeekKey: "test-key",
    explainFetch: async () => {
      called += 1;
      return deepSeekResponse({ ...completeExplanation, verbs: [], tenseMood: "不适用" });
    },
  });
  t.after(() => server.close());

  for (const sentence of ["¿Dónde está la biblioteca?", "¿Dónde esta\u0301 la biblioteca?"]) {
    const response = await server.inject({ method: "POST", url: "/api/explain", payload: { sentence } });
    assert.equal(response.statusCode, 502);
    assert.equal(response.json().error.code, "EMPTY_UPSTREAM");
  }
  assert.equal(called, 4);
});

test("explain rejects no-verb claims contradicted by common copulas and auxiliaries", async (t) => {
  for (const sentence of [
    "Yo soy estudiante.", "Ella es profesora.", "Tú eres estudiante.",
    "Nosotros somos amigos.", "Vosotros sois estudiantes.",
    "Ellos son profesores.", "Vos sos profesor.",
    "Hay libros.", "Yo he llegado.", "Ella ha llegado.",
  ]) {
    let called = 0;
    const server = createServer({
      deepSeekKey: "test-key",
      explainFetch: async () => {
        called += 1;
        return deepSeekResponse({
          isSpanish: true, translation: "测试翻译", structure: "主语 + 表语",
          verbs: [], tenseMood: "不适用",
        });
      },
    });
    t.after(() => server.close());
    const response = await server.inject({ method: "POST", url: "/api/explain", payload: { sentence } });
    assert.equal(response.statusCode, 502, sentence);
    assert.equal(response.json().error.code, "EMPTY_UPSTREAM", sentence);
    assert.equal(called, 2, sentence);
  }
});

test("explain rejects a no-verb claim that contradicts its own structure", async (t) => {
  let called = 0;
  const server = createServer({
    deepSeekKey: "test-key",
    explainFetch: async () => {
      called += 1;
      return deepSeekResponse({
        isSpanish: true, translation: "我走路。", structure: "主语 + 动词 + 状语",
        verbs: [], tenseMood: "不适用",
      });
    },
  });
  t.after(() => server.close());
  const response = await server.inject({ method: "POST", url: "/api/explain", payload: { sentence: "Yo camino." } });
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().error.code, "EMPTY_UPSTREAM");
  assert.equal(called, 2);
});

test("explain documents the accepted limit of deterministic validation for coherent AI errors", async (t) => {
  // These upstream explanations are linguistically wrong. This test records
  // the approved server guarantee boundary, not a desired teaching outcome.
  let called = 0;
  const server = createServer({
    deepSeekKey: "test-key",
    explainFetch: async () => {
      called += 1;
      return deepSeekResponse({
        isSpanish: true, translation: "错误的讲解", structure: "无动词句",
        verbs: [], tenseMood: "不适用",
      });
    },
  });
  t.after(() => server.close());

  for (const sentence of ["Yo camino.", "Ella corre.", "Yo hablo español."]) {
    const response = await server.inject({ method: "POST", url: "/api/explain", payload: { sentence } });
    assert.equal(response.statusCode, 200, sentence);
    assert.deepEqual(response.json().verbs, [], sentence);
  }
  assert.equal(called, 3);
});

test("explain retries contradictory no-verb data and accepts a corrected result", async (t) => {
  let called = 0;
  const corrected = {
    isSpanish: true, translation: "她是老师。", structure: "主语 + 系动词 + 表语",
    verbs: [{ form: "es", infinitive: "ser", person: "第三人称单数", notes: "表示身份" }],
    tenseMood: "现在时·陈述式",
  };
  const server = createServer({
    deepSeekKey: "test-key",
    explainFetch: async () => deepSeekResponse(called++ === 0
      ? { ...corrected, verbs: [], tenseMood: "不适用" }
      : corrected),
  });
  t.after(() => server.close());
  const response = await server.inject({ method: "POST", url: "/api/explain", payload: { sentence: "Ella es profesora." } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().verbs, corrected.verbs);
  assert.equal(called, 2);
});

test("explain rejects disagreement between verbs and tenseMood", async (t) => {
  for (const upstream of [
    { verbs: [], tenseMood: "现在时·陈述式" },
    { verbs: completeExplanation.verbs, tenseMood: "不适用" },
  ]) {
    let called = 0;
    const server = createServer({
      deepSeekKey: "test-key",
      explainFetch: async () => {
        called += 1;
        return deepSeekResponse({ ...completeExplanation, ...upstream });
      },
    });
    t.after(() => server.close());
    const response = await server.inject({ method: "POST", url: "/api/explain", payload: { sentence: "¡Hola!" } });
    assert.equal(response.statusCode, 502);
    assert.equal(response.json().error.code, "EMPTY_UPSTREAM");
    assert.equal(called, 2);
  }
});

test("explain returns a corrected verb explanation on the second attempt", async (t) => {
  let called = 0;
  const server = createServer({
    deepSeekKey: "test-key",
    explainFetch: async () => {
      called += 1;
      return deepSeekResponse(called === 1
        ? { ...completeExplanation, verbs: [], tenseMood: "不适用" }
        : completeExplanation);
    },
  });
  t.after(() => server.close());

  const response = await server.inject({ method: "POST", url: "/api/explain", payload: { sentence: "¿DÓNDE ESTÁ LA BIBLIOTECA?" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().verbs, completeExplanation.verbs);
  assert.equal(called, 2);
});

test("explain rejects not-applicable tense for an obvious verb", async (t) => {
  let called = 0;
  const server = createServer({
    deepSeekKey: "test-key",
    explainFetch: async () => {
      called += 1;
      return deepSeekResponse({
        ...completeExplanation,
        verbs: [{ form: "Estamos", infinitive: "estar", person: "第一人称复数", notes: "表示状态" }],
        tenseMood: "不适用",
      });
    },
  });
  t.after(() => server.close());

  const response = await server.inject({ method: "POST", url: "/api/explain", payload: { sentence: "Estamos aquí." } });
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().error.code, "EMPTY_UPSTREAM");
  assert.equal(called, 2);
});

test("explain preserves genuinely verb-free phrases and ambiguous noun forms", async (t) => {
  let called = 0;
  const server = createServer({
    deepSeekKey: "test-key",
    explainFetch: async () => {
      called += 1;
      return deepSeekResponse({
        ...completeExplanation,
        translation: ["你好！", "这个车站！", "静态的！", "古巴的颂歌。", "现代时代。", "一块两公顷的地。"][called - 1],
        tenseMood: "不适用",
        verbs: [],
        structure: called === 1 ? "无动词句" : "感叹词或名词短语",
      });
    },
  });
  t.after(() => server.close());

  for (const sentence of ["¡Hola!", "¡Esta estación!", "¡Estático!", "El son cubano.", "La era moderna.", "Un terreno de 2 ha."]) {
    const response = await server.inject({ method: "POST", url: "/api/explain", payload: { sentence } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().verbs, []);
  }
  assert.equal(called, 6);
});

test("explain removes unsupported liaison and pause claims from teaching annotations", async (t) => {
  const server = createServer({
    deepSeekKey: "test-key",
    explainFetch: async () => deepSeekResponse({
      ...completeExplanation,
      annotation: {
        ...completeExplanation.annotation,
        liaison: [
          { words: "está la", pronounced: "está-la", note: "ordinary transition" },
          { words: "Dónde está", pronounced: "dón-des-tá", note: "vowel contact" },
        ],
        pauses: [{ after: "Dónde", type: "短停" }, { after: "está", type: "短停" }],
      },
    }),
  });
  t.after(() => server.close());
  const response = await server.inject({ method: "POST", url: "/api/explain", payload: { sentence: "¿Dónde está la biblioteca?" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().annotation.liaison.map((item) => item.words), ["Dónde está"]);
  assert.deepEqual(response.json().annotation.pauses, []);
});

test("explain reconstructs stress display from the source word and syllable", async (t) => {
  const server = createServer({
    deepSeekKey: "test-key",
    explainFetch: async () => deepSeekResponse({
      ...completeExplanation,
      annotation: {
        ...completeExplanation.annotation,
        stress: [
          { word: "amigos", syllable: "mi", display: "aMigos" },
          { word: "ajeno", syllable: "je", display: "aJEno" },
        ],
      },
    }),
  });
  t.after(() => server.close());
  const response = await server.inject({ method: "POST", url: "/api/explain", payload: { sentence: "Los amigos hablan español." } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().annotation.stress, [{ word: "amigos", syllable: "mi", display: "aMIgos" }]);
});

test("CORS allows the configured frontend and rejects other origins", async (t) => {
  const allowedOrigin = "https://spanish-example.vercel.app";
  const server = createServer({ allowedOrigin });
  t.after(() => server.close());

  const allowed = await server.inject({
    method: "GET", url: "/health", headers: { origin: allowedOrigin },
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers["access-control-allow-origin"], allowedOrigin);
  assert.equal(allowed.headers.vary, "Origin");

  const preflight = await server.inject({
    method: "OPTIONS", url: "/api/explain",
    headers: {
      origin: allowedOrigin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], allowedOrigin);
  assert.match(preflight.headers["access-control-allow-methods"], /POST/);
  assert.match(preflight.headers["access-control-allow-headers"], /Content-Type/i);

  const denied = await server.inject({
    method: "GET", url: "/health", headers: { origin: "https://other.example" },
  });
  assert.equal(denied.statusCode, 200);
  assert.equal(denied.headers["access-control-allow-origin"], undefined);

  const deniedPreflight = await server.inject({
    method: "OPTIONS", url: "/api/explain",
    headers: { origin: "https://other.example", "access-control-request-method": "POST" },
  });
  assert.equal(deniedPreflight.statusCode, 403);
  assert.equal(deniedPreflight.headers["access-control-allow-origin"], undefined);
});
