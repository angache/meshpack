import { buildCaseSummary } from "./caseSummary.js";
import { parseDentalPlan } from "./dentalChart.js";
import { parseAnnotations } from "./annotations.js";
import { buildTreatmentCatalog } from "./config/dentalTreatments.js";
import { patientListLabel } from "./patients.js";

export const CASE_PACKAGE_VERSION = 1;
export const MESHPACK_APP_VERSION = "0.1.0";

const SCAN_TYPES = ["upper", "lower", "bite"];

/**
 * MeshPack-Lab / dış sistemler için yapılandırılmış vaka manifest'i.
 * @see docs/CASE_PACKAGE.md
 */
export function buildCasePackageManifest({
  caseRow,
  patient,
  scanSession,
  labNotes = "",
  toothShade = "",
  dentalPlanRaw = "{}",
  annotationsRaw = "{}",
  treatments,
  summaryText = "",
  source = "meshpack-clinic",
}) {
  const summary =
    summaryText ||
    buildCaseSummary({
      caseRow,
      patient,
      scanSession,
      labNotes,
      toothShade,
      dentalPlanRaw,
      annotationsRaw,
      treatments,
    });

  const catalog = buildTreatmentCatalog(treatments);
  const scans = SCAN_TYPES.map((type) => {
    const file = scanSession?.scans?.[type];
    if (!file) return null;
    return {
      type,
      filename: file.filename,
      zipEntry: file.filename,
      sizeBytes: file.size_bytes ?? 0,
      fileStem: file.fileStem || "",
    };
  }).filter(Boolean);

  return {
    casePackageVersion: CASE_PACKAGE_VERSION,
    meshpackVersion: MESHPACK_APP_VERSION,
    exportedAt: new Date().toISOString(),
    source,
    case: {
      id: caseRow?.id || "",
      caseNumber: caseRow?.case_number || "",
      status: caseRow?.status || "linked",
      sessionDay: caseRow?.session_day || "",
      sentAt: caseRow?.sent_at ?? null,
      labNotes: String(labNotes || "").trim(),
      toothShade: String(toothShade || "").trim(),
      dentalPlan: parseDentalPlan(dentalPlanRaw),
      annotations: parseAnnotations(annotationsRaw),
    },
    patient: patient
      ? {
          id: patient.id,
          surname: patient.surname || "",
          firstName: patient.first_name || "",
          displayName: patientListLabel(patient),
        }
      : null,
    scans,
    treatments: catalog.map((t) => ({
      id: t.id,
      label: t.label,
      abbr: t.abbr,
      color: t.color,
    })),
    summaryText: summary,
  };
}

export function serializeCasePackageManifest(manifest) {
  return JSON.stringify(manifest, null, 2);
}
