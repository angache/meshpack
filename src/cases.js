import { invoke } from "@tauri-apps/api/core";

export const CASE_STATUS = {
  linked: { label: "Bağlandı", cls: "case-status-linked" },
  planning: { label: "Planlanıyor", cls: "case-status-planning" },
  ready_to_send: { label: "Gönderime hazır", cls: "case-status-ready" },
  sent: { label: "Gönderildi", cls: "case-status-sent" },
};

export async function getCase(caseId) {
  return invoke("get_case", { caseId });
}

export async function updateCasePlanning(caseId, labNotes, toothShade, dentalPlan, annotations) {
  return invoke("update_case_planning", {
    caseId,
    labNotes,
    toothShade: toothShade ?? "",
    dentalPlan: typeof dentalPlan === "string" ? dentalPlan : JSON.stringify(dentalPlan),
    annotations:
      typeof annotations === "string" ? annotations : JSON.stringify(annotations ?? { version: 1, markers: [] }),
  });
}

export async function updateCaseLabNotes(caseId, labNotes) {
  return invoke("update_case_lab_notes", { caseId, labNotes });
}

export async function beginCasePlanning(caseId) {
  return invoke("begin_case_planning", { caseId });
}

export async function updateCaseStatus(caseId, status) {
  return invoke("update_case_status", { caseId, status });
}

export async function createCase(patientId, sessionDay) {
  return invoke("create_case", { patientId, sessionDay });
}

export async function findCaseForDay(patientId, sessionDay) {
  return invoke("find_case_for_day", { patientId, sessionDay });
}

export async function listSentCases(limit = 50) {
  return invoke("list_sent_cases", { limit });
}

export async function listPatientCases(patientId) {
  return invoke("list_patient_cases", { patientId });
}

export async function listCaseScans(caseId) {
  return invoke("list_case_scans", { caseId });
}

export async function linkScansToCase(patientId, caseId, files) {
  return invoke("link_scans_to_case", {
    patientId,
    caseId,
    files: files.map((f) => ({
      path: f.path,
      filename: f.filename,
      file_stem: f.fileStem,
      scan_type: f.scanType,
      modified_at: f.modified_at,
    })),
  });
}

export async function detachScan(filePath, reason) {
  return invoke("detach_scan", { filePath, reason });
}

export async function reassignScan(filePath, toPatientId, toCaseId, reason) {
  return invoke("reassign_scan", {
    filePath,
    toPatientId,
    toCaseId,
    reason,
  });
}

export function caseStatusMeta(status) {
  return CASE_STATUS[status] || { label: status, cls: "case-status-linked" };
}
