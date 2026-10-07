export function normalizeSpanishOcrText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export type OcrTextRegion = { left: number; top: number; width: number; height: number };
export type OcrRecognizedLine = {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words?: Array<{ bbox: { x0: number; y0: number; x1: number; y1: number } }>;
};

export function findConfidentLineRegion(
  lines: OcrRecognizedLine[],
  width: number,
  height: number,
): (OcrTextRegion & { singleLine: boolean }) | null {
  const candidates = lines.filter((line) =>
    line.confidence >= 70
    && /\p{L}{3}/u.test(line.text)
    && line.bbox.x1 > line.bbox.x0
    && line.bbox.y1 > line.bbox.y0,
  );
  if (candidates.length === 0) return null;
  const boxes = candidates.flatMap((line) => line.words?.length ? line.words.map((word) => word.bbox) : [line.bbox]);
  const x0 = Math.min(...boxes.map((box) => box.x0));
  const y0 = Math.min(...boxes.map((box) => box.y0));
  const x1 = Math.max(...boxes.map((box) => box.x1));
  const y1 = Math.max(...boxes.map((box) => box.y1));
  const margin = Math.max(12, Math.round((y1 - y0) * 0.25));
  const rightMargin = Math.max(20, Math.round((y1 - y0) * 0.72));
  const left = Math.max(0, x0 - margin);
  const top = Math.max(0, y0 - margin);
  const right = Math.min(width, x1 + rightMargin);
  const bottom = Math.min(height, y1 + margin);
  if (right - left < 20 || bottom - top < 10 || bottom - top > height * 0.65) return null;
  const centers = candidates.map((line) => (line.bbox.y0 + line.bbox.y1) / 2);
  const averageHeight = candidates.reduce((sum, line) => sum + line.bbox.y1 - line.bbox.y0, 0) / candidates.length;
  const singleLine = Math.max(...centers) - Math.min(...centers) < averageHeight * 0.75;
  return { left, top, width: right - left, height: bottom - top, singleLine };
}

// Find a horizontal band of dark text against a light background. This is used
// only when whole-image OCR has low confidence; clear images keep their result.
export function findLikelyTextRegion(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): OcrTextRegion | null {
  if (width < 80 || height < 80 || pixels.length < width * height * 4) return null;

  const histogram = new Uint32Array(256);
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 500));
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const offset = (y * width + x) * 4;
      const gray = Math.round(
        pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114,
      );
      histogram[gray] += 1;
    }
  }
  const samples = histogram.reduce((sum, count) => sum + count, 0);
  let seen = 0;
  let median = 255;
  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value];
    if (seen >= samples / 2) {
      median = value;
      break;
    }
  }
  if (median < 105) return null;
  const darkLimit = Math.min(180, median - 55);
  const rowCounts = new Uint32Array(height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const gray = pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
      if (gray < darkLimit) rowCounts[y] += 1;
    }
  }

  const minimumDark = Math.max(8, Math.ceil(width * 0.02));
  const maximumGap = Math.max(3, Math.round(height * 0.008));
  const bands: Array<{ top: number; bottom: number; strength: number }> = [];
  let top = -1;
  let bottom = -1;
  let strength = 0;
  for (let y = 0; y < height; y += 1) {
    if (rowCounts[y] < minimumDark) continue;
    if (top >= 0 && y - bottom > maximumGap) {
      bands.push({ top, bottom, strength });
      top = -1;
      strength = 0;
    }
    if (top < 0) top = y;
    bottom = y;
    strength += rowCounts[y];
  }
  if (top >= 0) bands.push({ top, bottom, strength });

  const best = bands
    .filter((band) => band.bottom - band.top >= Math.max(5, height * 0.008))
    .filter((band) => band.bottom - band.top < height * 0.45)
    .sort((a, b) => b.strength - a.strength)[0];
  if (!best) return null;

  const margin = Math.max(8, Math.round((best.bottom - best.top + 1) * 0.3));
  const regionTop = Math.max(0, best.top - margin);
  const regionBottom = Math.min(height, best.bottom + margin + 1);
  if (regionBottom - regionTop > height * 0.65) return null;

  const columnMinimum = Math.max(3, Math.ceil((best.bottom - best.top + 1) * 0.08));
  const columns: number[] = [];
  const columnCounts = new Uint16Array(width);
  for (let x = 0; x < width; x += 1) {
    let dark = 0;
    for (let y = best.top; y <= best.bottom; y += 1) {
      const offset = (y * width + x) * 4;
      const gray = pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
      if (gray < darkLimit) dark += 1;
    }
    columnCounts[x] = dark;
    if (dark >= columnMinimum) columns.push(x);
  }
  const xGroups: Array<{ left: number; right: number }> = [];
  for (const x of columns) {
    const last = xGroups[xGroups.length - 1];
    if (last && x - last.right <= 3) last.right = x;
    else xGroups.push({ left: x, right: x });
  }
  const textGroups = xGroups.filter((group) => {
    if (group.right - group.left < 3) return false;
    if (group.right - group.left > 7) return true;
    let peak = 0;
    for (let x = group.left; x <= group.right; x += 1) peak = Math.max(peak, columnCounts[x]);
    // A tall, narrow edge is usually a caret or frame rather than sentence text.
    return peak < (best.bottom - best.top + 1) * 0.85;
  });
  const horizontalMargin = Math.max(6, Math.round(width * 0.013));
  const rightMargin = Math.max(3, Math.round(width * 0.004));
  const regionLeft = textGroups.length > 0 ? Math.max(0, textGroups[0].left - horizontalMargin) : 0;
  const regionRight = textGroups.length > 0
    ? Math.min(width, textGroups[textGroups.length - 1].right + rightMargin + 1)
    : width;
  return {
    left: regionLeft,
    top: regionTop,
    width: regionRight - regionLeft,
    height: regionBottom - regionTop,
  };
}

export function isReliableOcrResult(text: string, confidence: number): boolean {
  const normalized = normalizeSpanishOcrText(text);
  if (normalized.length < 2 || confidence < 60) return false;
  const words = normalized.match(/\p{L}+/gu) ?? [];
  if (words.length === 0) return false;
  if (words.length >= 5 && words.filter((word) => word.length >= 2).length < words.length / 2) return false;
  return true;
}
