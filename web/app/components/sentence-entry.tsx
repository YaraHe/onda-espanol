"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "./icons";
import { useSentenceDraft } from "./sentence-draft";

export function SentenceEntry({ onEdit }: { onEdit?: () => void }) {
  const { sentence, setSentence } = useSentenceDraft();
  const [lengthNotice, setLengthNotice] = useState("");

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

  return (
    <section className="sentence-entry">
      <label htmlFor="sentence" className="field-label">今天想学哪一句？</label>
      <textarea
        id="sentence"
        rows={4}
        value={sentence}
        onChange={(event) => updateSentence(event.target.value)}
        placeholder="输入或粘贴一句西班牙语"
        className="sentence-input"
      />
      <p className="field-note">例如：¿Dónde está la biblioteca?</p>
      {lengthNotice && <p className="field-note" role="status">{lengthNotice}</p>}
      <div className="assistance-row">
        <button type="button" disabled className="text-action"><Icon name="camera" />文字识别</button>
        <button type="button" disabled className="text-action"><Icon name="shuffle" />随机一句</button>
        <Link href="/library" className="text-action"><Icon name="book" />从句子库选</Link>
      </div>
    </section>
  );
}
