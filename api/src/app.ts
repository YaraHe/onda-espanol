import Fastify from "fastify";
import { createExplainHandler } from "./explain.ts";
import { createTtsHandler } from "./tts.ts";
import { createAssessHandler } from "./assess.ts";
import { createApiSecurity, type SecurityOptions } from "./security.ts";

export function createServer({
  allowedOrigin = process.env.FRONTEND_ORIGIN,
  explainFetch,
  deepSeekKey,
  ttsFetch,
  azureSpeechKey,
  azureSpeechRegion,
  assessFetch,
  assessTranscode,
  security = {},
}: { allowedOrigin?: string; explainFetch?: typeof fetch; deepSeekKey?: string; ttsFetch?: typeof fetch; azureSpeechKey?: string; azureSpeechRegion?: string; assessFetch?: typeof fetch; assessTranscode?: typeof import("./audio/transcode.ts").transcodeToAssessmentWav; security?: SecurityOptions } = {}) {
  const server = Fastify({
    logger: {
      redact: { paths: ["req.headers.authorization", "req.headers.cookie", "req.headers['set-cookie']"], censor: "[REDACTED]" },
      serializers: { req: (request) => ({ method: request.method, url: request.url.split("?", 1)[0] }) },
    },
    trustProxy: process.env.RENDER === "true",
  });
  const apiSecurity = createApiSecurity(security);

  server.addHook("onRequest", async (request, reply) => {
    reply.header("Vary", "Origin");
    const origin = request.headers.origin;
    const isAllowed = Boolean(allowedOrigin && origin === allowedOrigin);
    if (isAllowed) reply.header("Access-Control-Allow-Origin", origin).header("Access-Control-Expose-Headers", "Retry-After");

    if (request.method === "OPTIONS" && request.headers["access-control-request-method"]) {
      if (!isAllowed) {
        return reply.code(403).send({
          error: { code: "INVALID_PARAM", message: "不允许此来源跨域访问" },
        });
      }
      return reply
        .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        .header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        .code(204)
        .send();
    }
  });

  server.addHook("onRequest", async (request, reply) => {
    await apiSecurity.protect(request, reply);
  });
  server.addHook("onResponse", async (request, reply) => {
    apiSecurity.release(request);
    if (request.url.startsWith("/api/")) {
      request.log.info({
        event: "api_usage",
        route: request.routeOptions.url ?? request.url.split("?", 1)[0],
        status_code: reply.statusCode,
      }, "API request completed");
    }
  });

  server.get("/health", async () => ({ status: "ok" }));

  server.post("/api/explain", createExplainHandler({ fetcher: explainFetch, apiKey: deepSeekKey,
    reserveUpstream: (request, reply) => apiSecurity.reserveUpstream(request, reply, "explain") }));
  server.post("/api/tts", createTtsHandler({ fetcher: ttsFetch, apiKey: azureSpeechKey, region: azureSpeechRegion,
    reserveUpstream: (request, reply) => apiSecurity.reserveUpstream(request, reply, "tts") }));

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
    acquireAssessment: (request, reply) => apiSecurity.acquireAssessment(request, reply),
    reserveUpstream: (request, reply) => apiSecurity.reserveUpstream(request, reply, "assess"),
  }));

  return server;
}
