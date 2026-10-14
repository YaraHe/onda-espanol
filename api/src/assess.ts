import type { FastifyReply, FastifyRequest } from "fastify";
import { transcodeToAssessmentWav } from "./audio/transcode.ts";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 30;
const REFERENCE_WPM = 160;

type AssessedWord = { word: string; accuracy: number; errorType: string; feedback: string };
type Assessment = {
  overall: number;
  accuracy: number;
  fluency: number;
  completeness: number;
  speakingRate: { wpm: number; referenceWpm: number; verdict: "偏慢" | "适中" | "偏快" };
  words: AssessedWord[];
  suggestions: string[];
};

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function score(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function error(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

function wavDurationSeconds(wav: Buffer): number | null {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") return null;
  let byteRate = 0;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const chunkSize = wav.readUInt32LE(offset + 4);
    const end = offset + 8 + chunkSize;
    if (end > wav.length) return null;
    const id = wav.toString("ascii", offset, offset + 4);
    if (id === "fmt " && chunkSize >= 16) byteRate = wav.readUInt32LE(offset + 16);
    if (id === "data") dataBytes = chunkSize;
    offset = end + (chunkSize % 2);
  }
  return byteRate > 0 && dataBytes > 0 ? dataBytes / byteRate : null;
}

function wordFeedback(errorType: string, accuracy: number): string {
  if (errorType === "Omission") return "这个词可能漏读了，请对照原句重读";
  if (errorType === "Insertion") return "这里可能多读了一个词，请对照原句";
  if (errorType === "Mispronunciation" || accuracy < 60) return "该词发音不够准确，可多听示范后重读";
  if (accuracy < 80) return "该词可以再练习，注意发音清晰";
  return "发音较准确";
}

function comparableWord(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function adaptAssessment(value: unknown, sentence: string): Assessment | null {
  const result = object(value);
  const best = Array.isArray(result?.NBest) ? object(result.NBest[0]) : null;
  if (result?.RecognitionStatus !== "Success" || !best || !score(best.PronScore)
    || !score(best.AccuracyScore) || !score(best.FluencyScore) || !score(best.CompletenessScore)
    || !Array.isArray(best.Words) || best.Words.length === 0) return null;

  const words: AssessedWord[] = [];
  const spokenTimings: { offset: number; end: number }[] = [];
  for (const raw of best.Words) {
    const word = object(raw);
    if (!word || typeof word.Word !== "string" || !word.Word.trim()
      || !score(word.AccuracyScore) || typeof word.ErrorType !== "string" || !word.ErrorType) return null;
    words.push({
      word: word.Word,
      accuracy: word.AccuracyScore,
      errorType: word.ErrorType,
      feedback: wordFeedback(word.ErrorType, word.AccuracyScore),
    });
    if (word.ErrorType !== "Omission") {
      if (typeof word.Offset !== "number" || !Number.isFinite(word.Offset) || word.Offset < 0
        || typeof word.Duration !== "number" || !Number.isFinite(word.Duration) || word.Duration <= 0) return null;
      spokenTimings.push({ offset: word.Offset, end: word.Offset + word.Duration });
    }
  }
  if (!spokenTimings.length) return null;
  const start = Math.min(...spokenTimings.map((item) => item.offset));
  const end = Math.max(...spokenTimings.map((item) => item.end));
  if (end <= start) return null;
  const wpm = Math.round(spokenTimings.length * 60 * 10_000_000 / (end - start));
  const verdict = wpm < 150 ? "偏慢" : wpm > 180 ? "偏快" : "适中";

  const suggestions: string[] = [];
  if (best.CompletenessScore < 60) suggestions.push("与原文不符，请对照原句读完整句");
  else if (best.CompletenessScore < 85) suggestions.push("尽量读完整句，避免漏词");
  const referenceCounts = new Map<string, number>();
  for (const token of sentence.match(/[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu) ?? []) {
    const key = comparableWord(token);
    referenceCounts.set(key, (referenceCounts.get(key) ?? 0) + 1);
  }
  const assessedCounts = new Map<string, number>();
  for (const word of words) {
    if (word.errorType === "Insertion") continue;
    const key = comparableWord(word.word);
    assessedCounts.set(key, (assessedCounts.get(key) ?? 0) + 1);
  }
  const sourceWords = words.filter((word) => {
    if (word.errorType === "Insertion") return false;
    const key = comparableWord(word.word);
    return referenceCounts.get(key) !== undefined && referenceCounts.get(key) === assessedCounts.get(key);
  });
  const weakest = sourceWords.reduce<AssessedWord | null>((left, right) =>
    !left || right.accuracy < left.accuracy ? right : left, null);
  if (weakest && weakest.accuracy < 80) suggestions.push(`「${weakest.word}」准确度较低，可多听示范后重读`);
  if (verdict === "偏慢") suggestions.push("语速可稍快，保持自然连贯");
  if (verdict === "偏快") suggestions.push("语速可稍慢，注意每个词的清晰度");
  if (!suggestions.length) suggestions.push("保持当前节奏，继续参照示范练习");

  return {
    overall: best.PronScore,
    accuracy: best.AccuracyScore,
    fluency: best.FluencyScore,
    completeness: best.CompletenessScore,
    speakingRate: { wpm, referenceWpm: REFERENCE_WPM, verdict },
    words,
    suggestions,
  };
}

export function createAssessHandler({
  fetcher = fetch,
  transcode = transcodeToAssessmentWav,
  apiKey = process.env.AZURE_SPEECH_KEY,
  region = process.env.AZURE_SPEECH_REGION,
  acquireAssessment = () => true,
  reserveUpstream = () => true,
}: { fetcher?: typeof fetch; transcode?: typeof transcodeToAssessmentWav; apiKey?: string; region?: string;
  acquireAssessment?: (request: FastifyRequest, reply: FastifyReply) => boolean;
  reserveUpstream?: (request: FastifyRequest, reply: FastifyReply) => boolean } = {}) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const contentType = request.headers["content-type"];
    if (!Buffer.isBuffer(request.body) || !contentType?.toLowerCase().startsWith("multipart/form-data")) {
      return error(reply, 400, "INVALID_PARAM", "请上传录音和参考句子");
    }
    let form: FormData;
    try {
      form = await new Response(new Uint8Array(request.body), { headers: { "Content-Type": contentType } }).formData();
    } catch {
      return error(reply, 400, "INVALID_PARAM", "录音请求格式无效");
    }
    const input = form.get("sentence");
    const inputLang = form.get("lang") ?? "es-ES";
    const file = form.get("audio");
    if (typeof input !== "string" || !input.trim() || (inputLang !== "es-ES" && inputLang !== "es-MX") || !(file instanceof File)) {
      return error(reply, 400, "INVALID_PARAM", "请提供有效的录音、句子和方言");
    }
    const sentence = input.trim();
    if (file.size === 0 || file.size > MAX_AUDIO_BYTES || !/^audio\/(webm|mp4)(?:;|$)/iu.test(file.type)) {
      return error(reply, 400, "INVALID_AUDIO", "录音格式或大小无效，请重录");
    }
    if (!apiKey || !region) return error(reply, 502, "UPSTREAM_ERROR", "发音评估暂时不可用，请稍后重试");
    if (!acquireAssessment(request, reply)) return;

    const signal = AbortSignal.timeout(30_000);
    let wav: Buffer;
    try {
      wav = await transcode(Buffer.from(await file.arrayBuffer()), signal);
    } catch {
      return error(reply, signal.aborted ? 504 : 400, signal.aborted ? "UPSTREAM_ERROR" : "INVALID_AUDIO",
        signal.aborted ? "发音评估响应超时，请重试" : "录音无法处理，请重录");
    }
    const duration = wavDurationSeconds(wav);
    if (duration === null) return error(reply, 400, "INVALID_AUDIO", "录音无法处理，请重录");
    if (duration < 1) return error(reply, 400, "AUDIO_TOO_SHORT", "没录到声音，请重试");
    if (duration > MAX_AUDIO_SECONDS) return error(reply, 400, "RECORDING_TOO_LONG", "录音超过 30 秒上限，请重录后再试");

    try {
      if (!reserveUpstream(request, reply)) return;
      request.log.info({ event: "upstream_usage", provider: "azure_speech", operation: "assessment",
        audio_seconds: Number(duration.toFixed(1)), audio_bytes: file.size, language: inputLang }, "AI upstream request started");
      const assessmentHeader = Buffer.from(JSON.stringify({
        ReferenceText: sentence,
        GradingSystem: "HundredMark",
        Granularity: "Word",
        Dimension: "Comprehensive",
        EnableMiscue: true,
      })).toString("base64");
      const upstream = await fetcher(`https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${inputLang}&format=detailed`, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": apiKey,
          "Pronunciation-Assessment": assessmentHeader,
          "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
          Accept: "application/json",
        },
        body: new Uint8Array(wav),
        signal,
      });
      request.log.info({ event: "upstream_usage_result", provider: "azure_speech", operation: "assessment",
        upstream_status: upstream.status, audio_seconds: Number(duration.toFixed(1)), audio_bytes: file.size }, "AI upstream request completed");
      if (!upstream.ok) return error(reply, 502, "UPSTREAM_ERROR", "发音评估暂时不可用，请稍后重试");
      const raw: unknown = await upstream.json();
      const azureResponse = object(raw);
      if (azureResponse?.RecognitionStatus !== "Success") {
        return error(reply, 400, "INVALID_AUDIO", "未识别到清晰朗读，请重录");
      }
      const best = Array.isArray(azureResponse.NBest) ? object(azureResponse.NBest[0]) : null;
      if (Array.isArray(best?.Words) && best.Words.length > 0
        && best.Words.every((word: unknown) => object(word)?.ErrorType === "Omission")) {
        return error(reply, 400, "INVALID_AUDIO", "未识别到清晰朗读，请重录");
      }
      const result = adaptAssessment(raw, sentence);
      if (!result) return error(reply, 502, "UPSTREAM_ERROR", "评估结果不完整，请重试");
      return reply.header("Cache-Control", "no-store").send(result);
    } catch {
      return error(reply, signal.aborted ? 504 : 502, "UPSTREAM_ERROR", signal.aborted
        ? "发音评估响应超时，请重试" : "发音评估暂时不可用，请稍后重试");
    }
  };
}
