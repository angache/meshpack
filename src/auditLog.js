import { invoke } from "@tauri-apps/api/core";

export const AUDIT_ACTION_LABELS = {
  link: "Ölçü bağlandı",
  reassign: "Yeniden atandı",
  detach: "Ölçü kaldırıldı",
  case_create: "Vaka oluşturuldu",
  reject_suggestion: "Öneri reddedildi",
  dismiss_group: "Grup listeden kaldırıldı",
  restore_group: "Gizlenen grup geri alındı",
  case_delete: "Vaka kaldırıldı",
};

export async function listAuditLog(limit = 100, patientId = null) {
  return invoke("list_audit_log", { limit, patientId });
}

export function auditActionLabel(action) {
  return AUDIT_ACTION_LABELS[action] || action;
}
