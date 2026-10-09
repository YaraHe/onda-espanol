import type { PracticeRecordSummary } from "./practice-records";
import type { LibrarySentence } from "./sentence-library";
import { sentenceIdentity } from "./sentence-identity.mjs";

export type ListeningSentence = {
  key: string;
  sentence: string;
  translation: string | null;
  learned: boolean;
};

export type ListeningScope = "learned" | "all" | "custom";

export function makeListeningPool(library: LibrarySentence[], records: PracticeRecordSummary[]): ListeningSentence[] {
  const pool = new Map<string, ListeningSentence>();
  for (const item of library) {
    const identity = sentenceIdentity(item.sentence);
    if (!identity || pool.has(identity)) continue;
    pool.set(identity, { key: `library:${item.id}`, sentence: item.sentence, translation: item.translation, learned: false });
  }

  // listAllPracticeRecords returns newest first. The oldest attempt ID is a stable
  // reference for a practiced-only sentence when later attempts are added.
  for (const record of records) {
    const identity = sentenceIdentity(record.sentence);
    if (!identity) continue;
    const previous = pool.get(identity);
    if (previous) {
      previous.learned = true;
      if (previous.key.startsWith("practice:")) previous.key = `practice:${record.id}`;
    } else {
      pool.set(identity, {
        key: `practice:${record.id}`,
        sentence: record.sentence.trim(),
        translation: record.translation?.trim() || null,
        learned: true,
      });
    }
  }
  return [...pool.values()];
}

export function validCustomSelection(selection: string[], pool: ListeningSentence[]): string[] {
  const available = new Set(pool.map((item) => item.key));
  return [...new Set(selection)].filter((key) => available.has(key));
}

export function makeListeningPlaylist(pool: ListeningSentence[], scope: ListeningScope, selection: string[]): ListeningSentence[] {
  if (scope === "learned") return pool.filter((item) => item.learned);
  if (scope === "custom") {
    const selected = new Set(validCustomSelection(selection, pool));
    return pool.filter((item) => selected.has(item.key));
  }
  return pool;
}

export function nextListeningIndex(index: number, playlistLength: number): number {
  return playlistLength ? (index + 1) % playlistLength : 0;
}
