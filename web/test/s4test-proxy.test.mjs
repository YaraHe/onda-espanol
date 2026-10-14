import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSameOriginProxy, createStaticExportServer, parseOrigin, proxyHostMatches, proxyTargetForPath, resolveStaticExportFile } from "../scripts/dev-s4test-proxy.mjs";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function request(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port, path, method: options.method ?? "GET",
      headers: { Host: "127.0.0.1", ...options.headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

test("test origin accepts HTTPS and local loopback only", () => {
  assert.equal(parseOrigin("https://test-tunnel.example/"), "https://test-tunnel.example");
  assert.equal(parseOrigin("http://127.0.0.1:3100"), "http://127.0.0.1:3100");
  assert.throws(() => parseOrigin("http://public.example"), /must use HTTPS/u);
  assert.throws(() => parseOrigin("https://user:secret@example.test"), /without credentials/u);
  assert.throws(() => parseOrigin("https://example.test/path"), /origin only/u);
});

test("routing covers API, health, page routes and static assets", () => {
  assert.equal(proxyTargetForPath("/api/assess"), "api");
  assert.equal(proxyTargetForPath("/health"), "api");
  assert.equal(proxyTargetForPath("/practice"), "web");
  assert.equal(proxyTargetForPath("/_next/static/chunk.js"), "web");
  assert.equal(proxyTargetForPath("/manifest.webmanifest"), "web");
  assert.equal(proxyHostMatches("https://rotated-tunnel.example", "rotated-tunnel.example"), true);
  assert.equal(proxyHostMatches("https://rotated-tunnel.example", "other.example"), false);
});

test("same-origin proxy routes app pages and assets to Web, API paths to Fastify, and rejects unknown hosts", async (t) => {
  const web = http.createServer((req, res) => {
    res.setHeader("content-type", req.url.startsWith("/_next/") ? "application/javascript" : "text/html");
    res.end(`web:${req.method}:${req.url}`);
  });
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ method: req.method, url: req.url, authorization: req.headers.authorization, origin: req.headers.origin, body: Buffer.concat(chunks).toString() }));
    });
  });
  const webPort = await listen(web);
  const apiPort = await listen(api);
  const proxy = createSameOriginProxy({ origin: "http://127.0.0.1", webTarget: `http://127.0.0.1:${webPort}`, apiTarget: `http://127.0.0.1:${apiPort}` });
  await new Promise((resolve, reject) => { proxy.once("error", reject); proxy.once("listening", resolve); });
  t.after(async () => { await close(proxy); await close(web); await close(api); });
  const proxyPort = proxy.address().port;

  const page = await request(proxyPort, "/practice?from=records");
  assert.equal(page.status, 200);
  assert.equal(page.body, "web:GET:/practice?from=records");
  assert.equal(page.headers["content-type"], "text/html");

  const asset = await request(proxyPort, "/_next/static/chunk.js");
  assert.equal(asset.status, 200);
  assert.equal(asset.body, "web:GET:/_next/static/chunk.js");
  assert.equal(asset.headers["content-type"], "application/javascript");

  const manifest = await request(proxyPort, "/manifest.webmanifest");
  assert.equal(manifest.body, "web:GET:/manifest.webmanifest");

  const apiResponse = await request(proxyPort, "/api/assess?session=preserved", {
    method: "POST", headers: { Authorization: "Bearer test-token", Origin: "http://127.0.0.1" }, body: "audio-body",
  });
  assert.equal(apiResponse.status, 200);
  assert.deepEqual(JSON.parse(apiResponse.body), {
    method: "POST", url: "/api/assess?session=preserved", authorization: "Bearer test-token",
    origin: "http://127.0.0.1", body: "audio-body",
  });

  const health = await request(proxyPort, "/health");
  assert.equal(JSON.parse(health.body).url, "/health");

  const wrongHost = await request(proxyPort, "/", { headers: { Host: "unexpected.example" } });
  assert.equal(wrongHost.status, 421);
});

test("static export serves route HTML and hashed assets safely without directory listing", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "s4test-export-"));
  mkdirSync(join(root, "_next", "static", "chunks"), { recursive: true });
  mkdirSync(join(root, "login"), { recursive: true });
  writeFileSync(join(root, "index.html"), "home");
  writeFileSync(join(root, "login.html"), "login");
  writeFileSync(join(root, "_next", "static", "chunks", "app.js"), "bundle");
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(resolveStaticExportFile(root, "/"), join(root, "index.html"));
  assert.equal(resolveStaticExportFile(root, "/login?from=records"), join(root, "login.html"));
  assert.equal(resolveStaticExportFile(root, "/%2e%2e/secret"), null);
  assert.equal(resolveStaticExportFile(root, "/%5c..%5csecret"), null);

  const web = createStaticExportServer({ root, host: "127.0.0.1", port: 0 });
  await new Promise((resolve, reject) => { web.once("error", reject); web.once("listening", resolve); });
  t.after(async () => { await close(web); });
  const port = web.address().port;

  const login = await request(port, "/login");
  assert.equal(login.status, 200);
  assert.equal(login.body, "login");
  assert.match(login.headers["content-type"], /text\/html/u);
  assert.equal(login.headers["cache-control"], "no-cache");

  const asset = await request(port, "/_next/static/chunks/app.js");
  assert.equal(asset.status, 200);
  assert.equal(asset.body, "bundle");
  assert.match(asset.headers["content-type"], /application\/javascript/u);

  const missing = await request(port, "/private");
  assert.equal(missing.status, 404);
  const unsupportedMethod = await request(port, "/login", { method: "POST" });
  assert.equal(unsupportedMethod.status, 405);
});
