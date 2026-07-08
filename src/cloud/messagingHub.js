import { getSupabase } from "./supabaseClient.js";
import { getActiveOrganization } from "./auth.js";

export const CLOUD_CASE_STATUS_LABELS = {
  sent: "Gönderildi",
  received: "Alındı",
  in_production: "Üretimde",
  quality_check: "Kalite kontrol",
  shipped: "Kargoda",
  completed: "Tamamlandı",
  cancelled: "İptal",
};

export const THREAD_PAGE_SIZE = 30;

function mapThreadRow(r) {
  return {
    caseId: r.case_id,
    caseNumber: r.case_number,
    patientName: r.patient_display_name,
    status: r.status,
    lastMessage: r.last_message_at
      ? {
          body: r.last_message_body,
          created_at: r.last_message_at,
          author_org_id: r.last_message_author_org_id,
        }
      : null,
    updatedAt: r.sort_at,
    unreadCount: Number(r.unread_count) || 0,
  };
}

/**
 * Konuşma listesini server-side (RPC) üretir. Sayfalama destekler.
 * Her vakanın son mesajı + kullanıcının okunmamış sayısı tek sorguda gelir.
 */
export async function listMessageThreads({ limit = THREAD_PAGE_SIZE, offset = 0 } = {}) {
  const supabase = getSupabase();
  const org = await getActiveOrganization();
  if (!supabase || !org) {
    return { threads: [], orgId: null, orgType: null, hasMore: false };
  }

  const { data, error } = await supabase.rpc("list_message_threads", {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;

  const threads = (data || []).map(mapThreadRow);
  return {
    threads,
    orgId: org.id,
    orgType: org.org_type,
    hasMore: threads.length >= limit,
  };
}
