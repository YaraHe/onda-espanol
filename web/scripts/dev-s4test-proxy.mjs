import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, extname, join, posix, resolve, sep } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "../..");
const webDir = join(rootDir, "web");
const apiDir = join(rootDir, "api");
const isolatedRef = "ebmwdxldjyomgkedtxae";
const productionRef = "ayhesvovoyqsmrhjuhwa";
const loopback = "127.0.0.1";
const proxyPort = 3100;
const webPort = 3101;
const sameOriginSentinel = "__S4TEST_SAME_ORIGIN__";

function readEnv(path) {
  if (!existsSync(path)) throw new Error(`Missing local config: ${path}`);
  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function required(values, key, label = key) {
  const value = values[key]?.trim();
  if (!value) throw new Error(`Missing ${label} in the local test configuration.`);
  return value;
}

export function parseOrigin(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error("Provide a complete --origin URL."); }
  if (!/^https?:$/u.test(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Origin must be an http(s) origin only, without credentials, path, query, or fragment.");
  }
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !isLoopback) throw new Error("Non-local origins must use HTTPS.");
  return parsed.origin;
}

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? Number(process.argv[index + 1]) : fallback;
}

function validate(originValue) {
  const origin = parseOrigin(originValue);
  const webTestEnv = readEnv(join(webDir, ".env.s4test.local"));
  const apiEnv = readEnv(join(apiDir, ".env.local"));
  const supabaseUrl = required(webTestEnv, "S4_TEST_SUPABASE_URL");
  const publishableKey = required(webTestEnv, "S4_TEST_SUPABASE_PUBLISHABLE_KEY");
  const supabase = new URL(supabaseUrl);
  if (supabase.protocol !== "https:" || supabase.hostname !== `${isolatedRef}.supabase.co`
    || supabase.hostname.startsWith(`${productionRef}.`)) {
    throw new Error(`Refusing to start: Web and API must use isolated Supabase project ${isolatedRef}.`);
  }
  if (!publishableKey.startsWith("sb_publishable_")) throw new Error("Refusing to start: the isolated publishable key has an unexpected format.");
  const configuredApiPort = Number(required(apiEnv, "PORT", "API port"));
  const actualApiPort = optionValue("--api-port", configuredApiPort);
  const actualWebPort = optionValue("--web-port", webPort);
  const actualProxyPort = optionValue("--proxy-port", proxyPort);
  const ports = [actualApiPort, actualWebPort, actualProxyPort];
  if (ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535) || new Set(ports).size !== ports.length) {
    throw new Error("Refusing to start: local API, Web and proxy ports must be valid and distinct.");
  }
  required(apiEnv, "DEEPSEEK_API_KEY", "DeepSeek API key");
  required(apiEnv, "AZURE_SPEECH_KEY", "Azure Speech key");
  required(apiEnv, "AZURE_SPEECH_REGION", "Azure Speech region");
  return { origin, supabaseUrl: supabase.origin, publishableKey, apiPort: actualApiPort, webPort: actualWebPort, proxyPort: actualProxyPort };
}

export function proxyTargetForPath(pathname) { return pathname === "/health" || pathname.startsWith("/api/") ? "api" : "web"; }
export function proxyHostMatches(configuredOrigin, hostHeader) {
  return String(hostHeader ?? "").toLowerCase() === new URL(parseOrigin(configuredOrigin)).host.toLowerCase();
}

export function resolveStaticExportFile(root, requestPath) {
  let decodedPath;
  try { decodedPath = decodeURIComponent(String(requestPath).split("?", 1)[0]); } catch { return null; }
  if (!decodedPath.startsWith("/") || decodedPath.includes("\0")) return null;
  if (decodedPath.includes("\\")) return null;
  const normalizedPath = posix.normalize(decodedPath).replace(/\/+$/u, "") || "/";
  const parts = normalizedPath.split("/").filter(Boolean);
  const basePath = resolve(root, ...parts);
  const rootPath = resolve(root);
  if (basePath !== rootPath && !basePath.startsWith(`${rootPath}${sep}`)) return null;
  const candidates = [basePath, `${basePath}.html`, join(basePath, "index.html")];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch { /* Try the next static export form. */ }
  }
  return null;
}

