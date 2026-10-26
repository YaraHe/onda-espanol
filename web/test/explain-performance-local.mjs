// Fail-closed browser smoke for the selection page. Run after `npm run build`.
// No request to Supabase, Render, or DeepSeek is allowed to leave this browser.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve("out");
const contentTypes = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".woff2": "font/woff2", ".txt": "text/plain",
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://local").pathname);
    let filename = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!filename.startsWith(root + sep)) throw new Error("Invalid path");
    let body;
    try { body = await readFile(filename); }
    catch { if (extname(filename)) throw new Error("Missing file"); filename += ".html"; body = await readFile(filename); }
    response.writeHead(200, { "content-type": contentTypes[extname(filename)] ?? "application/octet-stream" });
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
let browser;
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const localEnv = await readFile(".env.local", "utf8");
  const publicUrl = localEnv.match(/^NEXT_PUBLIC_SUPABASE_URL\s*=\s*["']?(https:\/\/[^\s"'#]+)/mu)?.[1];
  if (!publicUrl) throw new Error("Local public URL is required to build a synthetic session");
  const projectRef = new URL(publicUrl).hostname.split(".")[0];
  const userId = "00000000-0000-4000-8000-00000000000a";
  const issuedAt = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    sub: userId, aud: "authenticated", role: "authenticated", iat: issuedAt, exp: issuedAt + 3600,
  })}.synthetic`;
  const user = {
    id: userId, aud: "authenticated", role: "authenticated", email: "synthetic@example.test",
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [],
    created_at: new Date().toISOString(),
  };
  const session = { access_token: token, token_type: "bearer", expires_in: 3600,
    expires_at: issuedAt + 3600, refresh_token: "synthetic", user };
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await context.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: `sb-${projectRef}-auth-token`, value: session,
  });
  let healthCount = 0;
  let explainCount = 0;
  let blockedCount = 0;
  const timingEvents = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.origin === origin) return route.continue();
    const headers = {
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "authorization,apikey,content-type,x-client-info,prefer,accept",
      "access-control-allow-methods": "GET,POST,OPTIONS,HEAD",
      "content-type": "application/json",
    };
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (url.hostname.endsWith(".supabase.co")) {
      if (url.pathname === "/auth/v1/user") return route.fulfill({ status: 200, headers, body: JSON.stringify(user) });
      if (url.pathname === "/rest/v1/user_settings") return route.fulfill({ status: 200, headers, body: '{"lang":"es-ES"}' });
      if (url.pathname === "/rest/v1/practice_records") return route.fulfill({ status: 200, headers, body: "[]" });
      if (url.pathname === "/rest/v1/personal_sentences") {
        if (method === "GET") return route.fulfill({ status: 200, headers, body: "null" });
        if (method === "POST") return route.fulfill({ status: 201, headers, body: JSON.stringify({
          id: "00000000-0000-4000-8000-00000000000b", sentence: "¿Dónde está la biblioteca?",
          translation: "图书馆在哪里？", identity_key: "donde esta la biblioteca", created_at: new Date().toISOString(),
        }) });
      }
    }
    if (url.pathname === "/health" && method === "GET") {
      healthCount += 1;
      return route.fulfill({ status: 200, headers, body: '{"status":"ok"}' });
    }
    if (url.pathname === "/api/explain" && method === "POST") {
      explainCount += 1;
      if (explainCount === 1) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 8500));
        return route.fulfill({ status: 503, headers, body: JSON.stringify({ error: {
          code: "UPSTREAM_ERROR", message: "讲解服务暂时不可用，请稍后重试",
        } }) });
      }
      return route.fulfill({ status: 200, headers, body: JSON.stringify({
        translation: "图书馆在哪里？", tenseMood: "现在时",
        verbs: [{ form: "está", infinitive: "estar", person: "第三人称单数", notes: "位置" }],
        structure: "疑问词 + 动词 + 地点",
      }) });
    }
    blockedCount += 1;
    return route.abort();
  });
  const page = await context.newPage();
  page.on("console", async (message) => {
    if (message.type() !== "info" || !message.text().includes("explain_")) return;
    const args = message.args();
    const detail = args[1] ? await args[1].jsonValue() : {};
    timingEvents.push({ event: message.text().split(" ")[0], detail });
  });
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("输入或粘贴一句西班牙语").fill("¿Dónde está la biblioteca?");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await page.getByText("首次访问时，服务也可能需要一些时间唤醒。", { exact: false }).last()
    .waitFor({ state: "visible", timeout: 12000 });
  await page.getByRole("button", { name: "重试" }).click({ timeout: 12000 });
  await page.waitForURL(/\/explanation/u, { timeout: 15000 });
  await page.waitForTimeout(500);
  const content = await page.locator("body").innerText();
  const explained = content.includes("图书馆在哪里？");
  console.log(JSON.stringify({ healthCount, explainCount, blockedCount, timingEvents,
    explained, explanationPageText: explained ? undefined : content.slice(0, 250) }));
  if (healthCount !== 1 || explainCount !== 2 || blockedCount !== 0 || !explained) process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
