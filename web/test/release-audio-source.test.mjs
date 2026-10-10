import assert from "node:assert/strict";
import test from "node:test";
import { releaseAudioSource } from "../app/lib/release-audio-source.mjs";

test("audio cleanup detaches playback handlers, stops and unloads audio, then revokes its object URL", () => {
  const calls = [];
  const audio = {
    onended: () => {},
    onerror: () => {},
    pause: () => calls.push("pause"),
    removeAttribute: (name) => calls.push(`remove:${name}`),
    load: () => calls.push("load"),
  };
  const originalRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (url) => calls.push(`revoke:${url}`);

  try {
    releaseAudioSource(audio, "blob:test-audio");
  } finally {
    URL.revokeObjectURL = originalRevoke;
  }

  assert.equal(audio.onended, null);
  assert.equal(audio.onerror, null);
  assert.deepEqual(calls, ["pause", "remove:src", "load", "revoke:blob:test-audio"]);
});

test("cleanup tolerates an audio request that has no audio element or object URL yet", () => {
  assert.doesNotThrow(() => releaseAudioSource(null, null));
});
