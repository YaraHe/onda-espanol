import { findConfidentLineRegion, findLikelyTextRegion, type OcrRecognizedLine } from "./ocr";

export async function makeTextRegionImage(
  file: File,
  strategy: "lines" | "pixels",
  lines: OcrRecognizedLine[] = [],
): Promise<{ image: Blob; singleLine: boolean } | null> {
  if (typeof createImageBitmap !== "function") return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }

  try {
    let sourceLeft: number;
    let sourceTop: number;
    let sourceWidth: number;
    let sourceHeight: number;
    let singleLine = true;
    if (strategy === "lines") {
      const region = findConfidentLineRegion(lines, bitmap.width, bitmap.height);
      if (!region) return null;
      ({ left: sourceLeft, top: sourceTop, width: sourceWidth, height: sourceHeight } = region);
      singleLine = region.singleLine;
    } else {
      const scale = Math.min(1, 1200 / bitmap.width, 1200 / bitmap.height);
      const scan = document.createElement("canvas");
      scan.width = Math.max(1, Math.round(bitmap.width * scale));
      scan.height = Math.max(1, Math.round(bitmap.height * scale));
      const scanContext = scan.getContext("2d", { willReadFrequently: true });
      if (!scanContext) return null;
      scanContext.drawImage(bitmap, 0, 0, scan.width, scan.height);
      const pixels = scanContext.getImageData(0, 0, scan.width, scan.height);
      const region = findLikelyTextRegion(pixels.data, scan.width, scan.height);
      if (!region) return null;
      sourceLeft = Math.max(0, Math.floor(region.left / scale));
      sourceTop = Math.max(0, Math.floor(region.top / scale));
      sourceWidth = Math.min(bitmap.width - sourceLeft, Math.ceil(region.width / scale));
      sourceHeight = Math.min(bitmap.height - sourceTop, Math.ceil(region.height / scale));
    }
    const outputScale = Math.min(1, 1800 / sourceWidth);
    const cropped = document.createElement("canvas");
    cropped.width = Math.max(1, Math.round(sourceWidth * outputScale));
    cropped.height = Math.max(1, Math.round(sourceHeight * outputScale));
    const croppedContext = cropped.getContext("2d");
    if (!croppedContext) return null;
    croppedContext.drawImage(bitmap, sourceLeft, sourceTop, sourceWidth, sourceHeight, 0, 0, cropped.width, cropped.height);
    const image = await new Promise<Blob | null>((resolve) => cropped.toBlob(resolve, "image/png"));
    return image ? { image, singleLine } : null;
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}
