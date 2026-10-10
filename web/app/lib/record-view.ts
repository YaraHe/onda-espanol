import { latestUniqueSentenceRecords } from "./sentence-identity.mjs";

export type RecordListItem = {
  id: string;
  sentence: string;
  overall: number | null;
  created_at: string | null;
};

export type RecordDateGroup<T extends RecordListItem> = { date: string; records: T[] };

export function groupLatestRecordsByDate<T extends RecordListItem>(records: T[]): RecordDateGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const record of latestUniqueSentenceRecords(records)) {
    const parsed = record.created_at ? new Date(record.created_at) : null;
    const date = parsed && !Number.isNaN(parsed.getTime())
      ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(parsed)
      : "时间未知";
    const group = groups.get(date) ?? [];
    group.push(record);
    groups.set(date, group);
  }
  return [...groups].map(([date, groupRecords]) => ({ date, records: groupRecords }));
}
