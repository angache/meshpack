import { parseDentalPlan } from "./dentalChart.js";
import { parseAnnotations } from "./annotations.js";
import { caseStatusMeta } from "./cases.js";

/** Vakada kaydedilmiş plan içeriği var mı */
export function hasPlanningContent(caseRow) {
  if (!caseRow) return false;
  const notes = (caseRow.lab_notes || "").trim();
  const shade = (caseRow.tooth_shade || "").trim();
  const plan = parseDentalPlan(caseRow.dental_plan || "{}");
  const teeth = Object.keys(plan.teeth || {}).length;
  const annotations = parseAnnotations(caseRow.annotations || "{}");
  const markers = annotations?.markers?.length || 0;
  return notes.length > 0 || shade.length > 0 || teeth > 0 || markers > 0;
}

/** Durum pill metni — içerik varsa “Planlandı” */
export function displayCaseStatus(caseRow) {
  const base = caseStatusMeta(caseRow?.status);
  if (caseRow?.status === "sent") return base;
  if (hasPlanningContent(caseRow) && (caseRow.status === "planning" || caseRow.status === "linked")) {
    return { label: "Planlandı", cls: "case-status-planned" };
  }
  return base;
}

/** Planlama sayfası giriş butonu */
export function planningActionLabel(caseRow) {
  if (!caseRow) return "Planla";
  if (caseRow.status === "sent") return "Görüntüle";
  if (
    caseRow.status === "ready_to_send" ||
    caseRow.status === "planning" ||
    hasPlanningContent(caseRow)
  ) {
    return "Düzenle";
  }
  return "Planla";
}

export function isPlanningReadOnly(caseRow) {
  return caseRow?.status === "sent";
}
