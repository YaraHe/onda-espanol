export const PRACTICE_RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;
export const PRACTICE_RECOVERY_PREFIX = "onda.practice-recovery.v1.";

const MAX_SNAPSHOT_LENGTH = 200_000;

function validAssessment(value) {
  if (!value || typeof value !== "object") return false;
  const score = (item) => typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 100;
  return score(value.overall) && score(value.accuracy) && score(value.fluency) && score(value.completeness)
    && value.speakingRate && Number.isFinite(value.speakingRate.wpm)
    && Number.isFinite(value.speakingRate.referenceWpm)
    && ["偏慢", "适中", "偏快"].includes(value.speakingRate.verdict)
    && Array.isArray(value.words) && value.words.length > 0
    && value.words.every((word) => word && typeof word.word === "string" && score(word.accuracy)
      && typeof word.errorType === "string" && typeof word.feedback === "string")
    && Array.isArray(value.suggestions) && value.suggestions.every((item) => typeof item === "string");
}

function validContext(context) {
  return Boolean(context && typeof context === "object"
    && typeof context.taskId === "string" && context.taskId.length > 0
    && typeof context.sentence === "string" && context.sentence.trim().length > 0 && context.sentence.length <= 200
    && typeof context.translation === "string" && context.translation.length <= 2_000
    && (context.origin === "select" || context.origin === "records")
    && (context.recordReturnId === null || typeof context.recordReturnId === "string")
    && (context.focus === null || (typeof context.focus === "string" && context.focus.length <= 500))
    && typeof context.repeatPractice === "boolean");
}

function validDraft(draft, context) {
  return Boolean(draft && typeof draft === "object"
    && typeof draft.id === "string" && draft.id.length > 0
    && draft.sentence === context.sentence && draft.translation === context.translation
    && validAssessment(draft.result));
}

export function practiceRecoveryKey(userId) {
  return `${PRACTICE_RECOVERY_PREFIX}${encodeURIComponent(userId)}`;
}

export function createPracticeRecoverySnapshot({ userId, context, stage, draft = null, now = Date.now(), previous = null }) {
  if (typeof userId !== "string" || !userId || !validContext(context)) return null;
  if (!["ready", "recording", "assessing", "score-ready", "saving", "failed", "saved", "removed"].includes(stage)) return null;
  if ((stage === "score-ready" || stage === "saving" || stage === "failed" || stage === "saved" || stage === "removed")
    && !validDraft(draft, context)) return null;

  const sameTask = previous?.version === 1 && previous.userId === userId && previous.context?.taskId === context.taskId;
  return {
    version: 1,
    userId,
    createdAt: sameTask ? previous.createdAt : now,
    updatedAt: now,
    expiresAt: sameTask ? previous.expiresAt : now + PRACTICE_RECOVERY_TTL_MS,
    context,
    stage,
    draft,
  };
}

export function writePracticeRecoverySnapshot(storage, snapshot) {
  if (!storage || !snapshot) return false;
  try {
    const serialized = JSON.stringify(snapshot);
    if (serialized.length > MAX_SNAPSHOT_LENGTH) return false;
    storage.setItem(practiceRecoveryKey(snapshot.userId), serialized);
    return true;
  } catch {
    return false;
  }
}

