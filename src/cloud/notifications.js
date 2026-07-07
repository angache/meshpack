import { getSupabase } from "./supabaseClient.js";
import { getSession } from "./auth.js";

export async function listUnreadNotifications(limit = 20) {
  return listNotifications({ unreadOnly: true, limit });
}

export async function listNotifications({ limit = 50, unreadOnly = false } = {}) {
  const supabase = getSupabase();
  const session = await getSession();
  if (!supabase || !session) return [];

  let query = supabase
    .from("notifications")
    .select("id, type, title, body, case_id, read_at, created_at")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unreadOnly) query = query.is("read_at", null);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function countUnreadNotifications() {
  const supabase = getSupabase();
  const session = await getSession();
  if (!supabase || !session) return 0;

  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", session.user.id)
    .is("read_at", null);

  if (error) throw error;
  return count || 0;
}

export async function markNotificationsReadForCase(caseId) {
  const supabase = getSupabase();
  const session = await getSession();
  if (!supabase || !session || !caseId) return;

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", session.user.id)
    .eq("case_id", caseId)
    .is("read_at", null);

  if (error) throw error;
}

export async function markAllNotificationsRead() {
  const supabase = getSupabase();
  const session = await getSession();
  if (!supabase || !session) return;

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", session.user.id)
    .is("read_at", null);

  if (error) throw error;
}
export async function markNotificationRead(id) {
  const supabase = getSupabase();
  if (!supabase) return;

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw error;
}

export function subscribeNotifications(onNotification) {
  const supabase = getSupabase();
  if (!supabase) return () => {};

  let userId = null;
  getSession().then((s) => {
    userId = s?.user?.id;
  });

  const channel = supabase
    .channel("user-notifications")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications" },
      (payload) => {
        if (!userId || payload.new?.user_id === userId) {
          onNotification?.(payload.new);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
