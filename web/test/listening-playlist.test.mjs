import assert from "node:assert/strict";
import test from "node:test";
import { makeListeningPlaylist, makeListeningPool, makePersonalListeningPool, nextListeningIndex, relativeListeningIndex, validCustomSelection } from "../app/lib/listening-playlist.ts";

const library = [
  { id: "one", sentence: "Hola, Ana.", translation: "你好，安娜。" },
  { id: "two", sentence: "Gracias.", translation: "谢谢。" },
];
const records = [
  { id: "latest", sentence: "  hola, ANA. ", translation: "记录译文" },
  { id: "new", sentence: "¿Dónde está el museo?", translation: "博物馆在哪里？" },
  { id: "old", sentence: "¿Dónde está el museo?", translation: "博物馆在哪里？" },
];

test("all and learned use the deduplicated library plus only this user's supplied records", () => {
  const pool = makeListeningPool(library, records);
  assert.deepEqual(pool.map((item) => item.key), ["library:one", "library:two", "practice:old"]);
  assert.deepEqual(makeListeningPlaylist(pool, "learned", []).map((item) => item.key), ["library:one", "practice:old"]);
  assert.equal(pool[0].translation, "你好，安娜。");
  assert.deepEqual(makeListeningPlaylist(pool, "all", []).map((item) => item.key), pool.map((item) => item.key));
});

test("custom starts empty, ignores duplicates and expired references, and remains stable after a newer practice", () => {
  const pool = makeListeningPool(library, records);
  assert.deepEqual(makeListeningPlaylist(pool, "custom", []), []);
  const selection = ["practice:old", "practice:old", "practice:deleted", "library:one"];
  assert.deepEqual(validCustomSelection(selection, pool), ["practice:old", "library:one"]);
  assert.deepEqual(makeListeningPlaylist(pool, "custom", selection).map((item) => item.key), ["library:one", "practice:old"]);
  const updated = makeListeningPool(library, [{ id: "newest", sentence: "¿Dónde está el museo?" }, ...records]);
  assert.ok(updated.some((item) => item.key === "practice:old"));
  assert.deepEqual(makeListeningPlaylist(makeListeningPool(library, []), "custom", selection).map((item) => item.key), ["library:one"]);
});

test("continuous playback wraps to the first entry", () => {
  assert.equal(nextListeningIndex(0, 2), 1);
  assert.equal(nextListeningIndex(1, 2), 0);
  assert.equal(nextListeningIndex(0, 0), 0);
});

test("single-sentence focus navigation wraps in both directions and handles an empty playlist", () => {
  assert.equal(relativeListeningIndex(0, 3, -1), 2);
  assert.equal(relativeListeningIndex(2, 3, 1), 0);
  assert.equal(relativeListeningIndex(1, 3, -1), 0);
  assert.equal(relativeListeningIndex(1, 3, 1), 2);
  assert.equal(relativeListeningIndex(0, 0, -1), 0);
});

test("Stage 4 playback uses only saved personal IDs and excludes removed or legacy references", () => {
  const saved = [
    { id: "own-a", sentence: "Hola, Ana.", translation: "你好，安娜。" },
    { id: "own-b", sentence: "Gracias.", translation: null },
  ];
  const pool = makePersonalListeningPool(saved);
  assert.deepEqual(pool.map((item) => item.key), ["own-a", "own-b"]);
  assert.deepEqual(makeListeningPlaylist(pool, "custom", ["library:one", "practice:old", "own-b"]).map((item) => item.key), ["own-b"]);
  const afterRemoval = makePersonalListeningPool(saved.slice(0, 1));
  assert.deepEqual(makeListeningPlaylist(afterRemoval, "all", []).map((item) => item.key), ["own-a"]);
  assert.deepEqual(makeListeningPlaylist(afterRemoval, "custom", ["own-b"]), []);
});
