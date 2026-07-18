import {
  classifyScanType,
  extractFileStem,
  formatFileSize,
  parseSuggestedName,
  patientKeyFromStem,
  SCAN_LABELS,
} from "./utils.js";
import {
  buildDefaultSlotAssignments,
  getFilesFromAssignments,
  assignmentsToSessionScans,
  SCAN_SLOT_LIMITS,
} from "./scanSlots.js";

export { SCAN_SLOT_LIMITS } from "./scanSlots.js";

const SCAN_TYPES = ["upper", "lower", "bite"];

function newestFiles(files, limit = 1) {
  if (!files?.length) return [];
  return [...files]
    .sort((a, b) => (b.modified_at || 0) - (a.modified_at || 0))
    .slice(0, limit);
}

function newestFile(files) {
  return newestFiles(files, 1)[0] || null;
}

function slotLimit(type) {
  return SCAN_SLOT_LIMITS[type] ?? 1;
}

export function enrichScanFile(file) {
  return {
    ...file,
    fileStem: file.fileStem || extractFileStem(file.filename),
    scanType: file.scanType || classifyScanType(file.filename),
  };
}

/** Kapanış dosyası için görünen etiket (sol/sağ veya 2. kapanış) */
export function biteDisplayLabel(filename) {
  const base = String(filename || "").replace(/\.(stl|ply|dcm|obj)$/i, "");
  if (/(?:^|[\s_.-])(?:left|sol)(?:$|[\s_.-])/i.test(base)) return "Kapanış (Sol)";
  if (/(?:^|[\s_.-])(?:right|sa[gğ])(?:$|[\s_.-])/i.test(base)) return "Kapanış (Sağ)";
  if (/bite\s*scan\s*2|bitescan2|bite_2/i.test(base)) return "Kapanış 2";
  return "Kapanış";
}

/** Varsayılan seçim: slot atamalarından gönderilecek dosyalar */
export function pickDefaultSelectedFiles(files) {
  const enriched = files.map(enrichScanFile);
  const assignments = buildDefaultSlotAssignments(enriched);
  return getFilesFromAssignments(assignments, enriched);
}

/**
 * Ölçü seti kalite analizi.
 * @returns {{ warnings, stems, byType, scans, severity }}
 */
