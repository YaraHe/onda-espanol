import type { AssessmentResult } from "./assessment";
import { getSupabaseClient } from "./supabase";

export type PracticeRecordDraft = {
  id: string;
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

export async function savePracticeRecord(draft: PracticeRecordDraft): Promise<void> {
  const client = getSupabaseClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) throw new Error("登录状态已失效，请重新登录后重试保存");

  const { error } = await client.from("practice_records").upsert({
    id: draft.id,
    user_id: user.id,
    sentence: draft.sentence,
    translation: draft.translation,
    overall: draft.result.overall,
    accuracy: draft.result.accuracy,
    fluency: draft.result.fluency,
    completeness: draft.result.completeness,
    speaking_rate: draft.result.speakingRate.wpm,
    raw_feedback: draft.result.words,
  }, { onConflict: "id" });
  if (error) throw new Error("保存失败，请检查网络后重试");
}

export async function listPracticeRecords(): Promise<PracticeRecordSummary[]> {
  const { data, error } = await getSupabaseClient().from("practice_records")
    .select("id,sentence,translation,overall,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("练习记录加载失败，请重试");
  return (data ?? []) as PracticeRecordSummary[];
}

export function recentSentences(records: PracticeRecordSummary[]): string[] {
  return [...new Set(records.map((record) => record.sentence))].slice(0, 5);
}
