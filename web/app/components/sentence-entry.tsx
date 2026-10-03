"use client";

import Link from "next/link";
import { Icon } from "./icons";
import { useSentenceDraft } from "./sentence-draft";

export function SentenceEntry() {
  const { sentence, setSentence } = useSentenceDraft();

  return (
    <section className="sentence-entry">
      <label htmlFor="sentence" className="field-label">今天想学哪一句？</label>
      <textarea
        id="sentence"
        rows={4}
        value={sentence}
        onChange={(event) => setSentence(event.target.value)}
        placeholder="输入或粘贴一句西班牙语"
        className="sentence-input"
      />
      <p className="field-note">例如：¿Dónde está la biblioteca?</p>
      <div className="assistance-row">
        <button type="button" disabled className="text-action"><Icon name="camera" />文字识别</button>
        <button type="button" disabled className="text-action"><Icon name="shuffle" />随机一句</button>
        <Link href="/library" className="text-action"><Icon name="book" />从句子库选</Link>
      </div>
    </section>
  );
}
