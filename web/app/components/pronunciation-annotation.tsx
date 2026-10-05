import type { Explanation } from "../lib/explanation";

export function PronunciationAnnotation({ annotation }: { annotation: Explanation["annotation"] }) {
  if (!annotation) return <p className="missing-part">语调标注：该部分未生成</p>;

  return (
    <div className="annotation-content">
      {annotation.stress.length > 0 && (
        <p><span className="annotation-label">重音</span>{annotation.stress.map((item) => item.display).join(" · ")}</p>
      )}
      {annotation.liaison.length > 0 && (
        <p><span className="annotation-label">连读</span>{annotation.liaison.map((item) => `${item.words}：${item.note}`).join("；")}</p>
      )}
      {annotation.pauses.length > 0 && (
        <p><span className="annotation-label">停顿</span>{annotation.pauses.map((item) => `${item.after} 后${item.type}`).join("；")}</p>
      )}
      <p><span className="annotation-label">语调</span>{annotation.pitchPattern}</p>
    </div>
  );
}
