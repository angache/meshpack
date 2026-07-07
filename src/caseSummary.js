import { parseDentalPlan } from "./dentalChart.js";
import { buildTreatmentCatalog, resolveTreatment } from "./config/dentalTreatments.js";
import { parseAnnotations } from "./annotations.js";
import { caseStatusMeta } from "./cases.js";
import { patientListLabel } from "./patients.js";
import { SCAN_LABELS, formatFileSize } from "./utils.js";
import { detectVitaScale, VITA_3D_MASTER } from "./config/vitaShades.js";

function formatSessionDay(day) {
  if (!day) return "—";
  const [y, m, d] = day.split("-");
  if (!d) return day;
  return `${d}.${m}.${y}`;
}

/**
 * Lab / e-posta / Drive not dosyası için düz metin özet.
 */
export function buildCaseSummary({
  caseRow,
  patient,
  scanSession,
  labNotes = "",
  toothShade = "",
  dentalPlanRaw = "{}",
  annotationsRaw = "{}",
  treatments,
}) {
  const lines = [];
  const status = caseStatusMeta(caseRow?.status);

  lines.push("MeshPack — İş Emri Özeti");
  lines.push("========================");
  lines.push(`Vaka No   : ${caseRow?.case_number || "—"}`);
  lines.push(`Hasta     : ${patient ? patientListLabel(patient) : "—"}`);
  lines.push(`Tarih     : ${formatSessionDay(caseRow?.session_day)}`);
  lines.push(`Durum     : ${status.label}`);
  lines.push("");

  const notes = String(labNotes || "").trim();
  const shade = String(toothShade || "").trim();

  if (shade) {
    const scaleLabel =
      detectVitaScale(shade) === VITA_3D_MASTER.id ? "VITA 3D-Master" : "VITA Classical";
    lines.push(`Diş rengi (${scaleLabel})`);
    lines.push("----------");
    lines.push(shade);
    lines.push("");
  }

  if (notes) {
    lines.push("Laboratuvar notu");
    lines.push("----------------");
    lines.push(notes);
    lines.push("");
  }

  const plan = parseDentalPlan(dentalPlanRaw);
  const catalog = buildTreatmentCatalog(treatments);
  const teeth = Object.entries(plan.teeth || {}).sort(([a], [b]) => Number(a) - Number(b));

  if (teeth.length) {
    lines.push("Diş planı (FDI)");
    lines.push("----------------");
    for (const [num, entry] of teeth) {
      const meta = resolveTreatment(catalog, entry.treatment);
      lines.push(`  ${num} — ${meta.label}`);
    }
    lines.push("");
  }

  const annotations = parseAnnotations(annotationsRaw);
  if (annotations.markers.length) {
    lines.push("3B işaretler");
    lines.push("------------");
    annotations.markers.forEach((m, i) => {
      const scan = SCAN_LABELS[m.scanType] || m.scanType;
      lines.push(`  ${i + 1}. [${scan}] ${m.text || "—"}`);
    });
    lines.push("");
  }

  lines.push("Ölçü dosyaları");
  lines.push("--------------");
  const scans = scanSession?.scans || {};
  let scanCount = 0;
  for (const type of ["upper", "lower", "bite"]) {
    const file = scans[type];
    if (!file) {
      lines.push(`  ${SCAN_LABELS[type]}: —`);
      continue;
    }
    scanCount++;
    lines.push(`  ${SCAN_LABELS[type]}: ${file.filename} (${formatFileSize(file.size_bytes)})`);
  }

  if (scanCount === 0) {
    lines.push("  (Bağlı ölçü yok)");
  }

  lines.push("");
  lines.push("— MeshPack");

  return lines.join("\n");
}

export function buildMailtoLink(summary, caseRow, { zipPath = "" } = {}) {
  const subject = encodeURIComponent(
    `MeshPack iş emri — ${caseRow?.case_number || "vaka"}`
  );
  let bodyText = summary;
  if (zipPath) {
    bodyText += `\n\n---\nEk: ZIP dosyasını e-postaya ekleyin:\n${zipPath}`;
  }
  const body = encodeURIComponent(bodyText);
  return `mailto:?subject=${subject}&body=${body}`;
}

export function buildUploadPatientName(caseRow, patient) {
  const caseNum = caseRow?.case_number || "vaka";
  const name = patient ? patientListLabel(patient) : "hasta";
  const safe = `${caseNum}_${name}`.replace(/[^\w\s\-_.]/g, "_").replace(/\s+/g, "_");
  return safe.slice(0, 120);
}
