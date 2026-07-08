import { getSupabase } from "./supabaseClient.js";
import { getActiveOrganization, getSession } from "./auth.js";

export const MESSAGE_PAGE_SIZE = 50;

/**
 * Bir vakanın mesajlarını sayfalı getirir. Varsayılan olarak en yeni
 * MESSAGE_PAGE_SIZE mesajı döner; `before` verilirse ondan eskileri getirir.
 * Dönen `messages` her zaman kronolojik (eski → yeni) sıradadır.
 */
export async function listCaseMessages(caseId, { limit = MESSAGE_PAGE_SIZE, before = null } = {}) {
  const supabase = getSupabase();
  if (!supabase || !caseId) return { messages: [], hasMore: false };

  let query = supabase
    .from("case_messages")
    .select("id, case_id, author_user_id, author_org_id, body, created_at")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (before) query = query.lt("created_at", before);

  const { data, error } = await query;
  if (error) throw error;

  const rows = data || [];
  const hasMore = rows.length >= limit;
  return { messages: rows.reverse(), hasMore };
}

export async function sendCaseMessage(caseId, body) {
  const supabase = getSupabase();
  const session = await getSession();
  const org = await getActiveOrganization();
  if (!supabase || !session || !org) throw new Error("Oturum veya organizasyon eksik");

  const text = body.trim();
  if (!text) throw new Error("Mesaj boş olamaz");

  const { data, error } = await supabase
    .from("case_messages")
    .insert({
      case_id: caseId,
      author_user_id: session.user.id,
      author_org_id: org.id,
      body: text,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export function subscribeCaseMessages(caseId, onMessage) {
  const supabase = getSupabase();
  if (!supabase) return () => {};

  const channel = supabase
    .channel(`case-messages:${caseId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "case_messages", filter: `case_id=eq.${caseId}` },
      (payload) => onMessage?.(payload.new)
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
