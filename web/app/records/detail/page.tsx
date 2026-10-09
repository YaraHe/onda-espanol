"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSentenceDraft } from "../../components/sentence-draft";
import { EmptyText, PageShell, SectionHeading } from "../../components/page-shell";
import { getPracticeRecordDetail, type PracticeRecordDetail } from "../../lib/practice-records";
import { recentPracticeFeedback, recentScorePoints } from "../../lib/assessment-alignment";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function score(value: number | null): string {
  return value === null ? "暂无" : String(Math.round(value));
}

function dateLabel(value: string | null, includeTime = false): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(new Date(value));
}

function ScoreTrend({ history }: { history: PracticeRecordDetail["history"] }) {
  const points = recentScorePoints(history);
  if (!points.length) return <EmptyText>还没有可显示的总分记录</EmptyText>;
  const width = 320;
  const left = 30;
  const right = 8;
  const top = 12;
  const bottom = 132;
  const x = (index: number) => points.length === 1 ? (left + width - right) / 2
    : left + index * (width - left - right) / (points.length - 1);
  const y = (value: number) => top + (100 - value) * (bottom - top) / 100;
  const polyline = points.map((point, index) => `${x(index)},${y(point.score)}`).join(" ");
  return <div className="score-trend">
    <svg viewBox={`0 0 ${width} 150`} role="img" aria-label={`最近 ${points.length} 次练习总分趋势，纵轴固定为 0 到 100 分`}>
      {[100, 50, 0].map((value) => <g key={value}>
        <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} />
        <text x="0" y={y(value) + 4}>{value}</text>
      </g>)}
      {points.length > 1 && <polyline className="score-trend-line" points={polyline} />}
      {points.map((point, index) => <circle key={point.id} cx={x(index)} cy={y(point.score)} r="4">
        <title>{`${dateLabel(point.created_at)}：${point.score} 分`}</title>
      </circle>)}
    </svg>
    <p>最近 {points.length} 次 · 总分 / 100</p>
  </div>;
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
    const recentFeedback = recentPracticeFeedback(detail.sentence, detail.history);
    prepareRecordPractice(detail.sentence, detail.translation, recordId, recentFeedback?.focus.goal ?? null);
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
            <SectionHeading>最近总分</SectionHeading>
            <ScoreTrend history={detail.history} />
            {detail.history.length ? (() => {
              const recentFeedback = recentPracticeFeedback(detail.sentence, detail.history);
              if (!recentFeedback) return null;
              const feedbackAttempt = recentFeedback.attempt;
              const feedback = recentFeedback.focus;
              const feedbackTitle = recentFeedback.reliable ? "最近一次可靠反馈" : "最近一次练习";
              return <section className="latest-practice-feedback" aria-label={feedbackTitle}>
                <SectionHeading>{feedbackTitle}</SectionHeading>
                <p className="latest-feedback-meta"><time dateTime={feedbackAttempt.created_at ?? undefined}>{dateLabel(feedbackAttempt.created_at, true)}</time><span>总分 {score(feedbackAttempt.overall)}</span></p>
                <p>{feedback.feedback}</p>
                {feedback.goal && <p><strong>下次目标：</strong>{feedback.goal}</p>}
              </section>;
            })() : <EmptyText>还没有练习记录</EmptyText>}
            {detail.history.length > 0 && <details className="record-history-disclosure">
              <summary>展开历史明细（{detail.history.length} 次）</summary>
              <ol className="record-history">
                {detail.history.map((attempt) => <li key={attempt.id}>
                  <p className="record-history-time">{dateLabel(attempt.created_at, true)}</p>
                  <p>总分 {score(attempt.overall)}</p>
                  <div className="record-history-scores">
                    <span>准确度 {score(attempt.accuracy)}</span>
                    <span>流利度 {score(attempt.fluency)}</span>
                    <span>完整度 {score(attempt.completeness)}</span>
                  </div>
                  <p className="record-history-rate">语速 {attempt.speaking_rate === null ? "暂无" : `${Math.round(attempt.speaking_rate)} 词/分`}</p>
                </li>)}
              </ol>
            </details>}
          </section>
        </>}
      </div>
    </PageShell>
  );
}

export default function RecordDetailPage() {
  return <Suspense fallback={<PageShell title="记录详情" backHref="/records"><p className="supporting-copy" role="status">正在加载记录详情…</p></PageShell>}><RecordDetailContent /></Suspense>;
}
