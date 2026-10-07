"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "./auth-provider";
import { readUserDialect, saveUserDialect, type SpanishDialect } from "../lib/user-settings";

type DialectState = { userId: string; lang: SpanishDialect; status: "ready" } | { userId: string; lang: null; status: "loading" | "error" };

const UserSettingsContext = createContext<{
  lang: SpanishDialect | null;
  status: "loading" | "ready" | "error";
  reload: () => Promise<void>;
  changeLang: (lang: SpanishDialect) => Promise<void>;
} | null>(null);

export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const [state, setState] = useState<DialectState | null>(null);
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    if (!userId) return;
    const currentRequest = ++requestId.current;
    setState({ userId, lang: null, status: "loading" });
    try {
      const lang = await readUserDialect(userId);
      if (currentRequest === requestId.current) setState({ userId, lang, status: "ready" });
    } catch {
      if (currentRequest === requestId.current) setState({ userId, lang: null, status: "error" });
    }
  }, [userId]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return reload(); });
    return () => { active = false; requestId.current += 1; };
  }, [reload]);

  const changeLang = useCallback(async (next: SpanishDialect) => {
    if (!userId || state?.userId !== userId || state.status !== "ready") throw new Error("方言设置尚未加载");
    await saveUserDialect(userId, next);
    setState({ userId, lang: next, status: "ready" });
  }, [userId, state]);

  const active = state?.userId === userId ? state : null;
  return <UserSettingsContext.Provider value={{
    lang: active?.lang ?? null,
    status: active?.status ?? "loading",
    reload,
    changeLang,
  }}>{children}</UserSettingsContext.Provider>;
}

export function useUserSettings() {
  const settings = useContext(UserSettingsContext);
  if (!settings) throw new Error("UserSettingsProvider is missing");
  return settings;
}
