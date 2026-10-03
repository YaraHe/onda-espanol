import { Icon } from "./components/icons";
import { EmptyText, PageShell, SectionHeading } from "./components/page-shell";
import { SentenceEntry } from "./components/sentence-entry";

export default function SelectPage() {
  return (
    <PageShell title="选句" primary="select">
      <div className="page-stack select-page">
        <SentenceEntry />
        <section className="section-block">
          <SectionHeading>最近练习</SectionHeading>
          <EmptyText>暂无最近练习</EmptyText>
        </section>
        <div className="select-submit">
          <button type="button" disabled className="primary-button"><Icon name="search" />查询</button>
        </div>
      </div>
    </PageShell>
  );
}
