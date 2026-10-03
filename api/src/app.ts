import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";

export function createServer({ allowedOrigin = process.env.FRONTEND_ORIGIN }: { allowedOrigin?: string } = {}) {
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

  // Stage 1 only establishes the routes. Stage 2 supplies the documented AI results.
  const notImplemented = async (_request: FastifyRequest, reply: FastifyReply) =>
    reply.code(501).send({
      error: {
        code: "NOT_IMPLEMENTED",
        message: "此接口尚未接入",
      },
    });

  server.post("/api/explain", notImplemented);
  server.post("/api/tts", notImplemented);

  // Consume a bounded multipart body so the assess stub returns 501 for its
  // documented request type. Stage 2 replaces this with actual file parsing.
  server.addContentTypeParser(
    "multipart/form-data",
    { parseAs: "buffer", bodyLimit: 10 * 1024 * 1024 },
    (_request, body, done) => done(null, body),
  );
  server.post("/api/assess", { bodyLimit: 10 * 1024 * 1024 }, notImplemented);

  return server;
}
