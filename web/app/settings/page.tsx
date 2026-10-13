"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/auth-provider";
import { PageShell, SectionHeading } from "../components/page-shell";
import { useSentenceDraft } from "../components/sentence-draft";
import { useUserSettings } from "../components/user-settings-provider";
import { clearPracticeRecords } from "../lib/practice-records";
import { readPracticeRecoverySnapshot } from "../lib/practice-recovery.mjs";
import { getSupabaseClient } from "../lib/supabase";
import type { SpanishDialect } from "../lib/user-settings";

type AccountInfo = { requestKey: string; nickname: string; email: string };

function AccountTileAvatar() {
  return (
    <svg className="settings-avatar" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="60" height="60" rx="3" fill="var(--paper)" stroke="var(--blue)" strokeWidth="1.5" />
      <path d="M32 29C24 23 24 13 32 7c8 6 8 16 0 22ZM35 32c6-8 16-8 22 0-6 8-16 8-22 0ZM32 35c8 6 8 16 0 22-8-6-8-16 0-22ZM29 32c-6 8-16 8-22 0 6-8 16-8 22 0Z" fill="var(--blue)" opacity=".83" />
      <circle cx="32" cy="32" r="5" fill="var(--paper)" stroke="var(--blue)" strokeWidth="1.5" />
    </svg>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { status: authStatus, userId } = useAuth();
  const { lang, status, reload, changeLang } = useUserSettings();
  const { learningOrigin, clearLearning } = useSentenceDraft();
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [accountError, setAccountError] = useState<{ requestKey: string; message: string } | null>(null);
  const [accountReload, setAccountReload] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [failedDialect, setFailedDialect] = useState<SpanishDialect | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearMessage, setClearMessage] = useState("");
  const [clearFailed, setClearFailed] = useState(false);

  useEffect(() => {
    if (authStatus !== "signed-in" || !userId) return;
    let active = true;
    const requestKey = `${userId}:${accountReload}`;
    void (async () => {
      try {
        const supabase = getSupabaseClient();
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user || user.id !== userId || !user.email) throw new Error("当前账号信息读取失败");
        const { data: profile, error: profileError } = await supabase.from("profiles")
          .select("nickname").eq("id", userId).maybeSingle();
        if (profileError) throw profileError;
        const savedNickname = typeof profile?.nickname === "string" ? profile.nickname.trim() : "";
        const metadataNickname = typeof user.user_metadata?.nickname === "string" ? user.user_metadata.nickname.trim() : "";
        if (active) setAccount({ requestKey, nickname: savedNickname || metadataNickname, email: user.email });
      } catch {
        if (active) setAccountError({ requestKey, message: "当前账号信息读取失败，请重试。" });
      }
    })();
    return () => { active = false; };
  }, [authStatus, userId, accountReload]);

  async function signOut() {
    if (signingOut || authStatus !== "signed-in" || !userId) return;
    const ownerUserId = userId;
    let hasPendingScore = false;
    try {
      const recovery = readPracticeRecoverySnapshot(window.sessionStorage, ownerUserId);
      hasPendingScore = recovery.status === "found" && recovery.snapshot.draft !== null
        && ["score-ready", "saving", "failed"].includes(recovery.snapshot.stage);
    } catch { /* Browser storage may be unavailable. */ }
    if (hasPendingScore && !window.confirm("当前评分尚未确认保存。退出登录会清除这份评分的本地恢复副本，确定退出吗？")) return;
    setSignOutError("");
    setSigningOut(true);
    try {
      const { error } = await getSupabaseClient().auth.signOut({ scope: "local" });
      if (error) throw error;
      router.replace("/login");
    } catch {
      setSignOutError("退出登录失败，请检查网络后重试。当前账号仍保持登录。");
      setSigningOut(false);
    }
  }

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
      <div className="page-stack settings-page">
        <section className="section-block settings-account" aria-label="当前账号">
          <div className="settings-account-identity">
            <AccountTileAvatar />
            <div className="settings-account-text">
              {account?.requestKey === `${userId}:${accountReload}` ? <>
                <p className="settings-account-name">{account.nickname || "未设置昵称"}</p>
                <p className="settings-account-email">{account.email}</p>
              </> : accountError?.requestKey === `${userId}:${accountReload}` ? <>
                <p className="settings-account-name">账号信息暂不可用</p>
                <p className="form-error" role="alert">{accountError.message} <button type="button" className="inline-retry" onClick={() => setAccountReload((value) => value + 1)}>重试</button></p>
              </> : <p className="supporting-copy" role="status">正在读取当前账号…</p>}
            </div>
          </div>
          <button type="button" className="plain-button settings-signout" disabled={signingOut} onClick={() => void signOut()}>{signingOut ? "正在退出…" : "退出登录"}</button>
          {signOutError && <p className="form-error" role="alert">{signOutError}</p>}
        </section>
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
            <p className="supporting-copy">确定清除你自己的全部评分记录吗？个人句子仍会保留。此操作无法撤销。</p>
            <div className="settings-clear-actions">
              <button type="button" disabled={clearing} className="secondary-button" onClick={() => setConfirmingClear(false)}>取消</button>
              <button type="button" disabled={clearing} className="primary-button" onClick={() => void clearRecords()}>{clearing ? "正在清除…" : clearFailed ? "重试清除" : "确认清除"}</button>
            </div>
          </div>}
          {clearMessage && <p className={clearFailed ? "form-error" : "supporting-copy"} role={clearFailed ? "alert" : "status"}>{clearMessage}</p>}
        </section>
        <section className="section-block">
          <SectionHeading>关于</SectionHeading>
          <p className="supporting-copy">版本 1</p>
        </section>
      </div>
    </PageShell>
  );
}
