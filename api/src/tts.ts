import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";

const voices = {
  "es-ES": "es-ES-ElviraNeural",
  "es-MX": "es-MX-DaliaNeural",
} as const;

function error(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]!);
}

export function createTtsHandler({
  fetcher = fetch,
  apiKey = process.env.AZURE_SPEECH_KEY,
  region = process.env.AZURE_SPEECH_REGION,
  reserveUpstream = () => true,
}: { fetcher?: typeof fetch; apiKey?: string; region?: string;
  reserveUpstream?: (request: FastifyRequest, reply: FastifyReply) => boolean } = {}) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return error(reply, 400, "INVALID_PARAM", "请输入要朗读的西班牙语句子");
    }
    const { sentence: input, lang: inputLang, rate: inputRate } = body as Record<string, unknown>;
    if (typeof input !== "string") return error(reply, 400, "INVALID_PARAM", "句子格式无效");
    const sentence = input.trim();
    if (!sentence) return error(reply, 400, "EMPTY_SENTENCE", "请输入要朗读的西班牙语句子");
    if (sentence.length > 200) return error(reply, 400, "INVALID_PARAM", "句子不能超过 200 字符");
    const lang = inputLang ?? "es-ES";
    const rate = inputRate ?? 1;
    if (lang !== "es-ES" && lang !== "es-MX") {
      return error(reply, 400, "INVALID_PARAM", "请选择有效的西语方言");
    }
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0.6 || rate > 1.2) {
      return error(reply, 400, "INVALID_PARAM", "语速需在 0.6 到 1.2 之间");
    }
    if (!apiKey || !region) return error(reply, 502, "UPSTREAM_ERROR", "示范朗读暂时不可用，请稍后重试");

    const ratePercent = Math.round((rate - 1) * 100);
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice xml:lang="${lang}" name="${voices[lang]}"><prosody rate="${ratePercent}%">${escapeXml(sentence)}</prosody></voice></speak>`;
    const signal = AbortSignal.timeout(15_000);
    try {
      if (!reserveUpstream(request, reply)) return;
      request.log.info({ event: "upstream_usage", provider: "azure_speech", operation: "tts",
        text_characters: Array.from(sentence).length, language: lang, rate }, "AI upstream request started");
      const upstream = await fetcher(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": apiKey,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
          "User-Agent": "SpanishLearningApp",
        },
        body: ssml,
        signal,
      });
      request.log.info({ event: "upstream_usage_result", provider: "azure_speech", operation: "tts",
        upstream_status: upstream.status, text_characters: Array.from(sentence).length }, "AI upstream request completed");
      if (!upstream.ok || !upstream.body) {
        return error(reply, 502, "UPSTREAM_ERROR", "示范朗读暂时不可用，请稍后重试");
      }
      return reply.header("Cache-Control", "no-store").type("audio/mpeg").send(Readable.from(upstream.body));
    } catch {
      return error(reply, signal.aborted ? 504 : 502, "UPSTREAM_ERROR", signal.aborted
        ? "示范朗读响应超时，请重试"
        : "示范朗读暂时不可用，请稍后重试");
    }
  };
}
