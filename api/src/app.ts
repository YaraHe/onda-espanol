import Fastify from "fastify";
import { createExplainHandler } from "./explain.ts";
import { createTtsHandler } from "./tts.ts";
import { createAssessHandler } from "./assess.ts";

export function createServer({
  allowedOrigin = process.env.FRONTEND_ORIGIN,
  explainFetch,
  deepSeekKey,
  ttsFetch,
  azureSpeechKey,
  azureSpeechRegion,
  assessFetch,
  assessTranscode,
}: { allowedOrigin?: string; explainFetch?: typeof fetch; deepSeekKey?: string; ttsFetch?: typeof fetch; azureSpeechKey?: string; azureSpeechRegion?: string; assessFetch?: typeof fetch; assessTranscode?: typeof import("./audio/transcode.ts").transcodeToAssessmentWav } = {}) {
  const server = Fastify({ logger: true });

  server.addHook("onRequest", async (request, reply) => {
    reply.header("Vary", "Origin");
    const origin = request.headers.origin;
    const isAllowed = Boolean(allowedOrigin && origin === allowedOrigin);
    if (isAllowed) reply.header("Access-Control-Allow-Origin", origin);

    if (request.method === "OPTIONS" && request.headers["access-control-request-method"]) {
      if (!isAllowed) {
        return reply.code(403).send({
          error: { code: "INVALID_PARAM", message: "不允许此来源跨域访问" },
        });
      }
      return reply
        .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        .header("Access-Control-Allow-Headers", "Content-Type")
        .code(204)
        .send();
    }
  });

  server.get("/health", async () => ({ status: "ok" }));

  server.post("/api/explain", createExplainHandler({ fetcher: explainFetch, apiKey: deepSeekKey }));
  server.post("/api/tts", createTtsHandler({ fetcher: ttsFetch, apiKey: azureSpeechKey, region: azureSpeechRegion }));

  // The multipart envelope may exceed the 10 MB audio limit by a small amount.
  server.addContentTypeParser(
    "multipart/form-data",
    { parseAs: "buffer", bodyLimit: 10 * 1024 * 1024 + 64 * 1024 },
    (_request, body, done) => done(null, body),
  );
  server.post("/api/assess", {
    bodyLimit: 10 * 1024 * 1024 + 64 * 1024,
    errorHandler: (cause, _request, reply) => {
      if (cause.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
        return reply.code(400).send({ error: { code: "INVALID_AUDIO", message: "录音超过 10MB，请重录" } });
      }
      const status = cause.statusCode ?? 500;
      return reply.code(status).send({ error: status < 500
        ? { code: "INVALID_PARAM", message: "录音请求格式无效" }
        : { code: "UPSTREAM_ERROR", message: "发音评估暂时不可用，请稍后重试" } });
    },
  }, createAssessHandler({
    fetcher: assessFetch, transcode: assessTranscode, apiKey: azureSpeechKey, region: azureSpeechRegion,
  }));

  return server;
}
