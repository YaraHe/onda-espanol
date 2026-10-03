import { EmptyText, PageShell, SectionHeading } from "../../components/page-shell";

export default function RecordDetailPage() {
  return (
    <PageShell title="记录详情" backHref="/records" action={<div className="split-actions"><button type="button" disabled className="primary-button">再练一次</button><button type="button" disabled className="secondary-button">查看讲解</button></div>}>
      <div className="page-stack">
        <section className="section-block">
          <SectionHeading>句子</SectionHeading>
          <EmptyText>从练习记录进入后，可查看这句话的得分。</EmptyText>
        </section>
        <section className="section-block">
          <SectionHeading>练习历史</SectionHeading>
          <EmptyText>还没有练习记录</EmptyText>
        </section>
      </div>
    </PageShell>
  );
}
