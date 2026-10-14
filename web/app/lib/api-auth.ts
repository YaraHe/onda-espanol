import { getSupabaseClient } from "./supabase";

export class ApiAuthenticationError extends Error {}

export async function apiSession(): Promise<{ Authorization: string; userId: string }> {
  try {
    const { data, error } = await getSupabaseClient().auth.getSession();
    const session = data.session;
    if (error || !session?.access_token || !session.user.id) throw new ApiAuthenticationError("登录状态已失效，请重新登录后重试");
    return { Authorization: `Bearer ${session.access_token}`, userId: session.user.id };
  } catch (cause) {
    if (cause instanceof ApiAuthenticationError) throw cause;
    throw new ApiAuthenticationError("登录状态暂时无法确认，请稍后重试");
  }
}

export async function apiAuthorizationHeader(): Promise<{ Authorization: string }> {
  const { Authorization } = await apiSession();
  return { Authorization };
}
