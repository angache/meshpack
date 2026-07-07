import { getActiveOrganization } from "./auth.js";
import { getSupabase } from "./supabaseClient.js";

export async function listMyLabLinks() {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase.rpc("list_my_lab_links");
  if (error) throw error;
  return data || [];
}

export async function searchLabs(query = "") {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase.rpc("search_meshpack_labs", { p_query: query.trim() });
  if (error) throw error;
  return data || [];
}

export async function searchClinics(query = "") {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase.rpc("search_meshpack_clinics", { p_query: query.trim() });
  if (error) throw error;
  return data || [];
}

export async function requestLabLink(labOrgId, note = "") {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Cloud yapılandırılmamış");

  const { data, error } = await supabase.rpc("request_lab_link", {
    p_lab_org_id: labOrgId,
    p_note: note.trim(),
  });
  if (error) throw error;
  return data;
}

export async function requestClinicLink(clinicPairingCode, note = "") {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Cloud yapılandırılmamış");

  const { data, error } = await supabase.rpc("request_clinic_link", {
    p_clinic_pairing_code: clinicPairingCode.trim(),
    p_note: note.trim(),
  });
  if (error) throw error;
  return data;
}

export async function requestClinicLinkById(clinicOrgId, note = "") {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Cloud yapılandırılmamış");

  const { data, error } = await supabase.rpc("request_clinic_link_by_id", {
    p_clinic_org_id: clinicOrgId,
    p_note: note.trim(),
  });
  if (error) throw error;
  return data;
}

export async function respondLabLink(linkId, accept) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Cloud yapılandırılmamış");

  const { data, error } = await supabase.rpc("respond_lab_link", {
    p_link_id: linkId,
    p_accept: accept,
  });
  if (error) throw error;
  return data;
}

export async function revokeLabLink(linkId) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Cloud yapılandırılmamış");

  const { data, error } = await supabase.rpc("revoke_lab_link", { p_link_id: linkId });
  if (error) throw error;
  return data;
}

/** Gelen bekleyen istekler (karşı tarafın gönderdiği) */
export async function listIncomingLinkRequests() {
  const org = await getActiveOrganization();
  if (!org) return [];

  const links = await listMyLabLinks();
  return links.filter((l) => l.status === "pending" && l.requested_by_org_id !== org.id);
}

/** Giden bekleyen istekler */
export async function listOutgoingLinkRequests() {
  const org = await getActiveOrganization();
  if (!org) return [];

  const links = await listMyLabLinks();
  return links.filter((l) => l.status === "pending" && l.requested_by_org_id === org.id);
}

/** Aktif bağlı lab/klinikler */
export async function listActiveLabLinks() {
  const links = await listMyLabLinks();
  return links.filter((l) => l.status === "active");
}

export function linkPartnerName(link, orgType) {
  if (orgType === "clinic") return link.lab_name;
  return link.clinic_name;
}

export const LINK_STATUS_LABELS = {
  active: "Bağlı",
  pending: "Bekliyor",
  revoked: "Kesildi",
};
