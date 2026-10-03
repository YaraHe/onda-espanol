import Link from "next/link";
import { EmptyText, PageShell, SectionHeading } from "../components/page-shell";

export default function ExplanationPage() {
  return (
    <PageShell title="句子讲解" backHref="/" action={<button type="button" disabled className="primary-button">去跟读</button>}>
      <div className="page-stack">
        <section className="section-block">
          <SectionHeading>原句</SectionHeading>
          <EmptyText>先在选句页查询一句西语，讲解会显示在这里。</EmptyText>
          <Link href="/" className="inline-link">去选句</Link>
        </section>
        <section className="section-block subdued-section">
          <SectionHeading>中文翻译</SectionHeading>
          <p className="placeholder-line">等待句子讲解</p>
        </section>
        <section className="section-block subdued-section">
          <SectionHeading>核心记忆点</SectionHeading>
          <p className="placeholder-line">等待句子讲解</p>
        </section>
        <div className="grammar-details">
          <button type="button" disabled className="grammar-summary" aria-expanded="false">
            语法分析 <span aria-hidden="true">⌄</span>
          </button>
        </div>
      </div>
    </PageShell>
  );
}
