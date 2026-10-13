"use client";

import { useEffect, useRef, useState } from "react";
import type { Worker } from "tesseract.js";
import { Icon } from "./icons";
import { useSentenceDraft } from "./sentence-draft";
import { isReliableOcrResult, normalizeSpanishOcrText } from "../lib/ocr";
import { isSentenceInputWithinLimits, normalizeSentenceInput, SENTENCE_CHARACTER_LIMIT } from "../lib/sentence-input";

export function SentenceEntry({ onEdit }: { onEdit?: () => void }) {
  const { sentence, setSentence } = useSentenceDraft();
  const [lengthNotice, setLengthNotice] = useState("");
  const [ocrStatus, setOcrStatus] = useState<"idle" | "processing">("idle");
  const [ocrError, setOcrError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const activeWorker = useRef<Worker | null>(null);
  const ocrRun = useRef(0);
  const manualEdit = useRef(0);
  const characterCount = sentence.replace(/\r\n?/gu, "\n").length;
  const limitNotice = isSentenceInputWithinLimits(sentence)
    ? ""
    : "句子超过可输入限制，请缩短后再查询。";

  useEffect(() => () => {
    ocrRun.current += 1;
    const worker = activeWorker.current;
    activeWorker.current = null;
    if (worker) void worker.terminate().catch(() => {});
  }, []);

  function updateSentence(value: string) {
    onEdit?.();
    const normalized = normalizeSentenceInput(value);
    setSentence(normalized.value);
    setLengthNotice(normalized.notice ? `${normalized.notice}。` : "");
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
      <label htmlFor="sentence" className="field-label">从这句开始，慢慢找到西语的节奏</label>
      <div className="sentence-input-shell">
        <textarea
          id="sentence"
          rows={4}
          value={sentence}
          onChange={(event) => { manualEdit.current += 1; updateSentence(event.target.value); }}
          placeholder="输入或粘贴一句西班牙语"
          className="sentence-input"
          aria-describedby="sentence-character-count sentence-example"
        />
        <div className="sentence-input-footer">
          <span id="sentence-character-count" className="sentence-character-count" aria-label={`字符数 ${characterCount}/${SENTENCE_CHARACTER_LIMIT}`}>
            {characterCount}/{SENTENCE_CHARACTER_LIMIT}
          </span>
          <button type="button" disabled={ocrStatus === "processing"} className={`text-action${ocrStatus === "processing" ? " is-loading" : ""}`} onClick={() => { setOcrError(""); fileInput.current?.click(); }}><Icon name="camera" />{ocrStatus === "processing" ? "识别中…" : "文字识别"}</button>
        </div>
      </div>
      <p className="field-note sentence-example" id="sentence-example">示例文本：<span lang="es">¿Dónde está la biblioteca?</span></p>
      {(lengthNotice || limitNotice) && <p className="field-note" role="status">{lengthNotice || limitNotice}</p>}
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
    </section>
  );
}
