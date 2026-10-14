import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  createPracticeRecoverySnapshot,
  practiceRecoveryKey,
} from "../../app/lib/practice-recovery.mjs";

const projectRef = "ebmwdxldjyomgkedtxae";
const userA = "00000000-0000-4000-8000-00000000000a";
const userB = "00000000-0000-4000-8000-00000000000b";
const sentence = "S4-5 Playwright synthetic recovery probe";
const translation = "S4-5 页面恢复合成测试";
const accessTokenFor = (sub) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    sub,
    aud: "authenticated",
    role: "authenticated",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.synthetic-test-signature`;
};

function syntheticSession(userId) {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: accessTokenFor(userId),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: `synthetic-${userId}`,
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: `${userId}@example.test`,
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: { nickname: "Playwright fixture" },
      identities: [],
      created_at: new Date().toISOString(),
    },
  };
}

function syntheticDraft(userId, id = randomUUID()) {
  const context = {
    taskId: `s4-5-${id}`,
    sentence,
    translation,
    origin: "select",
    recordReturnId: null,
    focus: null,
    focusWord: null,
    repeatPractice: false,
    annotation: null,
  };
  const result = {
    overall: 84,
    accuracy: 86,
    fluency: 81,
    completeness: 85,
    speakingRate: { wpm: 124, referenceWpm: 130, verdict: "适中" },
    words: [{ word: "¿Dónde", accuracy: 86, errorType: "", feedback: "合成测试反馈" }],
    suggestions: ["合成评分，不来自真实评分服务"],
  };
  const draft = { id, ownerUserId: userId, sentence, translation, result };
  const snapshot = createPracticeRecoverySnapshot({
    userId,
    context,
    stage: "score-ready",
    draft,
  });
  if (!snapshot) throw new Error("Synthetic recovery snapshot did not satisfy the production schema.");
  return { draft, snapshot };
}

function toPersistedRow(draft) {
  return {
    id: draft.id,
    user_id: draft.ownerUserId,
    sentence: draft.sentence,
    translation: draft.translation,
    overall: draft.result.overall,
    accuracy: draft.result.accuracy,
    fluency: draft.result.fluency,
    completeness: draft.result.completeness,
    speaking_rate: draft.result.speakingRate.wpm,
    raw_feedback: draft.result.words,
  };
}

function responseHeaders(request) {
  return {
    "access-control-allow-origin": request.headers().origin ?? "http://127.0.0.1:43100",
    "access-control-allow-headers": "apikey,authorization,content-type,x-client-info,prefer,accept",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
    "access-control-allow-credentials": "true",
    vary: "Origin",
  };
}

async function installFailClosedRoutes(context) {
  const rows = new Map();
  const insertRequests = [];
  const assessmentRequests = [];
  const escapedExternalRequests = [];
  const insertModeById = new Map();
  let heldId = null;
  let releaseHeldRead;
  let markHeldReadObserved;
  const releaseRead = () => { releaseHeldRead?.(); releaseHeldRead = undefined; };

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const headers = responseHeaders(request);

    if (url.hostname === `${projectRef}.supabase.co`) {
      if (method === "OPTIONS") {
        await route.fulfill({ status: 204, headers });
        return;
      }

      if (url.pathname === "/auth/v1/user" && method === "GET") {
        const token = request.headers().authorization?.replace(/^Bearer\s+/iu, "") ?? "";
        const userId = token.split(".")[1] ? JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).sub : null;
        const user = [userA, userB].includes(userId) ? syntheticSession(userId).user : null;
        await route.fulfill({
          status: user ? 200 : 401,
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(user ?? { message: "Synthetic session is invalid" }),
        });
        return;
      }

      if (url.pathname === "/rest/v1/practice_records") {
        if (method !== "GET" && method !== "HEAD") {
          const mode = request.postDataJSON?.();
          const candidate = mode && !Array.isArray(mode) ? mode : null;
          const id = candidate?.id ?? "unknown-id";
          insertRequests.push({ id, userId: candidate?.user_id ?? null, method });
          const behavior = insertModeById.get(id) ?? "deny";

          // Fail closed: never call route.continue() or route.fetch() for practice_records writes.
          if (method !== "POST" || !candidate || candidate.user_id !== userA && candidate.user_id !== userB) {
            await route.fulfill({ status: 403, headers, body: "Blocked by S4-5 write guard" });
            return;
          }
          if (behavior === "network-failure") {
            await route.abort("failed");
            return;
          }
          if (behavior === "commit-drop-response") {
            rows.set(`${candidate.user_id}:${candidate.id}`, candidate);
            await route.abort("failed");
            return;
          }
          if (behavior === "mock-success") {
            rows.set(`${candidate.user_id}:${candidate.id}`, candidate);
            await route.fulfill({ status: 201, headers, body: "" });
            return;
          }
          await route.fulfill({ status: 403, headers, body: "Blocked by S4-5 write guard" });
          return;
        }

        const requestedId = url.searchParams.get("id")?.replace(/^eq\./u, "");
        const requestedOwner = url.searchParams.get("user_id")?.replace(/^eq\./u, "");
        if (requestedId && requestedId === heldId) {
          heldId = null;
          const gate = new Promise((resolve) => { releaseHeldRead = resolve; });
          markHeldReadObserved?.();
          await gate;
        }
        const row = requestedId && requestedOwner ? rows.get(`${requestedOwner}:${requestedId}`) : null;
        if (!row) {
          await route.fulfill({
            // maybeSingle() fetches a JSON array and converts [] to null client-side.
            status: 200,
            headers: { ...headers, "content-type": "application/json" },
            body: "[]",
          });
          return;
        }
        await route.fulfill({ status: 200, headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify([row]) });
        return;
      }

      // All other Supabase calls are local fixtures too; no Supabase request reaches the network.
      await route.fulfill({ status: 200, headers: { ...headers, "content-type": "application/json" }, body: "[]" });
      return;
    }

    if (/\/api\/(?:assess|explain|tts)(?:\/|$)/u.test(url.pathname)) {
      assessmentRequests.push(url.pathname);
      await route.fulfill({ status: 503, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "AI endpoints disabled in S4-5 test" }) });
      return;
    }

    if (["localhost", "127.0.0.1"].includes(url.hostname)) {
      await route.continue();
      return;
    }

    escapedExternalRequests.push(url.origin);
    await route.abort("blockedbyclient");
  });

  return {
    rows,
    insertRequests,
    assessmentRequests,
    escapedExternalRequests,
    setInsertMode(id, mode) { insertModeById.set(id, mode); },
    holdReadsFor(id) {
      heldId = id;
      const observed = new Promise((resolve) => { markHeldReadObserved = resolve; });
      return observed;
    },
    releaseRead,
  };
}

async function seedPage(page, userId, draft, snapshot) {
  const authKey = `sb-${projectRef}-auth-token`;
  await page.addInitScript(({ key, session, snapshotKey, recovery }) => {
    localStorage.setItem(key, JSON.stringify(session));
    sessionStorage.setItem(snapshotKey, JSON.stringify(recovery));
  }, {
    key: authKey,
    session: syntheticSession(userId),
    snapshotKey: practiceRecoveryKey(userId),
    recovery: snapshot,
  });
  await page.goto("/practice");
  await expect(page.locator("p.supporting-copy[role='status']").filter({ hasText: "尚未找到这条云端评分" })).toBeVisible();
  await expect(page.locator("p.learning-sentence")).toHaveText(sentence);
  await expect(page.getByRole("button", { name: "重试保存" })).toBeVisible();
  return draft;
}

test("practice save recovery keeps the score, retries manually, reconciles a lost response, and blocks owner changes", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext();
  const network = await installFailClosedRoutes(context);

  try {
    const page = await context.newPage();
    const failedDraft = syntheticDraft(userA);
    network.setInsertMode(failedDraft.draft.id, "network-failure");
    await seedPage(page, userA, failedDraft.draft, failedDraft.snapshot);

    await page.getByRole("button", { name: "重试保存" }).click();
    await expect(page.locator(".record-save-status[role='alert']")).toContainText("保存失败，评分结果仍在本页");
    await expect(page.getByLabel("评分结果").locator("strong").first()).toHaveText("84");
    expect(network.insertRequests.filter((item) => item.id === failedDraft.draft.id)).toHaveLength(1);
    await page.waitForTimeout(300);
    expect(network.insertRequests.filter((item) => item.id === failedDraft.draft.id)).toHaveLength(1);
    expect(network.rows.size).toBe(0);
    expect(network.assessmentRequests).toEqual([]);

    network.setInsertMode(failedDraft.draft.id, "mock-success");
    await page.getByRole("button", { name: "重试保存" }).click();
    await expect(page.getByText("已保存到练习记录", { exact: false })).toBeVisible();
    expect(network.insertRequests.filter((item) => item.id === failedDraft.draft.id)).toHaveLength(2);
    expect(network.rows.size).toBe(1);
    expect(network.rows.get(`${userA}:${failedDraft.draft.id}`)).toMatchObject(toPersistedRow(failedDraft.draft));

    const lostResponseDraft = syntheticDraft(userA);
    network.setInsertMode(lostResponseDraft.draft.id, "commit-drop-response");
    const lostPage = await context.newPage();
    await seedPage(lostPage, userA, lostResponseDraft.draft, lostResponseDraft.snapshot);
    await lostPage.getByRole("button", { name: "重试保存" }).click();
    await expect(lostPage.getByText("已保存到练习记录", { exact: false })).toBeVisible();
    expect(network.insertRequests.filter((item) => item.id === lostResponseDraft.draft.id)).toHaveLength(1);
    expect(network.rows.get(`${userA}:${lostResponseDraft.draft.id}`)).toMatchObject(toPersistedRow(lostResponseDraft.draft));

    const switchDraft = syntheticDraft(userA);
    const switchPage = await context.newPage();
    await seedPage(switchPage, userA, switchDraft.draft, switchDraft.snapshot);
    const heldRead = network.holdReadsFor(switchDraft.draft.id);
    await switchPage.getByRole("button", { name: "重试保存" }).click();
    await heldRead;

    const switchPageB = await context.newPage();
    await switchPageB.goto(new URL("/login", baseURL).toString());
    await switchPageB.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), {
      key: `sb-${projectRef}-auth-token`,
      session: syntheticSession(userB),
    });
    await expect.poll(async () => {
      const token = await switchPage.evaluate((key) => localStorage.getItem(key), `sb-${projectRef}-auth-token`);
      return token ? JSON.parse(token).user?.id : null;
    }).toBe(userB);
    network.releaseRead();
    await switchPage.waitForTimeout(300);
    expect(network.insertRequests.filter((item) => item.id === switchDraft.draft.id)).toHaveLength(0);
    expect(network.rows.has(`${userA}:${switchDraft.draft.id}`)).toBe(false);
    expect(network.rows.has(`${userB}:${switchDraft.draft.id}`)).toBe(false);

    expect(network.assessmentRequests).toEqual([]);
    expect(network.escapedExternalRequests).toEqual([]);
    expect([...network.rows.values()].every((row) => row.user_id === userA || row.user_id === userB)).toBe(true);
  } finally {
    await context.close();
  }
});
