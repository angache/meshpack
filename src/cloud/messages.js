import { getSupabase } from "./supabaseClient.js";
import { getActiveOrganization, getSession } from "./auth.js";

export async function listCaseMessages(caseId) {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("case_messages")
    .select("id, case_id, author_user_id, author_org_id, body, created_at")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
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
