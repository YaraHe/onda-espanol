import assert from "node:assert/strict";
import test from "node:test";
import { matchingSentenceRecords, sentenceIdentity } from "../app/lib/sentence-identity.mjs";

test("canonical identity merges only whitespace, case, and Unicode normalization variants", () => {
  assert.equal(sentenceIdentity("  ¿Dónde   está el museo?\n"), sentenceIdentity("¿DÓNDE está el museo?"));
  assert.equal(sentenceIdentity("cafe\u0301"), sentenceIdentity("café"));
  assert.notEqual(sentenceIdentity("cafe"), sentenceIdentity("café"));
  assert.notEqual(sentenceIdentity("Hola."), sentenceIdentity("Hola!"));
  assert.notEqual(sentenceIdentity("¿Cómo estás?"), sentenceIdentity("Como estas?"));
});

test("history matching survives sentence removal and re-addition and stays scoped to supplied user rows", () => {
  const attempts = [
    { id: "new", sentence: "  Hola,   Ana. " },
    { id: "different", sentence: "Hola Ana." },
    { id: "old", sentence: "hola, ana." },
  ];
  assert.deepEqual(matchingSentenceRecords(attempts, "Hola, Ana.").map((row) => row.id), ["new", "old"]);
});
