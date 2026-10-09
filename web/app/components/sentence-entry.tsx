"use client";

import { useEffect, useRef, useState } from "react";
import type { Worker } from "tesseract.js";
import { Icon } from "./icons";
import { useSentenceDraft } from "./sentence-draft";
import { isReliableOcrResult, normalizeSpanishOcrText } from "../lib/ocr";

export function SentenceEntry({ onEdit }: { onEdit?: () => void }) {
  const { sentence, setSentence } = useSentenceDraft();
  const [lengthNotice, setLengthNotice] = useState("");
  const [ocrStatus, setOcrStatus] = useState<"idle" | "processing">("idle");
  const [ocrError, setOcrError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const activeWorker = useRef<Worker | null>(null);
  const ocrRun = useRef(0);
  const manualEdit = useRef(0);

  useEffect(() => () => {
    ocrRun.current += 1;
    const worker = activeWorker.current;
    activeWorker.current = null;
    if (worker) void worker.terminate().catch(() => {});
  }, []);

  function updateSentence(value: string) {
    onEdit?.();
    let next = value;
    let notice = "";
    if (next.length > 200) {
      next = next.slice(0, 200);
      notice = "句子过长，已截断至 200 字符。";
    }
    const words = [...next.matchAll(/\S+/gu)];
    if (words.length > 30) {
      next = next.slice(0, words[30].index).trimEnd();
      notice = "句子过长，已截断至 30 词。";
    }
    setSentence(next);
    setLengthNotice(notice);
  }

  async function recognizeImage(file: File) {
    const run = ++ocrRun.current;
    const editAtStart = manualEdit.current;
    setOcrStatus("processing");
    setOcrError("");
    let worker = activeWorker.current;
    try {
      if (!file.type.startsWith("image/")) throw new Error("Unsupported image");
      const { createWorker, OEM, PSM } = await import("tesseract.js");
      if (!worker) {
        const origin = window.location.origin;
        worker = await createWorker("spa", OEM.LSTM_ONLY, {
          workerPath: `${origin}/ocr/worker.min.js`,
          corePath: `${origin}/ocr/core`,
          langPath: `${origin}/ocr/lang`,
          workerBlobURL: false,
        });
        if (run !== ocrRun.current) {
          await worker.terminate();
          return;
        }
        activeWorker.current = worker;
      }
      await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
      let result = await worker.recognize(file, {}, { blocks: true });
      if (run !== ocrRun.current) return;
      if (!isReliableOcrResult(result.data.text, result.data.confidence) || result.data.confidence < 90) {
        const { makeTextRegionImage } = await import("../lib/ocr-image");
        const lines = (result.data.blocks ?? []).flatMap((block) =>
          block.paragraphs.flatMap((paragraph) => paragraph.lines.map((line) => ({
            text: line.text,
            confidence: line.confidence,
            bbox: line.bbox,
            words: line.words.map((word) => ({ bbox: word.bbox })),
          }))),
        );
        for (const strategy of ["lines", "pixels"] as const) {
          const regionImage = await makeTextRegionImage(file, strategy, lines);
          if (run !== ocrRun.current) return;
          if (!regionImage) continue;
          await worker.setParameters({ tessedit_pageseg_mode: regionImage.singleLine ? PSM.SINGLE_LINE : PSM.SINGLE_BLOCK });
          const regionResult = await worker.recognize(regionImage.image);
          if (run !== ocrRun.current) return;
          if (isReliableOcrResult(regionResult.data.text, regionResult.data.confidence)
            && (!isReliableOcrResult(result.data.text, result.data.confidence)
              || regionResult.data.confidence >= result.data.confidence + 3)) {
            result = regionResult;
          }
          if (isReliableOcrResult(result.data.text, result.data.confidence)
            && result.data.confidence >= 90) break;
        }
      }
      if (!isReliableOcrResult(result.data.text, result.data.confidence)) {
        throw new Error("Low-confidence OCR result");
      }
      const recognized = normalizeSpanishOcrText(result.data.text);
      if (manualEdit.current === editAtStart) updateSentence(recognized);
    } catch {
      if (run === ocrRun.current) {
        if (activeWorker.current === worker) activeWorker.current = null;
        if (worker) await worker.terminate().catch(() => {});
        setOcrError("没识别到文字，可手动输入");
      }
    } finally {
      if (run === ocrRun.current) setOcrStatus("idle");
    }
  }

  return (
    <section className="sentence-entry">
      <label htmlFor="sentence" className="field-label">今天想学哪一句？</label>
      <textarea
        id="sentence"
        rows={4}
        value={sentence}
        onChange={(event) => { manualEdit.current += 1; updateSentence(event.target.value); }}
        placeholder="输入或粘贴一句西班牙语"
        className="sentence-input"
      />
      <p className="field-note">例如：¿Dónde está la biblioteca?</p>
      {lengthNotice && <p className="field-note" role="status">{lengthNotice}</p>}
      {ocrError && <p className="form-error" role="alert">{ocrError}</p>}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        aria-label="选择要识别的图片"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void recognizeImage(file);
        }}
      />
      <div className="assistance-row">
        <button type="button" disabled={ocrStatus === "processing"} className={`text-action${ocrStatus === "processing" ? " is-loading" : ""}`} onClick={() => { setOcrError(""); fileInput.current?.click(); }}><Icon name="camera" />{ocrStatus === "processing" ? "识别中…" : "文字识别"}</button>
      </div>
    </section>
  );
}
