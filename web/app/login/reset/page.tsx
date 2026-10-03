"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useAuth } from "../../components/auth-provider";
import { PageShell } from "../../components/page-shell";
import { getSupabaseClient } from "../../lib/supabase";

export default function ResetPasswordPage() {
  const { status } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    if (!password || password !== confirmation) {
      setError("请输入两次相同的新密码。");
      return;
    }

    setPending(true);
    try {
      const supabase = getSupabaseClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      setComplete(true);
      setPassword("");
      setConfirmation("");
    } catch {
      setError("密码未能更新，请检查网络或重新申请重置邮件后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <PageShell title="设置新密码">
      <div className="page-stack login-page">
        {complete ? (
          <div className="section-block">
            <p className="supporting-copy" role="status">密码已更新，请使用新密码登录。</p>
            <Link href="/login" className="inline-link">返回登录</Link>
          </div>
        ) : status !== "signed-in" ? (
          <div className="section-block">
            <p className="supporting-copy" role="alert">重置链接无效或已过期，请重新申请重置邮件。</p>
            <Link href="/login" className="inline-link">返回登录</Link>
          </div>
        ) : (
          <form className="form-stack" onSubmit={(event) => void submit(event)} noValidate>
            <label className="field-group">
              <span className="field-label">新密码</span>
              <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="text-input" disabled={pending} />
            </label>
            <label className="field-group">
              <span className="field-label">再次输入新密码</span>
              <input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="text-input" disabled={pending} />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit" disabled={pending} className="auth-submit">{pending ? "正在更新…" : "保存新密码"}</button>
          </form>
        )}
      </div>
    </PageShell>
  );
}
