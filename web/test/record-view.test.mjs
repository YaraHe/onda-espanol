import assert from "node:assert/strict";
import test from "node:test";
import { groupLatestRecordsByDate } from "../app/lib/record-view.ts";

test("record list keeps the newest attempt for each sentence and groups by local date", () => {
  const records = [
    { id: "3", sentence: "Hola.", overall: 90, created_at: "2026-10-05T08:00:00Z" },
    { id: "2", sentence: "Gracias.", overall: 82, created_at: "2026-10-05T07:00:00Z" },
    { id: "1", sentence: "Hola.", overall: 60, created_at: "2026-10-04T08:00:00Z" },
    { id: "0", sentence: "Adiós.", overall: 70, created_at: "2026-10-03T08:00:00Z" },
  ];
  const groups = groupLatestRecordsByDate(records);
  assert.deepEqual(groups.flatMap((group) => group.records.map((record) => record.id)), ["3", "2", "0"]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].records[0].overall, 90);
});

test("records without a valid timestamp remain accessible", () => {
  const groups = groupLatestRecordsByDate([{ id: "1", sentence: "Hola.", overall: null, created_at: null }]);
  assert.equal(groups[0].date, "时间未知");
  assert.deepEqual(groupLatestRecordsByDate([]), []);
});

test("record list deduplicates the same canonical sentence like record detail history", async () => {
  const { matchingSentenceRecords } = await import("../app/lib/sentence-identity.mjs");
  const records = [
    { id: "latest", sentence: "  Hola,   ANA. ", overall: 91, created_at: "2026-10-06T08:00:00Z" },
    { id: "older", sentence: "hola, ana.", overall: 72, created_at: "2026-10-05T08:00:00Z" },
    { id: "different", sentence: "Hola Ana.", overall: 80, created_at: "2026-10-04T08:00:00Z" },
  ];

  const listIds = groupLatestRecordsByDate(records).flatMap((group) => group.records.map((record) => record.id));
  const detailHistoryIds = matchingSentenceRecords(records, "Hola, Ana.").map((record) => record.id);

  assert.deepEqual(listIds, ["latest", "different"]);
  assert.deepEqual(detailHistoryIds, ["latest", "older"]);
  assert.ok(listIds.includes(detailHistoryIds[0]));
});

test("punctuation variants share a history group while every practice attempt remains available", async () => {
  const { matchingSentenceRecords } = await import("../app/lib/sentence-identity.mjs");
  const attempts = [
    { id: "attempt-new", sentence: "¿Dónde está la biblioteca", overall: 95, created_at: "2026-10-13T08:00:00Z" },
    { id: "attempt-old", sentence: "¿Dónde está la biblioteca?", overall: 82, created_at: "2026-10-09T08:00:00Z" },
  ];
  assert.deepEqual(groupLatestRecordsByDate(attempts).flatMap((group) => group.records.map((record) => record.id)), ["attempt-new"]);
  assert.deepEqual(matchingSentenceRecords(attempts, "¿Dónde está la biblioteca?").map((record) => record.id), ["attempt-new", "attempt-old"]);
  assert.deepEqual(attempts.map((record) => record.sentence), ["¿Dónde está la biblioteca", "¿Dónde está la biblioteca?"]);
});

test("blank legacy records do not collapse into one sentence group", () => {
  const groups = groupLatestRecordsByDate([
    { id: "blank-a", sentence: " ", overall: null, created_at: null },
    { id: "blank-b", sentence: "", overall: null, created_at: null },
  ]);
  assert.deepEqual(groups.flatMap((group) => group.records.map((record) => record.id)), ["blank-a", "blank-b"]);
});
