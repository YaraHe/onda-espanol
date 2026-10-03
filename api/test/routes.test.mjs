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

test("AI routes are explicit stubs with no fabricated success data", async (t) => {
  const server = createServer();
  t.after(() => server.close());

  const requests = [
    { url: "/api/explain", payload: { sentence: "Hola", lang: "es-ES" } },
    { url: "/api/tts", payload: { sentence: "Hola", lang: "es-ES", rate: 1 } },
    {
      url: "/api/assess",
      headers: { "content-type": "multipart/form-data; boundary=stage1" },
      payload: Buffer.from("--stage1\r\nContent-Disposition: form-data; name=\"sentence\"\r\n\r\nHola\r\n--stage1--\r\n"),
    },
  ];

  for (const request of requests) {
    const response = await server.inject({ method: "POST", ...request });
    assert.equal(response.statusCode, 501, request.url);
    assert.deepEqual(response.json(), {
      error: { code: "NOT_IMPLEMENTED", message: "此接口尚未接入" },
    });
  }
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
