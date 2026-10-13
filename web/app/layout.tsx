import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { SentenceDraftProvider } from "./components/sentence-draft";
import { AuthGate, AuthProvider } from "./components/auth-provider";
import { UserSettingsProvider } from "./components/user-settings-provider";
import { BackendHealthProbe } from "./components/backend-health-probe";

export const metadata: Metadata = {
  title: "西语学习",
  description: "跌宕起伏的西语：个人西班牙语学习与跟读练习。",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "西语学习",
    statusBarStyle: "default",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6f2e8",
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
          <AuthProvider><UserSettingsProvider><AuthGate>{children}</AuthGate></UserSettingsProvider></AuthProvider>
        </SentenceDraftProvider>
      </body>
    </html>
  );
}
