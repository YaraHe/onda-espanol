import { getSupabaseClient } from "./supabase";
import { normalizeListeningScope, type ListeningScope } from "./listening-scope";

export type ListeningPreferences = {
  scope: ListeningScope;
  rate: number;
  intervalSeconds: 1 | 2 | 4;
  showText: boolean;
  showTranslation: boolean;
  customSelection: string[];
};

export const defaultListeningPreferences: ListeningPreferences = {
  scope: "all",
  rate: 1,
  intervalSeconds: 2,
  showText: true,
  showTranslation: false,
  customSelection: [],
};

function fromRow(row: Record<string, unknown>): ListeningPreferences {
  const scope = normalizeListeningScope(row.listening_scope);
  const rate = row.listening_rate;
  const interval = row.listening_interval_seconds;
  const showText = row.listening_show_text;
  const showTranslation = row.listening_show_translation;
  const customSelection = row.listening_custom_selection;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0.6 || rate > 1.2
    || (interval !== 1 && interval !== 2 && interval !== 4)
    || typeof showText !== "boolean" || typeof showTranslation !== "boolean"
    || !Array.isArray(customSelection) || !customSelection.every((value) => typeof value === "string")) {
    throw new Error("磨耳朵设置无效，请稍后重试");
  }
  return { scope, rate, intervalSeconds: interval, showText, showTranslation, customSelection };
}

const columns = "listening_scope,listening_rate,listening_interval_seconds,listening_show_text,listening_show_translation,listening_custom_selection";

export async function readListeningPreferences(userId: string): Promise<ListeningPreferences> {
  const { data, error } = await getSupabaseClient().from("user_settings")
    .select(columns).eq("user_id", userId).maybeSingle();
  if (error) throw new Error("磨耳朵设置加载失败，请重试");
  return data ? fromRow(data as Record<string, unknown>) : { ...defaultListeningPreferences, customSelection: [] };
}

export async function saveListeningPreferences(userId: string, preferences: ListeningPreferences): Promise<void> {
  const client = getSupabaseClient();
  const values = {
    listening_scope: preferences.scope,
    listening_rate: preferences.rate,
    listening_interval_seconds: preferences.intervalSeconds,
    listening_show_text: preferences.showText,
    listening_show_translation: preferences.showTranslation,
    listening_custom_selection: preferences.customSelection,
    updated_at: new Date().toISOString(),
  };
  const update = async () => client.from("user_settings").update(values).eq("user_id", userId).select("user_id");
  const { data, error } = await update();
  if (error) throw new Error("磨耳朵设置保存失败，请检查网络后重试");
  if (data?.length) return;

  const { error: insertError } = await client.from("user_settings").insert({ user_id: userId, ...values });
  if (!insertError) return;
  if (insertError.code === "23505") {
    const retry = await update();
    if (!retry.error && retry.data?.length) return;
  }
  throw new Error("磨耳朵设置保存失败，请检查网络后重试");
}
