import Link from "next/link";
import { Icon } from "../components/icons";
import { EmptyText, PageShell, SectionHeading } from "../components/page-shell";

export default function LibraryPage() {
  return (
    <PageShell title="句子库" primary="library" extra={<Link href="/listening" className="icon-link" aria-label="磨耳朵"><Icon name="headphones" /></Link>}>
      <div className="page-stack">
        <section className="section-block">
          <SectionHeading>筛选句子</SectionHeading>
          <div className="filter-grid">
            {["难度", "场景", "语法点", "来源"].map((label) => (
              <label key={label} className="field-group">
                <span className="field-label">{label}</span>
                <select disabled aria-label={label} className="select-input"><option>全部</option></select>
              </label>
            ))}
          </div>
        </section>
        <section className="section-block">
          <SectionHeading>句子</SectionHeading>
          <EmptyText>暂无句子</EmptyText>
        </section>
      </div>
    </PageShell>
  );
}
