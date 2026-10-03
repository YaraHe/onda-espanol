import type { Metadata } from "next";
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
        <BackendHealthProbe />
        <SentenceDraftProvider>
          <AuthProvider><AuthGate>{children}</AuthGate></AuthProvider>
        </SentenceDraftProvider>
      </body>
    </html>
  );
}
