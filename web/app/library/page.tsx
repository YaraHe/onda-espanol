"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "../components/icons";
import { EmptyText, PageShell, SectionHeading } from "../components/page-shell";
import { useSentenceDraft } from "../components/sentence-draft";
import { filterLibrarySentences, librarySentences, type LibraryFilters } from "../lib/sentence-library";

const options = {
  difficulty: [...new Set(librarySentences.map((item) => item.difficulty))],
  scene: [...new Set(librarySentences.map((item) => item.scene))],
  grammarPoint: [...new Set(librarySentences.map((item) => item.grammarPoint))],
};

export default function LibraryPage() {
  const router = useRouter();
  const { libraryFilters, setLibraryFilters, prepareLibraryLearning } = useSentenceDraft();
  const visible = filterLibrarySentences(librarySentences, libraryFilters);

  function updateFilter(key: keyof LibraryFilters, value: string) {
    setLibraryFilters({ ...libraryFilters, [key]: value });
  }

  function chooseSentence(sentence: string) {
    prepareLibraryLearning(sentence);
    router.push("/explanation?from=/library");
  }

  return (
    <PageShell title="句子库" primary="library" extra={<Link href="/listening" className="icon-link" aria-label="磨耳朵"><Icon name="headphones" /></Link>}>
      <div className="page-stack">
        <section className="section-block">
          <SectionHeading>筛选句子</SectionHeading>
          <div className="filter-grid">
            {([
              ["difficulty", "难度"],
              ["scene", "场景"],
              ["grammarPoint", "语法点"],
            ] as const).map(([key, label]) => (
              <label key={key} className="field-group">
                <span className="field-label">{label}</span>
                <select aria-label={label} className="select-input" value={libraryFilters[key]} onChange={(event) => updateFilter(key, event.target.value)}>
                  <option value="">全部</option>
                  {options[key].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
            ))}
          </div>
        </section>
        <section className="section-block">
          <SectionHeading>句子</SectionHeading>
          {visible.length ? (
            <ul className="library-list">
              {visible.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => chooseSentence(item.sentence)}>
                    <span className="library-sentence" lang="es">{item.sentence}</span>
                    <span className="library-meta"><span>{item.difficulty}</span><span>{item.source}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <EmptyText>{librarySentences.length ? "无匹配句子" : "暂无句子"}</EmptyText>}
        </section>
      </div>
    </PageShell>
  );
}
