import type { AssessmentResult } from "./assessment";

type AssessedWord = AssessmentResult["words"][number];

export type ReferenceWord = {
  text: string;
  start: number;
  end: number;
  assessment: AssessedWord | null;
  prefix: string;
  leading: string;
  trailing: string;
};

export type InsertedWord = {
  assessment: AssessedWord;
  beforeWordIndex: number | null;
};

export type AlignedAssessment = {
  words: ReferenceWord[];
  insertions: InsertedWord[];
  unalignedCount: number;
  suffix: string;
};

const WORD_PATTERN = /[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu;

function comparable(word: string): string {
  return word.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Aligns only identifiable Azure words to source spans. The caller renders the untouched gaps. */
export function alignAssessmentWords(sentence: string, assessed: AssessedWord[]): AlignedAssessment {
  const words: ReferenceWord[] = [...sentence.matchAll(WORD_PATTERN)].map((match) => ({
    text: match[0], start: match.index, end: match.index + match[0].length,
    assessment: null, prefix: "", leading: "", trailing: "",
  }));
  let cursor = 0;
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    const gap = sentence.slice(cursor, word.start);
    word.leading = gap.match(/[^\p{L}\p{M}\p{N}\s]+$/u)?.[0] ?? "";
    word.prefix = gap.slice(0, gap.length - word.leading.length);
    const following = sentence.slice(word.end, words[index + 1]?.start ?? sentence.length);
    word.trailing = following.match(/^[^\p{L}\p{M}\p{N}\s]+/u)?.[0] ?? "";
    cursor = word.end + word.trailing.length;
  }
  const suffix = sentence.slice(cursor);
  const sourceCounts = new Map<string, number>();
  const assessedCounts = new Map<string, number>();
  for (const word of words) {
    const key = comparable(word.text);
    sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
  }
  for (const word of assessed) {
    if (word.errorType === "Insertion") continue;
    const key = comparable(word.word);
    assessedCounts.set(key, (assessedCounts.get(key) ?? 0) + 1);
  }
  // If Azure omits one of several identical reference words without an Omission entry,
  // its score cannot safely be assigned to a particular occurrence.
  const ambiguous = new Set([...sourceCounts].filter(([key, count]) =>
    count > 1 && assessedCounts.get(key) !== count).map(([key]) => key));

  const n = words.length;
  const m = assessed.length;
  const cost = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
  const canMatch = (i: number, j: number) => assessed[j].errorType !== "Insertion"
    && comparable(words[i].text) === comparable(assessed[j].word)
    && !ambiguous.has(comparable(words[i].text));
  for (let i = n; i >= 0; i--) {
    for (let j = m; j >= 0; j--) {
      if (i === n && j === m) continue;
      const skipSource = i < n ? 1 + cost[i + 1][j] : Infinity;
      const skipAssessed = j < m ? (assessed[j].errorType === "Insertion" ? 0 : 1) + cost[i][j + 1] : Infinity;
      const match = i < n && j < m && canMatch(i, j) ? cost[i + 1][j + 1] : Infinity;
      cost[i][j] = Math.min(skipSource, skipAssessed, match);
    }
  }

  // An arbitrary optimal trace cannot establish where an insertion belongs when
  // multiple source boundaries fit equally well (for example, repeated words).
  const prefixCost = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(Infinity));
  prefixCost[0][0] = 0;
  for (let source = 0; source <= n; source++) {
    for (let assessedIndex = 0; assessedIndex <= m; assessedIndex++) {
      const current = prefixCost[source][assessedIndex];
      if (!Number.isFinite(current)) continue;
      if (source < n) prefixCost[source + 1][assessedIndex] = Math.min(prefixCost[source + 1][assessedIndex], current + 1);
      if (assessedIndex < m) prefixCost[source][assessedIndex + 1] = Math.min(prefixCost[source][assessedIndex + 1],
        current + (assessed[assessedIndex].errorType === "Insertion" ? 0 : 1));
      if (source < n && assessedIndex < m && canMatch(source, assessedIndex)) {
        prefixCost[source + 1][assessedIndex + 1] = Math.min(prefixCost[source + 1][assessedIndex + 1], current);
      }
    }
  }
  const insertionPositions = new Map<number, number | null>();
  for (let assessedIndex = 0; assessedIndex < m; assessedIndex++) {
    if (assessed[assessedIndex].errorType !== "Insertion") continue;
    const possible = Array.from({ length: n + 1 }, (_, source) => source).filter((source) =>
      prefixCost[source][assessedIndex] + cost[source][assessedIndex + 1] === cost[0][0]);
    insertionPositions.set(assessedIndex, possible.length === 1 ? possible[0] : null);
  }

  const insertions: InsertedWord[] = [];
  let unalignedCount = 0;
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && canMatch(i, j) && cost[i][j] === cost[i + 1][j + 1]) {
      words[i].assessment = assessed[j];
      i++;
      j++;
    } else if (j < m && cost[i][j] === (assessed[j].errorType === "Insertion" ? 0 : 1) + cost[i][j + 1]) {
      if (assessed[j].errorType === "Insertion") insertions.push({ assessment: assessed[j], beforeWordIndex: insertionPositions.get(j) ?? null });
      else unalignedCount++;
      j++;
    } else {
      i++;
    }
  }
  return { words, insertions, unalignedCount, suffix };
}
