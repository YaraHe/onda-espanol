const queryStartMark = "onda.explain.query_start";
const resultReadyMark = "onda.explain.result_ready";

export function clearExplainPresentationTiming(): void {
  performance.clearMarks(queryStartMark);
  performance.clearMarks(resultReadyMark);
}

export function markExplainQueryStart(): void {
  clearExplainPresentationTiming();
  performance.mark(queryStartMark);
}

export function markExplainResultReady(): void {
  performance.mark(resultReadyMark);
}

// Called after the explanation page has committed and had a paint opportunity.
export function reportExplainPresentationTiming(): void {
  const start = performance.getEntriesByName(queryStartMark).at(-1)?.startTime;
  const ready = performance.getEntriesByName(resultReadyMark).at(-1)?.startTime;
  if (start === undefined || ready === undefined) return;
  console.info("explain_presentation_timing", {
    result_to_paint_ms: Math.round(performance.now() - ready),
    click_to_paint_ms: Math.round(performance.now() - start),
  });
  clearExplainPresentationTiming();
}