export function verifyIsolatedStaticExport(root) {
  const chunksDir = join(root, "_next", "static", "chunks");
  if (!existsSync(join(root, "index.html")) || !existsSync(join(root, "login.html"))
    || !existsSync(join(root, "practice.html")) || !existsSync(chunksDir)) {
    throw new Error("The optimized isolated static export is incomplete; refusing to serve it.");
  }
  const stack = [chunksDir];
  let hasIsolatedSupabaseRef = false;
  let hasSameOriginApiSentinel = false;
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readDirectoryEntries(current)) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile() && extname(entry.name) === ".js") {
        const contents = readFileSync(path, "utf8");
        if (contents.includes(`${isolatedRef}.supabase.co`)) hasIsolatedSupabaseRef = true;
        if (contents.includes(sameOriginSentinel)) hasSameOriginApiSentinel = true;
        if (contents.includes(`${productionRef}.supabase.co`) || contents.includes("http://localhost:3001")) {
          throw new Error("The static export contains a Production Supabase or non-same-origin API URL; refusing to serve it.");
        }
      }
    }
  }
  if (!hasIsolatedSupabaseRef || !hasSameOriginApiSentinel) {
    throw new Error("The static export is missing isolated Supabase or same-origin API configuration; refusing to serve it.");
  }
  return true;
}

function readDirectoryEntries(path) {
  // Keep this helper synchronous so the safety check finishes before the public proxy opens.
  return readdirSync(path, { withFileTypes: true });
}

const staticMimeTypes = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8",
};

export function createStaticExportServer({ root, host = loopback, port = 0 }) {
  const staticRoot = resolve(root);
  const server = http.createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD", "cache-control": "no-store" });
      response.end();
      return;
    }
    const file = resolveStaticExportFile(staticRoot, request.url ?? "/");
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      response.end("Not found");
      return;
    }
    const isHtml = extname(file) === ".html";
    response.writeHead(200, {
      "content-type": staticMimeTypes[extname(file)] ?? "application/octet-stream",
      "cache-control": isHtml ? "no-cache" : "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(file).pipe(response);
  });
  server.listen(port, host);
  return server;
}

export function createSameOriginProxy({ origin, apiTarget, webTarget, host = loopback, port = 0 }) {
  const expectedOrigin = parseOrigin(origin);
  const api = new URL(apiTarget);
  const web = new URL(webTarget);

  const proxyRequest = (request, response, target) => {
    if (!proxyHostMatches(expectedOrigin, request.headers.host)) {
      response.writeHead(421, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      response.end("Host does not match configured test origin");
      return;
    }
    const upstream = http.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: request.method,
      path: request.url,
      headers: {
        ...request.headers,
        host: target.host,
        "x-forwarded-host": request.headers.host,
        "x-forwarded-proto": new URL(expectedOrigin).protocol.slice(0, -1),
      },
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      response.end("Local test upstream is unavailable");
    });
    request.pipe(upstream);
    response.on("close", () => upstream.destroy());
  };

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", expectedOrigin).pathname;
    proxyRequest(request, response, proxyTargetForPath(pathname) === "api" ? api : web);
  });
  server.on("upgrade", (request, socket, head) => {
    const target = web;
    if (!proxyHostMatches(expectedOrigin, request.headers.host)) return socket.destroy();
    const upstream = net.connect(Number(target.port), target.hostname, () => {
      const headers = Object.entries({ ...request.headers, host: target.host, "x-forwarded-host": request.headers.host })
        .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`).join("\r\n");
      upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  server.listen(port, host);
  return server;
}

function checkPort(host, port) {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Local port ${port} is already in use; no process was stopped.`)));
    server.listen(port, host, () => server.close((error) => error ? reject(error) : resolvePromise()));
  });
}

function startProcess(command, args, cwd, env) {
  return spawn(command, args, { cwd, env, stdio: "inherit", windowsHide: true });
}

function stopTree(child) {
  if (!child.pid || child.killed) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.on("error", () => child.kill());
  } else child.kill("SIGTERM");
}

async function waitForLocal(url, children, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (children.some((child) => child.exitCode !== null)) throw new Error("A local service exited before becoming ready.");
    try {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
      lastError = new Error(`Local readiness check returned HTTP ${response.status}.`);
    } catch (error) { lastError = error; }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`Local service did not become ready: ${lastError?.message ?? "timeout"}`);
}

