import assert from "node:assert/strict";
import test from "node:test";
import {
  createPracticeRecoverySnapshot,
  insertAndVerifyPracticeRecord,
  PRACTICE_RECOVERY_TTL_MS,
  practiceRecoveryKey,
  readPracticeRecoverySnapshot,
  samePersistedPracticeRecord,
  writePracticeRecoverySnapshot,
} from "../app/lib/practice-recovery.mjs";

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const context = {
  taskId: "task-1", sentence: "¿Dónde está la biblioteca?", translation: "图书馆在哪里？",
  annotation: null, origin: "select", recordReturnId: null, focus: "注意清晰读出图书馆。", repeatPractice: false,
};
const result = {
  overall: 86, accuracy: 84, fluency: 88, completeness: 90,
  speakingRate: { wpm: 94, referenceWpm: 100, verdict: "适中" },
  words: [{ word: "biblioteca", accuracy: 70, errorType: "Mispronunciation", feedback: "再听示范" }],
  suggestions: [],
};
const draft = { id: "record-1", sentence: context.sentence, translation: context.translation, result };
const row = {
  id: draft.id, user_id: "user-1", sentence: draft.sentence, translation: draft.translation,
  overall: 86, accuracy: 84, fluency: 88, completeness: 90, speaking_rate: 94, raw_feedback: result.words,
};

test("snapshot restores only the current account and expires from the original task time", () => {
  const storage = new MemoryStorage();
  const snapshot = createPracticeRecoverySnapshot({ userId: "user-1", context, stage: "recording", now: 10_000 });
  assert.equal(snapshot.expiresAt, 10_000 + PRACTICE_RECOVERY_TTL_MS);
  assert.equal(writePracticeRecoverySnapshot(storage, snapshot), true);
  storage.setItem(practiceRecoveryKey("user-2"), "must-not-be-read");

  const restored = readPracticeRecoverySnapshot(storage, "user-1", 10_001);
  assert.equal(restored.status, "found");
  assert.equal(restored.snapshot.stage, "recording");
  assert.equal("audio" in restored.snapshot, false);
  assert.equal(storage.getItem(practiceRecoveryKey("user-2")), null);
  assert.equal(readPracticeRecoverySnapshot(storage, "user-1", snapshot.expiresAt).status, "expired");
});

test("snapshot rejects malformed or oversized result data instead of rendering it", () => {
  const storage = new MemoryStorage();
  storage.setItem(practiceRecoveryKey("user-1"), "{" + "x".repeat(200_001));
  assert.equal(readPracticeRecoverySnapshot(storage, "user-1").status, "invalid");
  assert.equal(storage.getItem(practiceRecoveryKey("user-1")), null);

  const malformed = createPracticeRecoverySnapshot({ userId: "user-1", context, stage: "score-ready", draft, now: 20_000 });
  malformed.draft.result.words = null;
  storage.setItem(practiceRecoveryKey("user-1"), JSON.stringify(malformed));
  assert.equal(readPracticeRecoverySnapshot(storage, "user-1", 20_001).status, "invalid");
});

test("persisted score comparison is stable across object key order and detects content changes", () => {
  const reordered = { ...row, raw_feedback: [{ feedback: "再听示范", errorType: "Mispronunciation", accuracy: 70, word: "biblioteca" }] };
  assert.equal(samePersistedPracticeRecord(row, reordered), true);
  assert.equal(samePersistedPracticeRecord(row, { ...row, overall: 100 }), false);
  assert.equal(samePersistedPracticeRecord(row, { ...row, user_id: "user-2" }), false);
});

function concurrentStore() {
  const rows = new Map();
  let preReads = 0;
  let releaseReads;
  const allPreReads = new Promise((resolve) => { releaseReads = resolve; });
  return {
    find: async (id) => {
      if (preReads < 2) {
        preReads += 1;
        if (preReads === 2) releaseReads();
        await allPreReads;
      }
      return { data: rows.get(id) ?? null, error: null };
    },
    insert: async (candidate) => {
      if (rows.has(candidate.id)) return { error: new Error("duplicate key") };
      rows.set(candidate.id, structuredClone(candidate));
      return { error: null };
    },
    rows,
  };
}

test("concurrent duplicate save requests are idempotent", async () => {
  const store = concurrentStore();
  const outcomes = await Promise.all([
    insertAndVerifyPracticeRecord({ candidate: row, find: store.find, insert: store.insert }),
    insertAndVerifyPracticeRecord({ candidate: row, find: store.find, insert: store.insert }),
  ]);
  assert.deepEqual(outcomes, ["saved", "saved"]);
  assert.equal(store.rows.size, 1);
});

test("concurrent different content with the same ID never overwrites the winning row", async () => {
  const store = concurrentStore();
  const conflicting = { ...row, overall: 35, raw_feedback: [{ word: "biblioteca", accuracy: 20, errorType: "Mispronunciation", feedback: "不同评分" }] };
  const outcomes = await Promise.allSettled([
    insertAndVerifyPracticeRecord({ candidate: row, find: store.find, insert: store.insert }),
    insertAndVerifyPracticeRecord({ candidate: conflicting, find: store.find, insert: store.insert }),
  ]);
  assert.equal(outcomes.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((entry) => entry.status === "rejected").length, 1);
  assert.ok(store.rows.get(row.id).overall === row.overall || store.rows.get(row.id).overall === conflicting.overall);
});

test("a lost insert response is reconciled as saved without a second row", async () => {
  const rows = new Map();
  let insertCalls = 0;
  const outcome = await insertAndVerifyPracticeRecord({
    candidate: row,
    find: async (id) => ({ data: rows.get(id) ?? null, error: null }),
    insert: async (candidate) => {
      insertCalls += 1;
      rows.set(candidate.id, structuredClone(candidate));
      return { error: new Error("response lost after server commit") };
    },
  });
  assert.equal(outcome, "saved");
  assert.equal(insertCalls, 1);
  assert.equal(rows.size, 1);
});

test("a pre-existing mismatched row is reported as conflict without attempting an insert", async () => {
  const existing = { ...row, overall: 35 };
  let insertCalls = 0;
  await assert.rejects(
    () => insertAndVerifyPracticeRecord({
      candidate: row,
      find: async () => ({ data: existing, error: null }),
      insert: async () => { insertCalls += 1; return { error: null }; },
    }),
    (error) => error.code === "RECORD_CONFLICT",
  );
  assert.equal(insertCalls, 0);
});
