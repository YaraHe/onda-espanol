import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { SentenceDraftProvider } from "./components/sentence-draft";
import { AuthGate, AuthProvider } from "./components/auth-provider";
import { BackendHealthProbe } from "./components/backend-health-probe";

export const metadata: Metadata = {
  title: "西语学习",
  description: "Spanish learning app",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <Script id="practice-history-guard" strategy="beforeInteractive">{`
          (() => {
            let restoring = false;
            window.addEventListener("popstate", (event) => {
              if (restoring) {
                restoring = false;
                event.stopImmediatePropagation();
                return;
              }
              const confirmLeave = window.__confirmPracticeHistoryLeave;
              if (!confirmLeave || confirmLeave()) return;
              event.stopImmediatePropagation();
              restoring = true;
              window.history.forward();
            });
          })();
        `}</Script>
        <BackendHealthProbe />
        <SentenceDraftProvider>
          <AuthProvider><AuthGate>{children}</AuthGate></AuthProvider>
        </SentenceDraftProvider>
      </body>
    </html>
  );
}
