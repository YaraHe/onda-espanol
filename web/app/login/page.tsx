"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../components/auth-provider";
import { PageShell } from "../components/page-shell";
import { getSupabaseClient } from "../lib/supabase";

type Mode = "login" | "register" | "forgot";

function emailIsValid(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function authErrorMessage(error: { code?: string; message?: string; name?: string }) {
  switch (error.code) {
    case "invalid_credentials": return "邮箱或密码不正确，请重试。";
    case "email_not_confirmed": return "请先打开确认邮件完成邮箱验证。";
    case "user_already_exists": return "该邮箱已注册，请直接登录或重置密码。";
    case "weak_password": return "密码未达到要求，请换一个更强的密码。";
    case "email_address_invalid": return "邮箱地址无效，请检查后重试。";
    case "over_email_send_rate_limit": return "邮件发送过于频繁，请稍后再试。";
    default:
      return error.name === "AuthRetryableFetchError" || error.message?.includes("Failed to fetch")
        ? "网络连接失败，请检查网络后重试。"
        : "操作未完成，请稍后重试。";
  }
}

export default function LoginPage() {
  const router = useRouter();
  const { status } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (status === "signed-in") router.replace("/");
  }, [router, status]);

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    setPassword("");
    setError("");
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setMessage("");

    const normalizedEmail = email.trim();
    if (!emailIsValid(normalizedEmail)) {
      setError("请输入有效的邮箱地址。");
      return;
    }
    if (mode !== "forgot" && !password) {
      setError("请输入密码。");
      return;
    }
    if (mode === "register" && !nickname.trim()) {
      setError("请输入昵称。");
      return;
    }

    setPending(true);
    try {
      const supabase = getSupabaseClient();
      if (mode === "register") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: { nickname: nickname.trim() },
            emailRedirectTo: `${window.location.origin}/login`,
          },
        });
        if (signUpError) throw signUpError;
        if (data.session) {
          router.replace("/");
        } else {
          setMessage("如果该邮箱可以注册，确认邮件会发送至你的邮箱。请确认后再登录。");
          setPassword("");
        }
      } else if (mode === "forgot") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: `${window.location.origin}/login/reset`,
        });
        if (resetError) throw resetError;
        setMessage("如果该邮箱已注册，密码重置邮件会发送至你的邮箱。请按邮件中的链接继续。");
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (signInError) throw signInError;
        if (!data.session || !data.user) throw new Error("Sign-in did not return a session");
        router.replace("/");
      }
    } catch (cause) {
      setError(authErrorMessage(cause instanceof Error ? cause : {}));
    } finally {
      setPending(false);
    }
  }

  const title = mode === "register" ? "注册账号" : mode === "forgot" ? "重置密码" : "登录";
  const submitLabel = mode === "register" ? "注册账号" : mode === "forgot" ? "发送重置邮件" : "登录";

  return (
    <PageShell title={title}>
      <div className="page-stack login-page">
        <p className="intro-copy">登录后，练习记录可以在不同设备上继续查看。</p>
        <form className="form-stack" onSubmit={(event) => void submit(event)} noValidate>
          {mode === "register" && (
            <label className="field-group">
              <span className="field-label">昵称</span>
              <input type="text" autoComplete="nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="你的昵称" className="text-input" disabled={pending} />
            </label>
          )}
          <label className="field-group">
            <span className="field-label">邮箱</span>
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="你的邮箱地址" className="text-input" disabled={pending} />
          </label>
          {mode !== "forgot" && (
            <label className="field-group">
              <span className="field-label">密码</span>
              <input type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="输入密码" className="text-input" disabled={pending} />
            </label>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          {message && <p className="supporting-copy" role="status">{message}</p>}
          <button type="submit" disabled={pending} className="auth-submit">{pending ? "请稍候…" : submitLabel}</button>
          {mode === "login" ? (
            <div className="auth-links">
              <button type="button" disabled={pending} className="plain-button" onClick={() => changeMode("register")}>注册账号</button>
              <button type="button" disabled={pending} className="plain-button" onClick={() => changeMode("forgot")}>忘记密码</button>
            </div>
          ) : (
            <button type="button" disabled={pending} className="plain-button" onClick={() => changeMode("login")}>返回登录</button>
          )}
        </form>
      </div>
    </PageShell>
  );
}
