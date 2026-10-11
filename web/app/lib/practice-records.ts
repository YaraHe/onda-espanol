import type { AssessmentResult } from "./assessment";
import { getSupabaseClient } from "./supabase";
import { matchingSentenceRecords } from "./sentence-identity.mjs";
import { collectRecentUniqueSentences } from "./recent-practice.mjs";
import { savePracticeRecordForOwner, PracticeRecordConflictError, PracticeRecordOwnerError, samePersistedPracticeRecord } from "./practice-recovery.mjs";

export type PracticeRecordDraft = {
  id: string;
  ownerUserId: string;
  sentence: string;
  translation: string;
  result: AssessmentResult;
};

export type PracticeRecordSummary = {
  id: string;
  sentence: string;
  translation: string | null;
  overall: number | null;
  created_at: string | null;
};

type RecentPracticeSentence = Pick<PracticeRecordSummary, "id" | "sentence">;

export type PracticeRecordAttempt = PracticeRecordSummary & {
  accuracy: number | null;
  fluency: number | null;
  completeness: number | null;
  speaking_rate: number | null;
  raw_feedback: unknown;
};

export type PracticeRecordDetail = {
  sentence: string;
  translation: string | null;
  history: PracticeRecordAttempt[];
};

export type PersistedPracticeRecord = {
  id: string;
  user_id: string;
  sentence: string;
  translation: string | null;
  overall: number | null;
  accuracy: number | null;
  fluency: number | null;
  completeness: number | null;
  speaking_rate: number | null;
  raw_feedback: unknown;
};

async function currentUserId(): Promise<string> {
  const { data: { user }, error } = await getSupabaseClient().auth.getUser();
  if (error || !user) throw new Error("登录状态已失效，请重新登录后重试");
  return user.id;
}

export async function savePracticeRecord(draft: PracticeRecordDraft, expectedUserId = draft.ownerUserId): Promise<void> {
  const client = getSupabaseClient();
  try {
    await savePracticeRecordForOwner({
      draft,
      expectedUserId,
      getCurrentUserId: currentUserId,
      find: (id: string, ownerUserId: string) => client.from("practice_records")
        .select("id,user_id,sentence,translation,overall,accuracy,fluency,completeness,speaking_rate,raw_feedback")
        .eq("user_id", ownerUserId)
        .eq("id", id)
        .maybeSingle(),
      insert: (candidate: PersistedPracticeRecord) => client.from("practice_records").insert(candidate),
    });
  } catch (error) {
    if (error instanceof PracticeRecordConflictError || error instanceof PracticeRecordOwnerError) throw error;
    throw new Error("保存失败，请检查网络后重试");
  }
}

export async function reconcilePracticeRecord(draft: PracticeRecordDraft, expectedUserId = draft.ownerUserId): Promise<"saved" | "missing"> {
  if (!expectedUserId || draft.ownerUserId !== expectedUserId) throw new PracticeRecordOwnerError();
  const client = getSupabaseClient();
  const userId = await currentUserId();
  if (userId !== expectedUserId) throw new PracticeRecordOwnerError();
  const { data, error } = await client.from("practice_records")
    .select("id,user_id,sentence,translation,overall,accuracy,fluency,completeness,speaking_rate,raw_feedback")
    .eq("user_id", userId)
    .eq("id", draft.id)
    .maybeSingle();
  if (error) throw new Error("保存状态暂时无法核对，请检查网络后重试");
  if (await currentUserId() !== expectedUserId) throw new PracticeRecordOwnerError();
  if (!data) return "missing";
  const candidate = {
    id: draft.id,
    user_id: userId,
    sentence: draft.sentence,
    translation: draft.translation,
    overall: draft.result.overall,
    accuracy: draft.result.accuracy,
    fluency: draft.result.fluency,
    completeness: draft.result.completeness,
    speaking_rate: draft.result.speakingRate.wpm,
    raw_feedback: draft.result.words,
  };
  if (!samePersistedPracticeRecord(data as PersistedPracticeRecord, candidate)) throw new PracticeRecordConflictError();
  return "saved";
}

export async function listRecentPracticeSentences(): Promise<string[]> {
  const client = getSupabaseClient();
  const userId = await currentUserId();
  const records = await collectRecentUniqueSentences(async (offset, pageSize) => {
    const { data, error } = await client.from("practice_records")
      .select("id,sentence,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error("练习记录加载失败，请重试");
    return (data ?? []) as RecentPracticeSentence[];
  });
  return records.map((record) => record.sentence);
}

export async function listAllPracticeRecords(): Promise<PracticeRecordSummary[]> {
  const client = getSupabaseClient();
  const userId = await currentUserId();
  const records: PracticeRecordSummary[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from("practice_records")
      .select("id,sentence,translation,overall,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error("练习记录加载失败，请重试");
    records.push(...(data ?? []) as PracticeRecordSummary[]);
    if (!data || data.length < pageSize) return records;
  }
}

export async function getPracticeRecordDetail(recordId: string): Promise<PracticeRecordDetail | null> {
  const client = getSupabaseClient();
  const userId = await currentUserId();
  const { data: selected, error: selectedError } = await client.from("practice_records")
    .select("id,sentence,translation,overall,created_at")
    .eq("user_id", userId)
    .eq("id", recordId)
    .maybeSingle();
  if (selectedError) throw new Error("记录详情加载失败，请重试");
  if (!selected) return null;

  const history: PracticeRecordAttempt[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from("practice_records")
      .select("id,sentence,translation,overall,accuracy,fluency,completeness,speaking_rate,raw_feedback,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error("练习历史加载失败，请重试");
    history.push(...matchingSentenceRecords((data ?? []) as PracticeRecordAttempt[], selected.sentence));
    if (!data || data.length < pageSize) break;
  }
  return {
    sentence: selected.sentence,
    translation: history.find((attempt) => attempt.translation?.trim())?.translation ?? null,
    history,
  };
}

export async function clearPracticeRecords(): Promise<number> {
  const client = getSupabaseClient();
  const userId = await currentUserId();
  const { count, error } = await client.from("practice_records")
    .delete({ count: "exact" })
    .eq("user_id", userId);
  if (error) throw new Error("清除练习记录失败，请检查网络后重试");
  return count ?? 0;
}
