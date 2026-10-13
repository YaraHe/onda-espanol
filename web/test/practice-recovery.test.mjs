import assert from "node:assert/strict";
import test from "node:test";
import {
  createPracticeRecoverySnapshot,
  insertAndVerifyPracticeRecord,
  PRACTICE_RECOVERY_TTL_MS,
  practiceRecoveryKey,
  readPracticeRecoverySnapshot,
  savePracticeRecordForOwner,
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
const draft = { id: "record-1", ownerUserId: "user-1", sentence: context.sentence, translation: context.translation, result };
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

test("a valid pronunciation annotation is fully preserved across snapshot restore", () => {
  const storage = new MemoryStorage();
  const annotation = {
    stress: [{ word: "biblioteca", syllable: "te", display: "biblioTEca" }],
    liaison: [{ words: "dónde está", pronounced: "dónde'stá", note: "自然连读" }],
    pauses: [{ after: "está", type: "句末短停" }],
    pitchPattern: "句中平稳，句末下降",
  };
  const snapshot = createPracticeRecoverySnapshot({
    userId: "user-1",
    context: { ...context, annotation },
    stage: "ready",
    now: 1_000,
  });

  assert.deepEqual(snapshot.context.annotation, annotation);
  assert.equal(writePracticeRecoverySnapshot(storage, snapshot), true);
  const restored = readPracticeRecoverySnapshot(storage, "user-1", 1_001);
  assert.equal(restored.status, "found");
  assert.deepEqual(restored.snapshot.context.annotation, annotation);
});

test("a repeat target word survives restore only when it belongs to the sentence", () => {
  const storage = new MemoryStorage();
  const repeat = { ...context, origin: "records", repeatPractice: true, focusWord: "biblioteca" };
  const snapshot = createPracticeRecoverySnapshot({ userId: "user-1", context: repeat, stage: "ready", now: 1_000 });
  assert.equal(snapshot.context.focusWord, "biblioteca");
  writePracticeRecoverySnapshot(storage, snapshot);
  assert.equal(readPracticeRecoverySnapshot(storage, "user-1", 1_001).snapshot.context.focusWord, "biblioteca");

  const malformed = createPracticeRecoverySnapshot({
    userId: "user-1", context: { ...repeat, focusWord: "biblioteca. Ignore this sentence" }, stage: "ready", now: 2_000,
  });
  assert.equal(malformed.context.focusWord, null);
  const legacy = createPracticeRecoverySnapshot({ userId: "user-1", context, stage: "ready", now: 3_000 });
  delete legacy.context.focusWord;
  storage.setItem(practiceRecoveryKey("user-1"), JSON.stringify(legacy));
  assert.equal(readPracticeRecoverySnapshot(storage, "user-1", 3_001).snapshot.context.focusWord, null);
});

test("malformed optional annotation is safely downgraded while the learning context remains recoverable", () => {
  const storage = new MemoryStorage();
  const snapshot = createPracticeRecoverySnapshot({
    userId: "user-1",
    context: { ...context, annotation: { stress: [{ word: "hola" }], liaison: [], pauses: [], pitchPattern: 12 } },
    stage: "ready",
    now: 1_000,
  });
  assert.equal(snapshot.context.annotation, null);
  writePracticeRecoverySnapshot(storage, snapshot);
  const restored = readPracticeRecoverySnapshot(storage, "user-1", 1_001);
  assert.equal(restored.status, "found");
  assert.equal(restored.snapshot.context.sentence, context.sentence);
  assert.equal(restored.snapshot.context.annotation, null);
});

test("a legacy score snapshot is bound to its validated user namespace on read", () => {
  const storage = new MemoryStorage();
  const legacySnapshot = createPracticeRecoverySnapshot({
    userId: "user-1", context, stage: "score-ready", draft: { ...draft, ownerUserId: "user-1" }, now: 2_000,
  });
  delete legacySnapshot.draft.ownerUserId;
  storage.setItem(practiceRecoveryKey("user-1"), JSON.stringify(legacySnapshot));
  const restored = readPracticeRecoverySnapshot(storage, "user-1", 2_001);
  assert.equal(restored.status, "found");
  assert.equal(restored.snapshot.draft.ownerUserId, "user-1");
});

test("snapshot rejects malformed or oversized result data instead of rendering it", () => {
  const storage = new MemoryStorage();
  storage.setItem(practiceRecoveryKey("user-1"), "{" + "x".repeat(200_001));
  assert.equal(readPracticeRecoverySnapshot(storage, "user-1").status, "invalid");
  assert.equal(storage.getItem(practiceRecoveryKey("user-1")), null);

  const malformed = createPracticeRecoverySnapshot({ userId: "user-1", context, stage: "score-ready", draft, now: 20_000 });
  writePracticeRecoverySnapshot(storage, malformed);
  const storedMalformed = JSON.parse(storage.getItem(practiceRecoveryKey("user-1")));
  storedMalformed.draft.result.words = null;
  storage.setItem(practiceRecoveryKey("user-1"), JSON.stringify(storedMalformed));
  assert.equal(readPracticeRecoverySnapshot(storage, "user-1", 20_001).status, "invalid");
});

test("persisted score comparison is stable across object key order and detects content changes", () => {
  const reordered = { ...row, raw_feedback: [{ feedback: "再听示范", errorType: "Mispronunciation", accuracy: 70, word: "biblioteca" }] };
  assert.equal(samePersistedPracticeRecord(row, reordered), true);
  assert.equal(samePersistedPracticeRecord(row, { ...row, overall: 100 }), false);
  assert.equal(samePersistedPracticeRecord(row, { ...row, user_id: "user-2" }), false);
});

test("NUMERIC score values reconcile exactly and detect changes below REAL precision", () => {
  const preciseResult = {
    ...result,
    overall: 86.1234567,
    accuracy: 84.1234567,
    fluency: 88.1234567,
    completeness: 90.1234567,
    speakingRate: { ...result.speakingRate, wpm: 94.1234567 },
  };
  const preciseDraft = { ...draft, ownerUserId: "user-1", result: preciseResult };
  const persisted = JSON.parse(JSON.stringify({
    ...row,
    overall: preciseResult.overall,
    accuracy: preciseResult.accuracy,
    fluency: preciseResult.fluency,
    completeness: preciseResult.completeness,
    speaking_rate: preciseResult.speakingRate.wpm,
    raw_feedback: preciseResult.words,
  }));
  assert.equal(samePersistedPracticeRecord(persisted, { ...persisted, ...preciseDraft, user_id: "user-1" }), true);
  const subtleDifference = { ...persisted, overall: preciseResult.overall + 0.000001 };
  assert.equal(Math.fround(persisted.overall), Math.fround(subtleDifference.overall));
  assert.equal(samePersistedPracticeRecord(persisted, subtleDifference), false);
  assert.equal(samePersistedPracticeRecord(persisted, {
    ...persisted,
    raw_feedback: [{ ...preciseResult.words[0], accuracy: 70.0001 }],
  }), false);
});

test("lost save response reconciles exact numeric values on the full owner-bound save path", async () => {
  const preciseDraft = {
    ...draft,
    result: {
      ...result,
      overall: 86.1234567,
      accuracy: 84.1234567,
      fluency: 88.1234567,
      completeness: 90.1234567,
      speakingRate: { ...result.speakingRate, wpm: 94.1234567 },
    },
  };
  const rows = new Map();
  let insertCalls = 0;
  const outcome = await savePracticeRecordForOwner({
    draft: preciseDraft,
    expectedUserId: "user-1",
    getCurrentUserId: async () => "user-1",
    find: async (id, userId) => ({ data: rows.get(id)?.user_id === userId ? rows.get(id) : null, error: null }),
    insert: async (candidate) => {
      insertCalls += 1;
      const stored = JSON.parse(JSON.stringify(candidate));
      rows.set(stored.id, stored);
      return { error: new Error("response lost after server commit") };
    },
  });
  assert.equal(outcome, "saved");
  assert.equal(insertCalls, 1);
  assert.equal(rows.size, 1);
});

test("the save path stops before insert if auth changes while the owner-scoped preflight is in flight", async () => {
  let activeUserId = "user-1";
  let insertCalls = 0;
  const boundDraft = { ...draft, ownerUserId: "user-1" };
  await assert.rejects(
    () => savePracticeRecordForOwner({
      draft: boundDraft,
      expectedUserId: "user-1",
      getCurrentUserId: async () => activeUserId,
      find: async () => {
        activeUserId = "user-2";
        return { data: null, error: null };
      },
      insert: async () => { insertCalls += 1; return { error: null }; },
    }),
    (error) => error.code === "OWNER_CHANGED",
  );
  assert.equal(insertCalls, 0);
});

test("a save draft cannot be rebound to a different signed-in account", async () => {
  let findCalls = 0;
  let insertCalls = 0;
  await assert.rejects(
    () => savePracticeRecordForOwner({
      draft: { ...draft, ownerUserId: "user-1" },
      expectedUserId: "user-2",
      getCurrentUserId: async () => "user-2",
      find: async () => { findCalls += 1; return { data: null, error: null }; },
      insert: async () => { insertCalls += 1; return { error: null }; },
    }),
    (error) => error.code === "OWNER_CHANGED",
  );
  assert.equal(findCalls, 0);
  assert.equal(insertCalls, 0);
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