async function main() {
  const originIndex = process.argv.indexOf("--origin");
  if (originIndex < 0 || !process.argv[originIndex + 1]) throw new Error("Usage: npm run dev:s4test-proxy -- --origin <local-or-https-origin> [--api-port N] [--web-port N] [--proxy-port N] [--check]");
  const config = validate(process.argv[originIndex + 1]);
  if (process.argv.includes("--check")) {
    console.log(`PASS isolated Supabase ref: ${isolatedRef}`);
    console.log(`PASS same-origin test URL: ${config.origin}`);
    console.log(`PASS API origin is explicitly set to the supplied origin; API port remains loopback-only.`);
    console.log("PASS DeepSeek/Azure credentials are present server-side and were not printed.");
    if (process.argv.includes("--static-export")) {
      verifyIsolatedStaticExport(join(webDir, ".next", "s4test-export"));
      console.log("PASS optimized static export contains isolated Supabase and same-origin API configuration.");
    }
    console.log("PASS no tunnel or external service was started or modified.");
    return;
  }

  await checkPort(loopback, config.apiPort);
  await checkPort(loopback, config.webPort);
  await checkPort(loopback, config.proxyPort);
  const children = [];
  let proxy;
  let staticWeb;
  let stopping = false;
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    proxy?.close();
    staticWeb?.close();
    for (const child of children) stopTree(child);
    setTimeout(() => process.exit(code), 400).unref();
  };
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));

  const api = startProcess(process.execPath, ["--env-file-if-exists=.env.local", "--experimental-strip-types", "src/index.ts"], apiDir, {
    ...process.env,
    HOST: loopback,
    PORT: String(config.apiPort),
    FRONTEND_ORIGIN: config.origin,
    SUPABASE_URL: config.supabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
    RENDER: "false",
  });
  children.push(api);
  api.once("exit", (code) => { if (!stopping) stop(code ?? 1); });
  console.log(`Starting local API for isolated Supabase project ${isolatedRef}; secrets are not displayed.`);

  try {
    await waitForLocal(`http://${loopback}:${config.apiPort}/health`, children, 30_000);
    if (process.argv.includes("--static-export")) {
      const staticRoot = join(webDir, ".next", "s4test-export");
      verifyIsolatedStaticExport(staticRoot);
      staticWeb = createStaticExportServer({ root: staticRoot, host: loopback, port: config.webPort });
      await new Promise((resolvePromise, reject) => {
        staticWeb.once("listening", resolvePromise);
        staticWeb.once("error", reject);
      });
      await waitForLocal(`http://${loopback}:${config.webPort}/login`, children, 10_000);
    } else {
      const nextCli = join(rootDir, "node_modules", "next", "dist", "bin", "next");
      if (!existsSync(nextCli)) throw new Error("Next.js executable is missing from the existing workspace dependencies.");
      const web = startProcess(process.execPath, [nextCli, "dev", "--webpack", "--hostname", loopback, "--port", String(config.webPort)], webDir, {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: config.supabaseUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
        NEXT_PUBLIC_API_BASE_URL: sameOriginSentinel,
        S4_TEST_ALLOWED_DEV_ORIGIN: new URL(config.origin).hostname,
        S4_TEST_NEXT_DIST_DIR: ".next/s4test-proxy",
      });
      children.push(web);
      web.once("exit", (code) => { if (!stopping) stop(code ?? 1); });
      await waitForLocal(`http://${loopback}:${config.webPort}/`, children, 60_000);
    }
    proxy = createSameOriginProxy({
      origin: config.origin,
      apiTarget: `http://${loopback}:${config.apiPort}`,
      webTarget: `http://${loopback}:${config.webPort}`,
      host: loopback,
      port: config.proxyPort,
    });
    await new Promise((resolvePromise, reject) => {
      proxy.once("listening", resolvePromise);
      proxy.once("error", reject);
    });
    console.log(`PASS local same-origin Web/API ready at ${config.origin} via http://${loopback}:${config.proxyPort}.`);
    console.log(`${process.argv.includes("--static-export") ? "Optimized static pages and assets" : "Pages, Next static assets and HMR"} go to the local Web server; /api/* and /health go to the local Fastify API.`);
    console.log("No SSH process or public tunnel was started. Press Ctrl+C to stop only these local Web/API/proxy processes.");
  } catch (error) {
    stop(1);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`S4 HTTPS local preparation blocked: ${error.message}`);
    process.exitCode = 1;
  });
}