export function readPracticeRecoverySnapshot(storage, userId, now = Date.now()) {
  if (!storage || typeof userId !== "string" || !userId) return { status: "unavailable" };
  const key = practiceRecoveryKey(userId);
  let serialized;
  try {
    serialized = storage.getItem(key);
  } catch {
    return { status: "unavailable" };
  }

  // There is only one active practice task per tab. Prune snapshots from other
  // accounts and expired tasks before considering the current account's data.
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const candidate = storage.key(index);
      if (!candidate?.startsWith(PRACTICE_RECOVERY_PREFIX) || candidate === key) continue;
      storage.removeItem(candidate);
    }
  } catch {
    // A failed cleanup must not make another account's snapshot readable.
  }

  if (serialized === null) return { status: "none" };
  let snapshot;
  try {
    if (serialized.length > MAX_SNAPSHOT_LENGTH) throw new Error("oversized");
    snapshot = JSON.parse(serialized);
  } catch {
    try { storage.removeItem(key); } catch {}
    return { status: "invalid" };
  }

  if (snapshot?.version !== 1 || snapshot.userId !== userId || !validContext(snapshot.context)
    || !["ready", "recording", "assessing", "score-ready", "saving", "failed", "saved", "removed"].includes(snapshot.stage)
    || !Number.isFinite(snapshot.createdAt) || !Number.isFinite(snapshot.updatedAt)
    || !Number.isFinite(snapshot.expiresAt) || snapshot.expiresAt <= now
    || snapshot.expiresAt <= snapshot.createdAt
    || snapshot.expiresAt - snapshot.createdAt > PRACTICE_RECOVERY_TTL_MS
    || ((snapshot.stage === "score-ready" || snapshot.stage === "saving" || snapshot.stage === "failed" || snapshot.stage === "saved" || snapshot.stage === "removed")
      && !validDraft(snapshot.draft, snapshot.context))) {
    try { storage.removeItem(key); } catch {}
    return { status: snapshot?.expiresAt <= now ? "expired" : "invalid" };
  }
  return { status: "found", snapshot };
}

export function removePracticeRecoverySnapshot(storage, userId) {
  if (!storage || !userId) return;
  try { storage.removeItem(practiceRecoveryKey(userId)); } catch {}
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function samePersistedPracticeRecord(existing, candidate) {
  if (!existing || !candidate) return false;
  const candidateRow = candidate.result ? {
    id: candidate.id,
    user_id: candidate.user_id,
    sentence: candidate.sentence,
    translation: candidate.translation,
    overall: candidate.result.overall,
    accuracy: candidate.result.accuracy,
    fluency: candidate.result.fluency,
    completeness: candidate.result.completeness,
    speaking_rate: candidate.result.speakingRate.wpm,
    raw_feedback: candidate.result.words,
  } : candidate;
  return existing.id === candidateRow.id && existing.user_id === candidateRow.user_id
    && existing.sentence === candidateRow.sentence && existing.translation === candidateRow.translation
    && existing.overall === candidateRow.overall && existing.accuracy === candidateRow.accuracy
    && existing.fluency === candidateRow.fluency && existing.completeness === candidateRow.completeness
    && existing.speaking_rate === candidateRow.speaking_rate
    && JSON.stringify(stableValue(existing.raw_feedback)) === JSON.stringify(stableValue(candidateRow.raw_feedback));
}

export class PracticeRecordConflictError extends Error {
  constructor() {
    super("该记录 ID 已存在不同内容，评分仍保留在本地，云端记录未被覆盖。");
    this.name = "PracticeRecordConflictError";
    this.code = "RECORD_CONFLICT";
  }
}

/**
 * An atomic insert is the write arbiter: the database primary key chooses one
 * winner and never updates an existing row. A subsequent owner-scoped read
 * makes duplicate retries idempotent and detects a different-content race.
 */
export async function insertAndVerifyPracticeRecord({ candidate, find, insert }) {
  const prior = await find(candidate.id);
  if (prior.error) throw prior.error;
  if (prior.data) {
    if (samePersistedPracticeRecord(prior.data, candidate)) return "saved";
    throw new PracticeRecordConflictError();
  }

  let insertError = null;
  try {
    const inserted = await insert(candidate);
    insertError = inserted?.error ?? null;
  } catch (error) {
    insertError = error;
  }

  const verified = await find(candidate.id);
  if (verified.error) throw verified.error;
  if (verified.data) {
    if (samePersistedPracticeRecord(verified.data, candidate)) return "saved";
    throw new PracticeRecordConflictError();
  }
  if (insertError) throw insertError;
  throw new Error("保存后暂时无法核对练习记录，请稍后重试");
}
