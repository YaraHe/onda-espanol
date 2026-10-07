"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseClient } from "../lib/supabase";
import { PageShell } from "./page-shell";
import { useSentenceDraft } from "./sentence-draft";

type AuthStatus = "checking" | "signed-in" | "signed-out" | "error";

const AuthContext = createContext<{
  status: AuthStatus;
  userId: string | null;
  refresh: () => Promise<void>;
} | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [userId, setUserId] = useState<string | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;

    try {
      const supabase = getSupabaseClient();
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) {
        if (currentRequest === requestId.current) { setUserId(null); setStatus("signed-out"); }
        return;
      }

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (currentRequest === requestId.current) { setUserId(user?.id ?? null); setStatus(user ? "signed-in" : "signed-out"); }
    } catch {
      if (currentRequest === requestId.current) { setUserId(null); setStatus("error"); }
    }
  }, []);

  useEffect(() => {
    let active = true;
    let subscription: { unsubscribe: () => void } | undefined;
    try {
      const supabase = getSupabaseClient();
      ({ data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT") {
          requestId.current += 1;
          setUserId(null);
          setStatus("signed-out");
        } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "PASSWORD_RECOVERY") {
          requestId.current += 1;
          setUserId(session?.user.id ?? null);
          setStatus(session ? "signed-in" : "signed-out");
        }
      }));
    } catch {
      // refresh below reports missing configuration through the normal error state.
    }
    void Promise.resolve().then(() => { if (active) return refresh(); });
    return () => {
      active = false;
      requestId.current += 1;
      subscription?.unsubscribe();
    };
  }, [refresh]);

  return <AuthContext.Provider value={{ status, userId, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("AuthProvider is missing");
  return auth;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { status, refresh } = useAuth();
  const { clearLearning } = useSentenceDraft();
  const pathname = usePathname();
  const router = useRouter();
  const authPage = pathname === "/login" || pathname === "/login/reset";

  useEffect(() => {
    if (status === "signed-out" && !authPage) router.replace("/login");
  }, [authPage, router, status]);

  useEffect(() => {
    if (status === "signed-out") clearLearning();
  }, [status, clearLearning]);

  if (status === "checking") {
    return <PageShell title="登录状态"><p className="supporting-copy" role="status">正在检查登录状态…</p></PageShell>;
  }
  if (status === "error") {
    return (
      <PageShell title="登录状态">
        <div className="section-block">
          <p className="supporting-copy" role="alert">暂时无法检查登录状态，请检查网络后重试。</p>
          <button type="button" className="plain-button" onClick={() => void refresh()}>重试</button>
        </div>
      </PageShell>
    );
  }
  if (status === "signed-out" && !authPage) {
    return <PageShell title="登录状态"><p className="supporting-copy" role="status">正在打开登录页…</p></PageShell>;
  }
  return children;
}
