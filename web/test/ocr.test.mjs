import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSpanishOcrText } from "../app/lib/ocr.ts";

test("OCR text preserves Spanish punctuation and joins image line breaks for the editable sentence field", () => {
  assert.equal(normalizeSpanishOcrText("  ¿Dónde está\n la biblioteca?  \n"), "¿Dónde está la biblioteca?");
  assert.equal(normalizeSpanishOcrText(" \n\t "), "");
});
