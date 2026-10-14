type Route = "explain" | "assess" | "tts";
type Limit = { count: number; windowMs: number };
type Counter = { timestamps: number[]; touchedAt: number };
type ServerRequest = { method: string; url: string; headers: { authorization?: string }; ip: string };
type ServerReply = { header(name: string, value: string): ServerReply; code(status: number): ServerReply; send(payload: unknown): unknown };

export type SecurityOptions = {
  verifyAccessToken?: (token: string) => Promise<string | null>;
  now?: () => number;
  limits?: Partial<Record<Route, { short: Limit; daily: Limit }>>;
  ipLimit?: Limit;
  ttsGlobalLimit?: Limit;
};

const minute = 60_000;
const day = 24 * 60 * minute;
const defaultLimits: Record<Route, { short: Limit; daily: Limit }> = {
  explain: { short: { count: 5, windowMs: 10 * minute }, daily: { count: 20, windowMs: day } },
  assess: { short: { count: 10, windowMs: 10 * minute }, daily: { count: 20, windowMs: day } },
  tts: { short: { count: 8, windowMs: minute }, daily: { count: 60, windowMs: day } },
};

async function verifyWithSupabase(token: string): Promise<string | null> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) throw new Error("Supabase Auth verification is not configured");
  const response = await fetch(`${supabaseUrl.replace(/\/$/u, "")}/auth/v1/user`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error("Supabase Auth verification is unavailable");
  const user: unknown = await response.json();
  if (!user || typeof user !== "object" || !("id" in user) || typeof user.id !== "string" || !user.id) return null;
  return user.id;
}

function routeFrom(request: ServerRequest): Route | null {
  const url = request.url.split("?", 1)[0];
  if (request.method !== "POST") return null;
  if (url === "/api/explain") return "explain";
  if (url === "/api/assess") return "assess";
  if (url === "/api/tts") return "tts";
  return null;
}

function replyError(reply: ServerReply, status: number, code: string, message: string, retryAfter?: number) {
  if (retryAfter !== undefined) reply.header("Retry-After", String(Math.max(1, retryAfter)));
  return reply.code(status).send({ error: { code, message } });
}

