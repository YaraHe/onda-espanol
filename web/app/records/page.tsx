import { EmptyText, PageShell } from "../components/page-shell";

export default function RecordsPage() {
  return (
    <PageShell title="练习记录" primary="records">
      <div className="page-stack">
        <section className="section-block">
          <EmptyText>还没有练习记录</EmptyText>
        </section>
      </div>
    </PageShell>
  );
}
