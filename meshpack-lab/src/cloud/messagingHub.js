import { getSupabase } from "./supabaseClient.js";
import { getActiveOrganization } from "./auth.js";
import { listNotifications } from "./notifications.js";

export const CLOUD_CASE_STATUS_LABELS = {
  sent: "Gönderildi",
  received: "Alındı",
  in_production: "Üretimde",
  quality_check: "Kalite kontrol",
  shipped: "Kargoda",
  completed: "Tamamlandı",
  cancelled: "İptal",
};

export async function getUnreadCountsByCase() {
  const notifications = await listNotifications({ unreadOnly: true, limit: 200 });
  const counts = new Map();
  for (const n of notifications) {
    if (!n.case_id) continue;
    counts.set(n.case_id, (counts.get(n.case_id) || 0) + 1);
  }
  return counts;
}

export async function listMessageThreads() {
  const supabase = getSupabase();
  const org = await getActiveOrganization();
  if (!supabase || !org) return { threads: [], orgId: null, orgType: null };

  let caseQuery = supabase
    .from("cloud_cases")
    .select("id, case_number, patient_display_name, status, sent_at, updated_at, clinic_org_id, lab_org_id")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (org.org_type === "clinic") {
    caseQuery = caseQuery.eq("clinic_org_id", org.id);
  } else {
    caseQuery = caseQuery.eq("lab_org_id", org.id);
  }

  const { data: cases, error: caseErr } = await caseQuery;
  if (caseErr) throw caseErr;

  const { data: messages, error: msgErr } = await supabase
    .from("case_messages")
    .select("id, case_id, body, created_at, author_org_id")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (msgErr) throw msgErr;

  const lastByCase = new Map();
  for (const m of messages || []) {
    if (!lastByCase.has(m.case_id)) lastByCase.set(m.case_id, m);
  }

  const caseIdsWithMessages = new Set([...lastByCase.keys()]);
  const unreadMap = await getUnreadCountsByCase();

  const filteredCases = (cases || []).filter((c) => {
    if (caseIdsWithMessages.has(c.id)) return true;
    if (org.org_type === "lab") return true;
    return (
      c.lab_org_id &&
      ["sent", "received", "in_production", "quality_check", "shipped", "completed"].includes(c.status)
    );
  });

  const threads = filteredCases
    .map((c) => ({
      caseId: c.id,
      caseNumber: c.case_number,
      patientName: c.patient_display_name,
      status: c.status,
      lastMessage: lastByCase.get(c.id) || null,
      updatedAt: lastByCase.get(c.id)?.created_at || c.updated_at || c.sent_at,
      unreadCount: unreadMap.get(c.id) || 0,
    }))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  return { threads, orgId: org.id, orgType: org.org_type };
}