export function createApiSecurity(options: SecurityOptions = {}) {
  const now = options.now ?? Date.now;
  const verifyAccessToken = options.verifyAccessToken ?? verifyWithSupabase;
  const limits = { ...defaultLimits, ...options.limits };
  const ipLimit = options.ipLimit ?? { count: 60, windowMs: minute };
  const ttsGlobalLimit = options.ttsGlobalLimit ?? { count: 15, windowMs: minute };
  const buckets = new Map<string, Counter>();
  const authenticatedUsers = new WeakMap<object, string>();
  const heldAssessmentRequests = new WeakSet<object>();
  let assessmentInFlight = false;
  let cleanupCounter = 0;

  function check(key: string, limit: Limit, charge: boolean): { allowed: boolean; retryAfter: number } {
    const time = now();
    let bucket = buckets.get(key);
    if (!bucket) bucket = { timestamps: [], touchedAt: time };
    const oldestAllowed = time - limit.windowMs;
    bucket.timestamps = bucket.timestamps.filter((timestamp) => timestamp > oldestAllowed);
    bucket.touchedAt = time;
    if (bucket.timestamps.length >= limit.count) {
      buckets.set(key, bucket);
      const retryAfter = Math.ceil((bucket.timestamps[0] + limit.windowMs - time) / 1000);
      return { allowed: false, retryAfter };
    }
    if (charge) bucket.timestamps.push(time);
    buckets.set(key, bucket);
    if (++cleanupCounter % 100 === 0) {
      for (const [bucketKey, value] of buckets) {
        if (time - value.touchedAt > day || buckets.size > 20_000) buckets.delete(bucketKey);
      }
    }
    return { allowed: true, retryAfter: 0 };
  }

  async function protect(request: ServerRequest, reply: ServerReply): Promise<void> {
    const route = routeFrom(request);
    if (!route) return;
    const ip = request.ip || "unknown";
    const ipCheck = check(`ip:${ip}`, ipLimit, false);
    if (!ipCheck.allowed) {
      replyError(reply, 429, "RATE_LIMITED", `请求过于频繁，请约 ${ipCheck.retryAfter} 秒后再试`, ipCheck.retryAfter);
      return;
    }
    check(`ip:${ip}`, ipLimit, true);

    const header = request.headers.authorization;
    const match = typeof header === "string" ? /^Bearer\s+([^\s]+)$/iu.exec(header) : null;
    if (!match) {
      replyError(reply, 401, "UNAUTHORIZED", "登录状态已失效，请重新登录后重试");
      return;
    }

    let userId: string | null;
    try {
      userId = await verifyAccessToken(match[1]);
    } catch {
      replyError(reply, 503, "AUTH_UNAVAILABLE", "登录状态暂时无法验证，请稍后重试");
      return;
    }
    if (!userId) {
      replyError(reply, 401, "UNAUTHORIZED", "登录状态已失效，请重新登录后重试");
      return;
    }
    authenticatedUsers.set(request, userId);
  }

  function reserveUpstream(request: object, reply: ServerReply, route: Route): boolean {
    const userId = authenticatedUsers.get(request);
    if (!userId) {
      replyError(reply, 401, "UNAUTHORIZED", "登录状态已失效，请重新登录后重试");
      return false;
    }

    if (route === "assess" && !heldAssessmentRequests.has(request)) {
      replyError(reply, 503, "UPSTREAM_ERROR", "评分服务暂时不可用，请稍后重试");
      return false;
    }

    const userLimits = limits[route];
    const short = check(`${userId}:${route}:short`, userLimits.short, false);
    const daily = check(`${userId}:${route}:daily`, userLimits.daily, false);
    if (!short.allowed || !daily.allowed) {
      const retryAfter = !short.allowed ? short.retryAfter : daily.retryAfter;
      const message = route === "explain" ? `讲解次数已达上限，请约 ${retryAfter} 秒后再试`
        : route === "assess" ? `评分次数已达上限，请约 ${retryAfter} 秒后再试`
          : `示范播放次数已达上限，请约 ${retryAfter} 秒后再试`;
      replyError(reply, 429, "RATE_LIMITED", message, retryAfter);
      return false;
    }

    if (route === "tts") {
      const global = check("app:tts:minute", ttsGlobalLimit, false);
      if (!global.allowed) {
        replyError(reply, 429, "RATE_LIMITED", `当前示范播放较多，请约 ${global.retryAfter} 秒后再试`, global.retryAfter);
        return false;
      }
    }

    // Count only an upstream attempt. Invalid requests, configuration errors,
    // and requests rejected by the concurrency/quota gates are not charged.
    check(`${userId}:${route}:short`, userLimits.short, true);
    check(`${userId}:${route}:daily`, userLimits.daily, true);
    if (route === "tts") check("app:tts:minute", ttsGlobalLimit, true);
    return true;
  }

  function acquireAssessment(request: object, reply: ServerReply): boolean {
    const userId = authenticatedUsers.get(request);
    if (!userId) {
      replyError(reply, 401, "UNAUTHORIZED", "登录状态已失效，请重新登录后重试");
      return false;
    }
    // Do not charge or start another ffmpeg conversion when the single
    // assessment pipeline is occupied. This synchronous check-and-set is atomic
    // relative to other requests in this Node.js process.
    if (assessmentInFlight) {
      replyError(reply, 429, "SERVICE_BUSY", "当前有一条评分正在处理，请 3 秒后手动重试", 3);
      return false;
    }
    const userLimits = limits.assess;
    const short = check(`${userId}:assess:short`, userLimits.short, false);
    const daily = check(`${userId}:assess:daily`, userLimits.daily, false);
    if (!short.allowed || !daily.allowed) {
      const retryAfter = !short.allowed ? short.retryAfter : daily.retryAfter;
      replyError(reply, 429, "RATE_LIMITED", `评分次数已达上限，请约 ${retryAfter} 秒后再试`, retryAfter);
      return false;
    }
    assessmentInFlight = true;
    heldAssessmentRequests.add(request);
    return true;
  }

  function release(request: object) {
    if (heldAssessmentRequests.has(request)) {
      heldAssessmentRequests.delete(request);
      assessmentInFlight = false;
    }
  }

  return { protect, acquireAssessment, reserveUpstream, release };
}
