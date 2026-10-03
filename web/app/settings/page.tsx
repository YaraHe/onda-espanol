import { PageShell, SectionHeading } from "../components/page-shell";

export default function SettingsPage() {
  return (
    <PageShell title="设置" backHref="/">
      <div className="page-stack">
        <section className="section-block">
          <SectionHeading>学习偏好</SectionHeading>
          <label className="field-group">
            <span className="field-label">西语方言</span>
            <select disabled className="select-input"><option>西班牙西语 · es-ES</option><option>墨西哥西语 · es-MX</option></select>
          </label>
        </section>
        <section className="section-block">
          <SectionHeading>分享</SectionHeading>
          <button type="button" disabled className="plain-button">分享本工具</button>
        </section>
        <section className="section-block">
          <SectionHeading>数据</SectionHeading>
          <button type="button" disabled className="plain-button">清除练习记录</button>
        </section>
        <section className="section-block">
          <SectionHeading>关于</SectionHeading>
          <p className="supporting-copy">版本 1 · 反馈</p>
        </section>
      </div>
    </PageShell>
  );
}
