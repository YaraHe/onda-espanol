import { getSupabaseClient } from "./supabase";

export type SpanishDialect = "es-ES" | "es-MX";
export const defaultDialect: SpanishDialect = "es-ES";

export function isSpanishDialect(value: unknown): value is SpanishDialect {
  return value === "es-ES" || value === "es-MX";
}

export async function readUserDialect(userId: string): Promise<SpanishDialect> {
  const { data, error } = await getSupabaseClient().from("user_settings")
    .select("lang")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("方言设置加载失败，请重试");
  if (!data) return defaultDialect;
  if (!isSpanishDialect(data.lang)) throw new Error("方言设置无效，请稍后重试");
  return data.lang;
}

export async function saveUserDialect(userId: string, lang: SpanishDialect): Promise<void> {
  const { error } = await getSupabaseClient().from("user_settings")
    .upsert({ user_id: userId, lang, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error("方言设置保存失败，请检查网络后重试");
}
