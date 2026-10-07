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
