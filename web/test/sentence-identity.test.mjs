import assert from "node:assert/strict";
import test from "node:test";
import { latestUniqueSentenceRecords, matchingSentenceRecords, sentenceIdentity } from "../app/lib/sentence-identity.mjs";

test("canonical identity normalizes whitespace, case, Unicode form, and approved boundary punctuation", () => {
  assert.equal(sentenceIdentity("  ¿Dónde   está el museo?\n"), sentenceIdentity("¿DÓNDE está el museo?"));
  assert.equal(sentenceIdentity("¿Dónde\u00a0está el museo?"), sentenceIdentity("¿DÓNDE\u3000está el museo"));
  assert.equal(sentenceIdentity("cafe\u0301"), sentenceIdentity("café"));
  assert.notEqual(sentenceIdentity("cafe"), sentenceIdentity("café"));
  assert.equal(sentenceIdentity("Hola"), sentenceIdentity("Hola."));
  assert.equal(sentenceIdentity("¿Dónde está?"), sentenceIdentity("¿Dónde está"));
  assert.equal(sentenceIdentity("¿Dónde está?"), sentenceIdentity("Dónde está?"));
  assert.equal(sentenceIdentity("¡Qué bonito!"), sentenceIdentity("¡Qué bonito"));
  assert.equal(sentenceIdentity("¡Qué bonito!"), sentenceIdentity("Qué bonito!"));
  assert.equal(sentenceIdentity("¿Qué tal...?"), sentenceIdentity("¿Qué tal…?"));
  assert.equal(sentenceIdentity("¿Qué tal...?"), sentenceIdentity("¿Qué tal…"));
});

test("canonical identity preserves sentence type, meaningful punctuation, and ambiguous boundaries", () => {
  assert.notEqual(sentenceIdentity("Hola."), sentenceIdentity("Hola!"));
  assert.notEqual(sentenceIdentity("Hola"), sentenceIdentity("Hola?"));
  assert.notEqual(sentenceIdentity("Hola?"), sentenceIdentity("Hola!"));
  assert.notEqual(sentenceIdentity("¿Cómo estás?"), sentenceIdentity("Como estás"));
  assert.notEqual(sentenceIdentity("Vamos, Ana."), sentenceIdentity("Vamos Ana."));
  assert.notEqual(sentenceIdentity("Hola…"), sentenceIdentity("Hola."));
  assert.notEqual(sentenceIdentity("Hola.."), sentenceIdentity("Hola."));
  assert.notEqual(sentenceIdentity("¿Hola??"), sentenceIdentity("¿Hola?"));
  assert.notEqual(sentenceIdentity("¡Hola?!"), sentenceIdentity("¡Hola!"));
});

test("history matching survives sentence removal and re-addition and stays scoped to supplied user rows", () => {
  const attempts = [
    { id: "new", sentence: "  Hola,   Ana. " },
    { id: "different", sentence: "Hola Ana." },
    { id: "old", sentence: "hola, ana." },
  ];
  assert.deepEqual(matchingSentenceRecords(attempts, "Hola, Ana.").map((row) => row.id), ["new", "old"]);
});

test("latest sentence deduplication uses the shared identity and retains separate empty legacy rows", () => {
  const records = [
    { id: "new", sentence: "¿Dónde   está el museo?" },
    { id: "old", sentence: "¿DÓNDE está el museo?" },
    { id: "punctuation", sentence: "¿Dónde está el museo!" },
    { id: "blank-a", sentence: " " },
    { id: "blank-b", sentence: "" },
    { id: "valid-lookalike", sentence: "record:blank-a" },
  ];
  assert.deepEqual(latestUniqueSentenceRecords(records).map((row) => row.id), ["new", "punctuation", "blank-a", "blank-b", "valid-lookalike"]);
  assert.deepEqual(matchingSentenceRecords(records, " "), []);
});