export function analyzeScanFiles(files) {
  const enriched = files.map(enrichScanFile);
  const byType = { upper: [], lower: [], bite: [], unknown: [] };
  const stemSet = new Set();

  for (const f of enriched) {
    stemSet.add(f.fileStem || "");
    const bucket = byType[f.scanType] ? f.scanType : "unknown";
    byType[bucket].push(f);
  }

  const stems = [...stemSet].filter(Boolean);
  const warnings = [];

  if (!byType.upper.length) {
    warnings.push({
      code: "missing_upper",
      severity: "warn",
      title: "Üst çene eksik",
      message: "Üst çene ölçüsü bulunamadı. Eksik set ile devam edebilirsiniz.",
    });
  }
  if (!byType.lower.length) {
    warnings.push({
      code: "missing_lower",
      severity: "warn",
      title: "Alt çene eksik",
      message: "Alt çene ölçüsü bulunamadı. Eksik set ile devam edebilirsiniz.",
    });
  }
  if (!byType.bite.length) {
    warnings.push({
      code: "missing_bite",
      severity: "info",
      title: "Kapanış ölçüsü yok",
      message: "Kapanış dosyası yok; üst ve alt ile de devam edilebilir.",
    });
  }

  for (const type of SCAN_TYPES) {
    const limit = slotLimit(type);
    if (byType[type].length > limit) {
      const title =
        type === "bite"
          ? "Birden fazla kapanış"
          : `Birden fazla ${SCAN_LABELS[type]}`;
      const message =
        type === "bite"
          ? `${byType[type].length} kapanış dosyası var. Sete en fazla 2 kapanış eklenebilir — hangilerini kullanacağınızı seçin.`
          : `${byType[type].length} dosya var. Hangisini kullanacağınızı seçin (varsayılan: en yeni).`;
      warnings.push({
        code: `duplicate_${type}`,
        severity: "warn",
        title,
        message,
        scanType: type,
        files: byType[type],
        maxSelect: limit,
      });
    }
  }

  if (byType.unknown.length) {
    warnings.push({
      code: "unknown_type",
      severity: "warn",
      title: "Tanınmayan dosya tipi",
      message: `${byType.unknown.length} dosyanın türü (üst/alt/kapanış) otomatik belirlenemedi.`,
      files: byType.unknown,
    });
  }

  if (stems.length > 1) {
    const stemKeys = [...new Set(stems.map(patientKeyFromStem))];
    if (stemKeys.length > 1) {
      warnings.push({
        code: "mixed_stems",
        severity: "error",
        title: "Karışık hasta isimleri",
        message: `Farklı dosya önekleri: ${stems.map(parseSuggestedName).join(", ")}. Aynı hastaya ait dosyaları birlikte ekleyin.`,
        stems,
      });
    }
  }

  const count = SCAN_TYPES.filter((t) => byType[t].length).length;
  if (count === 0 && enriched.length) {
    warnings.push({
      code: "no_recognized",
      severity: "error",
      title: "Tanımlı ölçü yok",
      message: "Hiçbir dosya üst/alt/kapanış olarak sınıflandırılamadı.",
    });
  }

  const scans = { upper: null, lower: null, bite: null, bite2: null };
  scans.upper = newestFile(byType.upper);
  scans.lower = newestFile(byType.lower);
  const bites = newestFiles(byType.bite, slotLimit("bite"));
  scans.bite = bites[0] || null;
  scans.bite2 = bites[1] || null;

  const severity = warnings.some((w) => w.severity === "error")
    ? "error"
    : warnings.some((w) => w.severity === "warn")
      ? "warn"
      : warnings.length
        ? "info"
        : "ok";

  return {
    warnings,
    stems,
    byType,
    scans,
    severity,
    enriched,
    selectedFiles: pickDefaultSelectedFiles(enriched),
  };
}

export function buildWizardGroupFromFiles(files, { id = null } = {}) {
  const analysis = analyzeScanFiles(files);
  const primaryStem = analysis.stems.length === 1 ? analysis.stems[0] : analysis.enriched[0]?.fileStem || "";
  const slotAssignments = buildDefaultSlotAssignments(analysis.enriched);
  const selectedFiles = getFilesFromAssignments(slotAssignments, analysis.enriched);
  const sessionScans = assignmentsToSessionScans(slotAssignments, analysis.enriched);

  return {
    id: id || `wizard_${Date.now()}`,
    fileStem: primaryStem,
    suggestedName: parseSuggestedName(primaryStem),
    files: analysis.enriched,
    unassigned: analysis.enriched,
    analysis,
    slotAssignments,
    selectedFiles,
    modifiedAt: Math.max(0, ...analysis.enriched.map((f) => f.modified_at || 0)),
    session: {
      scans: sessionScans,
      modifiedAt: Math.max(0, ...analysis.enriched.map((f) => f.modified_at || 0)),
    },
  };
}

export function formatScanFileRow(file) {
  const type = file.scanType || "unknown";
  const label =
    type === "bite" ? biteDisplayLabel(file.filename) : SCAN_LABELS[type] || "Bilinmeyen";
  return {
    path: file.path,
    filename: file.filename,
    type,
    typeLabel: label,
    size: formatFileSize(file.size_bytes || 0),
    stem: file.fileStem,
  };
}

export function resolveSelectedFiles(group, selectedPaths) {
  if (group.slotAssignments) {
    return getFilesFromAssignments(group.slotAssignments, group.files);
  }
  const pathSet = selectedPaths instanceof Set ? selectedPaths : new Set(selectedPaths);
  const picked = group.files.filter((f) => pathSet.has(f.path));
  if (!picked.length) return group.selectedFiles || pickDefaultSelectedFiles(group.files);
  return picked;
}

/** Seçime göre analizi yeniden hesapla (duplicate seçimi sonrası) */
export function reanalyzeSelection(files) {
  return analyzeScanFiles(files);
}
