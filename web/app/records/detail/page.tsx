"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSentenceDraft } from "../../components/sentence-draft";
import { EmptyText, PageShell, SectionHeading } from "../../components/page-shell";
import { getPracticeRecordDetail, type PracticeRecordDetail } from "../../lib/practice-records";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function score(value: number | null): string {
  return value === null ? "暂无" : String(Math.round(value));
}

function RecordDetailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { prepareRecordExplanation, prepareRecordPractice } = useSentenceDraft();
  const recordId = searchParams.get("id") ?? "";
  const [detail, setDetail] = useState<PracticeRecordDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!uuidPattern.test(recordId)) return;
    let active = true;
    void getPracticeRecordDetail(recordId).then((result) => {
      if (!active) return;
      setDetail(result);
      setStatus(result ? "ready" : "missing");
    }).catch(() => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, [recordId, retry]);

  const displayStatus = uuidPattern.test(recordId) ? status : "missing";

  const reload = useCallback(() => {
    setStatus("loading");
    setRetry((value) => value + 1);
  }, []);

  function repeatPractice() {
    if (!detail?.translation || !recordId) return;
    prepareRecordPractice(detail.sentence, detail.translation, recordId);
    router.push("/practice");
  }

  function viewExplanation() {
    if (!detail || !recordId) return;
    prepareRecordExplanation(detail.sentence, recordId);
    router.push("/explanation");
  }

  return (
    <PageShell title="记录详情" backHref="/records" action={displayStatus === "ready" && detail ? <div className="split-actions">
      <button type="button" className="primary-button" disabled={!detail.translation} onClick={repeatPractice}>再练一次</button>
      <button type="button" className="secondary-button" onClick={viewExplanation}>查看讲解</button>
    </div> : undefined}>
      <div className="page-stack">
        {displayStatus === "loading" && <p className="supporting-copy" role="status">正在加载记录详情…</p>}
        {displayStatus === "error" && <p className="supporting-copy" role="alert">记录详情加载失败 <button type="button" className="inline-retry" onClick={reload}>重试</button></p>}
        {displayStatus === "missing" && <section className="section-block"><EmptyText>记录不存在或无法访问。</EmptyText><Link href="/records" className="inline-link">返回练习记录</Link></section>}
        {displayStatus === "ready" && detail && <>
          <section className="section-block">
            <SectionHeading>句子</SectionHeading>
            <p className="learning-sentence" lang="es">{detail.sentence}</p>
            <p className="translation-text">{detail.translation ?? "暂无中文翻译"}</p>
            {!detail.translation && <p className="supporting-copy">这条记录没有保存译文，暂时无法直接再练一次。</p>}
          </section>
          <section className="section-block">
            <SectionHeading>练习历史</SectionHeading>
            {detail.history.length ? <ol className="record-history">
              {detail.history.map((attempt) => <li key={attempt.id}>
                <p className="record-history-time">{attempt.created_at ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(attempt.created_at)) : "时间未知"}</p>
                <p>总分 {score(attempt.overall)}</p>
                <div className="record-history-scores">
                  <span>准确度 {score(attempt.accuracy)}</span>
                  <span>流利度 {score(attempt.fluency)}</span>
                  <span>完整度 {score(attempt.completeness)}</span>
                </div>
                <p className="record-history-rate">语速 {attempt.speaking_rate === null ? "暂无" : `${Math.round(attempt.speaking_rate)} 词/分`}</p>
              </li>)}
            </ol> : <EmptyText>还没有练习记录</EmptyText>}
          </section>
        </>}
      </div>
    </PageShell>
  );
}

export default function RecordDetailPage() {
  return <Suspense fallback={<PageShell title="记录详情" backHref="/records"><p className="supporting-copy" role="status">正在加载记录详情…</p></PageShell>}><RecordDetailContent /></Suspense>;
}
