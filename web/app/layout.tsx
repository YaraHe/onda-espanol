import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "西语学习",
  description: "Spanish learning app",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
