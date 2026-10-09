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

export type PracticeFocus = {
  feedback: string;
  goal: string | null;
  word: string | null;
  reliable: boolean;
};

export type PracticeSignals = {
  overall?: unknown;
  accuracy?: unknown;
  fluency?: unknown;
  completeness?: unknown;
  speakingRate?: unknown;
};

function validScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function scoreValue(value: unknown): number | null {
  return validScore(value) ? value : null;
}

/** Returns only feedback that can be tied to an unambiguous source word. */
export function practiceFocus(sentence: string, rawFeedback: unknown,
  signals: PracticeSignals = {}): PracticeFocus {
  const words = Array.isArray(rawFeedback) ? rawFeedback.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (typeof item.word !== "string" || !item.word.trim()
      || typeof item.accuracy !== "number" || !Number.isFinite(item.accuracy) || item.accuracy < 0 || item.accuracy > 100
      || typeof item.errorType !== "string" || typeof item.feedback !== "string") return [];
    return [{ word: item.word, accuracy: item.accuracy, errorType: item.errorType, feedback: item.feedback }];
  }) : [];
  const aligned = alignAssessmentWords(sentence, words);
  const reliable = aligned.words.flatMap((word) => word.assessment ? [{
    word: word.text,
    accuracy: word.assessment.accuracy,
    errorType: word.assessment.errorType,
    feedback: word.assessment.feedback.trim().slice(0, 180),
  }] : []);
  const weak = reliable.filter((word) => word.accuracy < 80 || word.errorType !== "None")
    .sort((a, b) => a.accuracy - b.accuracy)[0];
  if (weak) return {
    feedback: `「${weak.word}」${weak.accuracy}分：${weak.feedback || "需要再练习"}`,
    goal: `多听示范，再练「${weak.word}」`,
    word: weak.word,
    reliable: true,
  };

  const completeness = scoreValue(signals.completeness);
  if (completeness !== null && completeness < 85) return {
    feedback: `完整度 ${Math.round(completeness)}分：这次练习可能有词未读出。`,
    goal: "对照原句，把整句读完整",
    word: null,
    reliable: true,
  };

  const accuracy = scoreValue(signals.accuracy);
  if (accuracy !== null && accuracy < 80) return {
    feedback: `准确度 ${Math.round(accuracy)}分：目前没有可靠的词级位置可指出。`,
    goal: "跟随整句示范，练习让整句发音更准确",
    word: null,
    reliable: true,
  };

  const fluency = scoreValue(signals.fluency);
  if (fluency !== null && fluency < 80) return {
    feedback: `流利度 ${Math.round(fluency)}分：可以从整句节奏继续练习。`,
    goal: "跟随整句示范，练习读得自然连贯",
    word: null,
    reliable: true,
  };

  const speakingRate = typeof signals.speakingRate === "object" && signals.speakingRate !== null
    ? (signals.speakingRate as { verdict?: unknown; wpm?: unknown }).verdict
      ?? (signals.speakingRate as { wpm?: unknown }).wpm
    : signals.speakingRate;
  const rateVerdict = speakingRate === "偏慢" || (typeof speakingRate === "number" && Number.isFinite(speakingRate) && speakingRate < 150)
    ? "slow"
    : speakingRate === "偏快" || (typeof speakingRate === "number" && Number.isFinite(speakingRate) && speakingRate > 180)
      ? "fast" : null;
  if (rateVerdict === "slow") return {
    feedback: "语速偏慢：参考范围约为每分钟 150–180 词，仅作节奏参考。",
    goal: "跟随整句示范，练习自然连贯的节奏",
    word: null,
    reliable: true,
  };
  if (rateVerdict === "fast") return {
    feedback: "语速偏快：参考范围约为每分钟 150–180 词，仅作节奏参考。",
    goal: "稍放慢语速，读清整句中的每个词",
    word: null,
    reliable: true,
  };

  const overall = scoreValue(signals.overall);
  const hasUsableWordFeedback = reliable.length > 0;
  const hasUsableDimensions = accuracy !== null || fluency !== null || completeness !== null;
  if (overall === 100) return {
    feedback: "总分 100；本次评分没有识别出需要单独指出的薄弱项。",
    goal: null,
    word: null,
    reliable: hasUsableWordFeedback || hasUsableDimensions,
  };
  return {
    feedback: hasUsableWordFeedback || hasUsableDimensions
      ? "本次评分没有定位到明确的薄弱项。"
      : "这条记录缺少可可靠定位薄弱项的反馈数据。",
    goal: hasUsableWordFeedback || hasUsableDimensions
      ? null
      : "目前无法定位具体薄弱点，可先对照整句示范练习",
    word: null,
    reliable: hasUsableWordFeedback || hasUsableDimensions,
  };
}

export type PracticeHistoryFeedbackInput = {
  raw_feedback: unknown;
  overall: unknown;
  accuracy: unknown;
  fluency: unknown;
  completeness: unknown;
  speaking_rate: unknown;
};

/** Selects the newest attempt with usable feedback; if none qualify, keeps the newest attempt for honest degradation. */
export function recentPracticeFeedback<T extends PracticeHistoryFeedbackInput>(sentence: string, history: T[]) {
  if (!history.length) return null;
  const toFocus = (attempt: T) => practiceFocus(sentence, attempt.raw_feedback, {
    overall: attempt.overall,
    accuracy: attempt.accuracy,
    fluency: attempt.fluency,
    completeness: attempt.completeness,
    speakingRate: attempt.speaking_rate,
  });
  const reliableAttempt = history.find((attempt) => toFocus(attempt).reliable);
  const attempt = reliableAttempt ?? history[0];
  return { attempt, focus: toFocus(attempt), reliable: reliableAttempt !== undefined };
}

export type ScorePoint = { id: string; created_at: string | null; overall: number | null };

/** Keeps the five newest valid overall scores, returned oldest-to-newest for plotting. */
export function recentScorePoints(history: ScorePoint[]): (ScorePoint & { score: number })[] {
  return history.filter((item): item is ScorePoint & { overall: number } =>
    typeof item.overall === "number" && Number.isFinite(item.overall) && item.overall >= 0 && item.overall <= 100)
    .filter((item) => item.created_at === null || Number.isFinite(Date.parse(item.created_at)))
    .slice(0, 5)
    .map((item) => ({ ...item, score: item.overall }))
    .reverse();
}
