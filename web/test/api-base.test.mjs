import assert from "node:assert/strict";
import test from "node:test";
import { getApiBaseUrl } from "../app/lib/api-base.mjs";

test("configured API URL remains unchanged", () => {
  assert.equal(getApiBaseUrl("https://api.example.test/"), "https://api.example.test");
});

test("S4 test sentinel resolves to the browser's current origin", () => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://rotated-tunnel.example" } };
  try {
    assert.equal(getApiBaseUrl("__S4TEST_SAME_ORIGIN__"), "https://rotated-tunnel.example");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("same-origin mode is unavailable during server rendering", () => {
  const previousWindow = globalThis.window;
  delete globalThis.window;
  try { assert.equal(getApiBaseUrl("__S4TEST_SAME_ORIGIN__"), null); }
  finally { if (previousWindow !== undefined) globalThis.window = previousWindow; }
});
