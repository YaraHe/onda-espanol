export type ListeningScope = "learned" | "all" | "custom";
export type CurrentListeningScope = Exclude<ListeningScope, "learned">;

export function normalizeListeningScope(value: unknown): CurrentListeningScope {
  if (value === "custom") return "custom";
  // Stage 3's `learned` value and unknown legacy values use today's safe default.
  return "all";
}
