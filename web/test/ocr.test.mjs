import assert from "node:assert/strict";
import test from "node:test";
import { findConfidentLineRegion, findLikelyTextRegion, isReliableOcrResult, normalizeSpanishOcrText } from "../app/lib/ocr.ts";

test("OCR text preserves Spanish punctuation and joins image line breaks for the editable sentence field", () => {
  assert.equal(normalizeSpanishOcrText("  ¿Dónde está\n la biblioteca?  \n"), "¿Dónde está la biblioteca?");
  assert.equal(normalizeSpanishOcrText(" \n\t "), "");
});

test("low-confidence OCR is not treated as a successful sentence", () => {
  assert.equal(isReliableOcrResult("", 90), false);
  assert.equal(isReliableOcrResult("A e || |", 29), false);
  assert.equal(isReliableOcrResult("EH\ne)\nla\nr\na\ny\nv\niv\no\nen", 77), false);
  assert.equal(isReliableOcrResult("Hola, soy Clara y vivo en Sevilla.", 90), true);
});

test("text-region fallback finds a small text band away from the image center", () => {
  const width = 400;
  const height = 240;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 195;
    pixels[i + 1] = 195;
    pixels[i + 2] = 195;
    pixels[i + 3] = 255;
  }
  for (let y = 185; y < 206; y += 1) {
    for (let x = 45; x < 300; x += 8) {
      if ((Math.floor((x - 45) / 8) % 2 === 0 && y > 198)
        || (Math.floor((x - 45) / 8) % 2 === 1 && y < 192)) continue;
      for (let dx = 0; dx < 4; dx += 1) {
        const offset = (y * width + x + dx) * 4;
        pixels[offset] = 35;
        pixels[offset + 1] = 35;
        pixels[offset + 2] = 35;
      }
    }
  }
  for (let y = 178; y < 217; y += 1) {
    for (let x = 350; x < 354; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 35;
      pixels[offset + 1] = 35;
      pixels[offset + 2] = 35;
    }
  }
  const region = findLikelyTextRegion(pixels, width, height);
  assert.ok(region);
  assert.ok(region.top < 185);
  assert.ok(region.top + region.height > 205);
  assert.ok(region.height < 100);
  assert.ok(region.left < 45);
  assert.ok(region.left + region.width < 350);
});

test("text-region fallback does not invent a region in a blank image", () => {
  const width = 160;
  const height = 120;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = 255;
  }
  assert.equal(findLikelyTextRegion(pixels, width, height), null);
});

test("line-region fallback keeps adjacent Spanish words and excludes low-confidence background", () => {
  const region = findConfidentLineRegion([
    {
      text: "Muy bien",
      confidence: 96,
      bbox: { x0: 150, y0: 375, x1: 374, y1: 435 },
      words: [{ bbox: { x0: 150, y0: 375, x1: 374, y1: 435 } }],
    },
    {
      text: ", gracias. Y tú?",
      confidence: 95,
      bbox: { x0: 376, y0: 388, x1: 688, y1: 439 },
      words: [{ bbox: { x0: 376, y0: 388, x1: 688, y1: 439 } }],
    },
    {
      text: "uu 7 r",
      confidence: 34,
      bbox: { x0: 27, y0: 620, x1: 98, y1: 660 },
    },
  ], 810, 1440);
  assert.ok(region);
  assert.equal(region.singleLine, true);
  assert.ok(region.left <= 150 && region.left > 27);
  assert.ok(region.left + region.width >= 688);
  assert.ok(region.top + region.height < 620);
});
