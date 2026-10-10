import assert from "node:assert/strict";
import test from "node:test";
import { normalizeListeningScope } from "../app/lib/listening-scope.ts";

test("current custom scope remains custom", () => {
  assert.equal(normalizeListeningScope("custom"), "custom");
});

test("current all and legacy learned scopes resolve to all personal sentences", () => {
  assert.equal(normalizeListeningScope("all"), "all");
  assert.equal(normalizeListeningScope("learned"), "all");
});

test("unknown and missing legacy scopes safely fall back to all", () => {
  assert.equal(normalizeListeningScope("removed-scope"), "all");
  assert.equal(normalizeListeningScope(undefined), "all");
  assert.equal(normalizeListeningScope(null), "all");
});
