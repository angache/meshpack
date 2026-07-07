import { invoke } from "@tauri-apps/api/core";

export const LOG_CATEGORY_LABELS = {
  all: "Tümü",
  auth: "Oturum",
  scan: "Ölçü",
  patient: "Hasta",
  case: "Vaka",
  send: "Gönderim",
  user: "Kullanıcı",
  system: "Sistem",
};

export function logCategoryLabel(category) {
  return LOG_CATEGORY_LABELS[category] || category;
}

export async function listActivityLog(limit = 150, category = null) {
  return invoke("list_activity_log", { limit, category });
}

export async function logActivity({
  category,
  action,
  summary,
  details = null,
  patientId = null,
  caseId = null,
}) {
  return invoke("log_activity", {
    category,
    action,
    summary,
    details,
    patientId,
    caseId,
  });
}
