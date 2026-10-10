import { getSupabaseClient } from "./supabase";
import { collectPersonalSentencePages } from "./personal-sentence-pages.mjs";
import { sentenceIdentity } from "./sentence-identity.mjs";

export type PersonalSentence = {
  id: string;
  sentence: string;
  translation: string | null;
  identity_key: string;
  created_at: string;
};

export type PersonalSentenceDraft = {
  sentence: string;
  translation?: string | null;
};

async function currentUserId(): Promise<string> {
  const { data: { user }, error } = await getSupabaseClient().auth.getUser();
  if (error || !user) throw new Error("登录状态已失效，请重新登录后重试");
  return user.id;
}

/** Add a sentence once per user while preserving its original display form. */
export async function savePersonalSentence(draft: PersonalSentenceDraft, expectedUserId?: string): Promise<PersonalSentence> {
  const sentence = draft.sentence.trim();
  const identityKey = sentenceIdentity(sentence);
  if (!identityKey) throw new Error("句子不能为空");

  const client = getSupabaseClient();
  const userId = await currentUserId();
  if (expectedUserId && userId !== expectedUserId) throw new Error("登录账号已变化，请在当前账号重新查询");
  const translation = draft.translation?.trim() || null;
  const { data: existing, error: lookupError } = await client.from("personal_sentences")
    .select("id,sentence,translation,identity_key,created_at")
    .eq("user_id", userId)
    .eq("identity_key", identityKey)
    .maybeSingle();
  if (lookupError) throw new Error("个人句子保存失败，请重试");
  if (existing) {
    if (!existing.translation && translation) {
      const { data: updated, error } = await client.from("personal_sentences")
        .update({ translation })
        .eq("user_id", userId)
        .eq("id", existing.id)
        .is("translation", null)
        .select("id,sentence,translation,identity_key,created_at")
        .maybeSingle();
      if (error) throw new Error("个人句子保存失败，请重试");
      if (updated) return updated as PersonalSentence;
      const { data: latest, error: latestError } = await client.from("personal_sentences")
        .select("id,sentence,translation,identity_key,created_at")
        .eq("user_id", userId)
        .eq("id", existing.id)
        .single();
      if (latestError) throw new Error("个人句子保存失败，请重试");
      return latest as PersonalSentence;
    }
    return existing as PersonalSentence;
  }

  const { data: inserted, error: insertError } = await client.from("personal_sentences")
    .insert({ user_id: userId, sentence, translation, identity_key: identityKey })
    .select("id,sentence,translation,identity_key,created_at")
    .single();
  if (!insertError) return inserted as PersonalSentence;

  // A parallel request may have inserted the same identity after our lookup.
  if (insertError.code === "23505") {
    const { data: raced, error } = await client.from("personal_sentences")
      .select("id,sentence,translation,identity_key,created_at")
      .eq("user_id", userId)
      .eq("identity_key", identityKey)
      .single();
    if (!error && raced) {
      if (!raced.translation && translation) {
        const { data: updated, error: updateError } = await client.from("personal_sentences")
          .update({ translation })
          .eq("user_id", userId)
          .eq("id", raced.id)
          .is("translation", null)
          .select("id,sentence,translation,identity_key,created_at")
          .maybeSingle();
        if (updateError) throw new Error("个人句子保存失败，请重试");
        if (updated) return updated as PersonalSentence;
        const { data: latest, error: latestError } = await client.from("personal_sentences")
          .select("id,sentence,translation,identity_key,created_at")
          .eq("user_id", userId)
          .eq("id", raced.id)
          .single();
        if (latestError) throw new Error("个人句子保存失败，请重试");
        return latest as PersonalSentence;
      }
      return raced as PersonalSentence;
    }
  }
  throw new Error("个人句子保存失败，请重试");
}

export async function listPersonalSentences(): Promise<PersonalSentence[]> {
  const client = getSupabaseClient();
  const userId = await currentUserId();
  const pageSize = 100;
  return collectPersonalSentencePages<PersonalSentence>((offset, size) => client.from("personal_sentences")
      .select("id,sentence,translation,identity_key,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + size - 1), pageSize);
}

export async function removePersonalSentence(id: string): Promise<void> {
  const client = getSupabaseClient();
  const userId = await currentUserId();
  const { error } = await client.from("personal_sentences")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw new Error("移出个人句子失败，请重试");
}
