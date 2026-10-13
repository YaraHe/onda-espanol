import type { Explanation } from "../lib/explanation";

export function PronunciationAnnotation({ annotation }: { annotation: Explanation["annotation"] }) {
  if (!annotation) return null;

  return (
    <div className="annotation-content">
      {annotation.stress.length > 0 && (
        <p className="annotation-row"><span className="annotation-label">重音</span><span>{annotation.stress.map((item) => item.display).join(" · ")}</span></p>
      )}
      {annotation.liaison.length > 0 && (
        <p className="annotation-row"><span className="annotation-label">连读</span><span>{annotation.liaison.map((item) => `${item.words}：${item.note}`).join("；")}</span></p>
      )}
      {annotation.pauses.length > 0 && (
        <p className="annotation-row"><span className="annotation-label">停顿</span><span>{annotation.pauses.map((item) => `${item.after} 后${item.type}`).join("；")}</span></p>
      )}
      {annotation.pitchPattern.trim() && <p className="annotation-row"><span className="annotation-label">语调</span><span>{annotation.pitchPattern}</span></p>}
    </div>
  );
}
