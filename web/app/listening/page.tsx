import { EmptyText, PageShell, SectionHeading } from "../components/page-shell";

export default function ListeningPage() {
  return (
    <PageShell title="磨耳朵" backHref="/library" action={<button type="button" disabled className="primary-button">开始播放</button>}>
      <div className="page-stack">
        <section className="section-block">
          <SectionHeading>朗读范围</SectionHeading>
          <div className="option-row" aria-label="朗读范围">
            {["已学", "全部", "自定义"].map((label) => <button key={label} type="button" disabled className="option-choice">{label}</button>)}
          </div>
        </section>
        <section className="section-block">
          <SectionHeading>播放设置</SectionHeading>
          <label className="field-group">
            <span className="field-label">语速</span>
            <input type="range" min="0.6" max="1.2" step="0.1" defaultValue="1" disabled className="range-input" />
          </label>
          <label className="field-group">
            <span className="field-label">句间间隔</span>
            <select disabled className="select-input"><option>选择间隔</option></select>
          </label>
        </section>
        <section className="section-block">
          <SectionHeading>显示设置</SectionHeading>
          <label className="toggle-row"><span>显示原文</span><input type="checkbox" defaultChecked disabled /></label>
          <label className="toggle-row"><span>显示翻译</span><input type="checkbox" disabled /></label>
        </section>
        <section className="section-block">
          <SectionHeading>播放列表</SectionHeading>
          <EmptyText>暂无可播放的句子</EmptyText>
        </section>
      </div>
    </PageShell>
  );
}
