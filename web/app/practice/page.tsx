import { Icon } from "../components/icons";
import { EmptyText, PageShell, SectionHeading } from "../components/page-shell";

export default function PracticePage() {
  return (
    <PageShell title="跟读练习" backHref="/explanation" action={<button type="button" disabled className="primary-button"><Icon name="mic" />录音</button>}>
      <div className="page-stack">
        <section className="section-block">
          <SectionHeading>原句</SectionHeading>
          <EmptyText>选定句子后，就可以听示范并练习朗读。</EmptyText>
        </section>
        <section className="section-block">
          <SectionHeading>听示范</SectionHeading>
          <button type="button" disabled className="secondary-button"><Icon name="volume" />听示范</button>
          <div className="speed-row" aria-label="朗读语速">
            {["0.6×", "0.8×", "1.0×", "1.2×"].map((speed) => (
              <button key={speed} type="button" disabled className={speed === "1.0×" ? "speed-choice selected" : "speed-choice"}>{speed}</button>
            ))}
          </div>
        </section>
      </div>
    </PageShell>
  );
}
