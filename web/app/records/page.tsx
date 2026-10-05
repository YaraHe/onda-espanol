"use client";

import { useEffect, useState } from "react";
import { EmptyText, PageShell, SectionHeading } from "../components/page-shell";
import { listPracticeRecords, type PracticeRecordSummary } from "../lib/practice-records";

export default function RecordsPage() {
  const [records, setRecords] = useState<PracticeRecordSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    void listPracticeRecords().then((data) => {
      if (active) { setRecords(data); setStatus("ready"); }
    }).catch(() => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, []);

  async function reload() {
    setStatus("loading");
    try { setRecords(await listPracticeRecords()); setStatus("ready"); }
    catch { setStatus("error"); }
  }

  return (
    <PageShell title="练习记录" primary="records">
      <div className="page-stack">
        <section className="section-block">
          <SectionHeading>练习记录</SectionHeading>
          {status === "loading" && <p className="supporting-copy" role="status">正在加载练习记录…</p>}
          {status === "error" && <p className="supporting-copy" role="alert">练习记录加载失败 <button type="button" className="inline-retry" onClick={() => void reload()}>重试</button></p>}
          {status === "ready" && (records.length ? <ul className="record-list">
            {records.map((record) => <li key={record.id}>
              <p lang="es">{record.sentence}</p>
              <span>{record.overall === null ? "暂无总分" : `总分 ${Math.round(record.overall)}`} · {record.created_at ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(record.created_at)) : "时间未知"}</span>
            </li>)}
          </ul> : <EmptyText>还没有练习记录</EmptyText>)}
        </section>
      </div>
    </PageShell>
  );
}
