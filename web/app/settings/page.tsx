"use client";

import { useState } from "react";
import { PageShell, SectionHeading } from "../components/page-shell";
import { useSentenceDraft } from "../components/sentence-draft";
import { useUserSettings } from "../components/user-settings-provider";
import { clearPracticeRecords } from "../lib/practice-records";
import type { SpanishDialect } from "../lib/user-settings";

export default function SettingsPage() {
  const { lang, status, reload, changeLang } = useUserSettings();
  const { learningOrigin, clearLearning } = useSentenceDraft();
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [failedDialect, setFailedDialect] = useState<SpanishDialect | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearMessage, setClearMessage] = useState("");
  const [clearFailed, setClearFailed] = useState(false);

  async function chooseDialect(next: SpanishDialect) {
    if (!lang || next === lang || saving) return;
    setSaveMessage("");
    setFailedDialect(null);
    setSaving(true);
    try {
      await changeLang(next);
      setSaveMessage("方言设置已保存");
    } catch (cause) {
      setFailedDialect(next);
      setSaveMessage(cause instanceof Error ? cause.message : "方言设置保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  async function shareTool() {
    const url = `${window.location.origin}/`;
    setShareUrl(url);
    const local = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    try {
      await navigator.clipboard.writeText(url);
      setShareMessage(local ? "已复制本机链接；公开分享需等上线后使用正式地址。" : "链接已复制，可分享给朋友。");
    } catch {
      setShareMessage(local ? "当前是本机链接，公开分享需等上线后使用正式地址。" : "复制失败，请手动复制下方链接。");
    }
  }

  async function clearRecords() {
    if (clearing || !confirmingClear) return;
    setClearMessage("");
    setClearFailed(false);
    setClearing(true);
    try {
      const count = await clearPracticeRecords();
      if (learningOrigin === "records") clearLearning();
      setConfirmingClear(false);
      setClearMessage(count ? `已清除 ${count} 条练习记录` : "没有需要清除的练习记录");
    } catch (cause) {
      setClearFailed(true);
      setClearMessage(cause instanceof Error ? cause.message : "清除失败，请重试");
    } finally {
      setClearing(false);
    }
  }

  return (
    <PageShell title="设置" backHref="/">
      <div className="page-stack">
        <section className="section-block">
          <SectionHeading>学习偏好</SectionHeading>
          <label className="field-group">
            <span className="field-label">西语方言</span>
            <select value={lang ?? ""} disabled={status !== "ready" || saving} className="select-input" onChange={(event) => void chooseDialect(event.target.value as SpanishDialect)}>
              {!lang && <option value="">正在加载…</option>}
              <option value="es-ES">西班牙西语 · es-ES</option>
              <option value="es-MX">墨西哥西语 · es-MX</option>
            </select>
          </label>
          {status === "loading" && <p className="supporting-copy" role="status">正在加载方言设置…</p>}
          {status === "error" && <p className="form-error" role="alert">方言设置加载失败 <button type="button" className="inline-retry" onClick={() => void reload()}>重试</button></p>}
          {saving && <p className="supporting-copy" role="status">正在保存方言设置…</p>}
          {saveMessage && <p className={failedDialect ? "form-error" : "supporting-copy"} role={failedDialect ? "alert" : "status"}>{saveMessage} {failedDialect && <button type="button" className="inline-retry" onClick={() => void chooseDialect(failedDialect)}>重试</button>}</p>}
        </section>
        <section className="section-block">
          <SectionHeading>分享</SectionHeading>
          <button type="button" className="plain-button" onClick={() => void shareTool()}>分享本工具</button>
          {shareMessage && <p className="supporting-copy" role="status">{shareMessage}</p>}
          {shareUrl && <input className="text-input" aria-label="分享链接" value={shareUrl} readOnly onFocus={(event) => event.target.select()} />}
        </section>
        <section className="section-block">
          <SectionHeading>数据</SectionHeading>
          {!confirmingClear ? <button type="button" className="plain-button" onClick={() => { setClearMessage(""); setConfirmingClear(true); }}>清除练习记录</button> : <div className="settings-clear-confirm">
            <p className="supporting-copy">确定清除你自己的全部练习记录吗？此操作无法撤销。</p>
            <div className="settings-clear-actions">
              <button type="button" disabled={clearing} className="secondary-button" onClick={() => setConfirmingClear(false)}>取消</button>
              <button type="button" disabled={clearing} className="primary-button" onClick={() => void clearRecords()}>{clearing ? "正在清除…" : clearFailed ? "重试清除" : "确认清除"}</button>
            </div>
          </div>}
          {clearMessage && <p className={clearFailed ? "form-error" : "supporting-copy"} role={clearFailed ? "alert" : "status"}>{clearMessage}</p>}
        </section>
        <section className="section-block">
          <SectionHeading>关于</SectionHeading>
          <p className="supporting-copy">版本 1 · 反馈</p>
        </section>
      </div>
    </PageShell>
  );
}
