/**
 * Ölçü sihirbazı slot modeli — zorunlu / opsiyonel çene ve kapanış alanları.
 */
import { classifyScanType } from "./scanFilename.js";
import { FORMAT_PRIORITY, MESH_EXT } from "./scanAdapters/types.js";

/** @typedef {'upper'|'upperPreop'|'lower'|'lowerPreop'|'bite'|'bite2'} ScanSlotId */

/** @type {Array<{ id: ScanSlotId, label: string, hint: string, required: boolean, requiredGroup?: string, icon: string }>} */
export const SCAN_SLOT_DEFS = [
  {
    id: "upper",
    label: "Üst çene",
    hint: "Ana üst model",
    required: true,
    icon: "arrow-up",
  },
  {
    id: "upperPreop",
    label: "Üst çene (preop)",
    hint: "Opsiyonel — pretreatment",
    required: false,
    icon: "history",
  },
  {
    id: "lower",
    label: "Alt çene",
    hint: "Ana alt model",
    required: true,
    icon: "arrow-down",
  },
  {
    id: "lowerPreop",
    label: "Alt çene (preop)",
    hint: "Opsiyonel — pretreatment",
    required: false,
    icon: "history",
  },
  {
    id: "bite",
    label: "Kapanış",
    hint: "Oklüzyon — en az bir kapanış gerekli",
    required: false,
    requiredGroup: "bite",
    icon: "layers",
  },
  {
    id: "bite2",
    label: "Kapanış 2",
    hint: "Opsiyonel ikinci kapanış",
    required: false,
    requiredGroup: "bite",
    icon: "layers",
  },
];

export const BITE_SLOT_IDS = ["bite", "bite2"];

/** Geriye uyumluluk */
export const SCAN_SLOT_LIMITS = {
  upper: 1,
  lower: 1,
  bite: 2,
};

/**
 * @param {object} file
 * @returns {string}
 */
function extendedRole(file) {
  if (file.scanRole) return file.scanRole;
  const fn = (file.filename || "").toLowerCase();
  if (/pretreatment|pre-?op|preop/i.test(fn)) return "pretreatment";
  if (/abutment/i.test(fn)) return "abutment";
  if (file.scanType === "bite" || /bite|occlusion|totaljaw/i.test(fn)) {
    if (/bite\s*scan\s*2|bitescan2|bite_2|bite2|totaljaw1/i.test(fn)) return "bite2";
    if (/totaljaw0/i.test(fn)) return "bite";
    return "bite";
  }
  return file.scanType || classifyScanType(file.filename);
}

/**
 * Dosyayı önerilen slota eşle.
 * @param {object} file
 * @returns {ScanSlotId|null}
 */
export function suggestSlotForFile(file) {
  const fn = (file.filename || "").toLowerCase();
  const role = extendedRole(file);

  if (role === "pretreatment") {
    if (/upper/i.test(fn)) return "upperPreop";
    if (/lower/i.test(fn)) return "lowerPreop";
    return null;
  }

  if (role === "upper") {
    if (/pretreatment|pre-?op/i.test(fn)) return "upperPreop";
    return "upper";
  }

  if (role === "lower") {
    if (/pretreatment|pre-?op/i.test(fn)) return "lowerPreop";
    return "lower";
  }

  if (role === "bite2") return "bite2";
  if (role === "bite") return "bite";

  if (file.scanType === "upper") return "upper";
  if (file.scanType === "lower") return "lower";
  if (file.scanType === "bite") {
    if (/2|sol|sa[gğ]|right|left/i.test(fn) && /bite/.test(fn)) {
      return /2|bitescan2/i.test(fn) ? "bite2" : "bite";
    }
    return "bite";
  }

  return null;
}

function formatScore(filename) {
  const m = filename.match(/\.(\w+)$/i);
  return FORMAT_PRIORITY[m?.[1]?.toLowerCase()] ?? 0;
}

function pickBetterFile(a, b) {
  const scoreA = formatScore(a.filename) + (a.scanPreferred !== false ? 0.5 : 0);
  const scoreB = formatScore(b.filename) + (b.scanPreferred !== false ? 0.5 : 0);
  if (scoreB !== scoreA) return scoreB > scoreA ? b : a;
  return (b.modified_at || 0) > (a.modified_at || 0) ? b : a;
}

/**
 * @param {object[]} files
 * @returns {Record<ScanSlotId, string|null>}
 */
export function buildDefaultSlotAssignments(files) {
  /** @type {Record<ScanSlotId, string|null>} */
  const assignments = {
    upper: null,
    upperPreop: null,
    lower: null,
    lowerPreop: null,
    bite: null,
    bite2: null,
  };

  /** @type {Map<ScanSlotId, object>} */
  const assignedFile = new Map();

  const sorted = [...files].sort((a, b) => (b.modified_at || 0) - (a.modified_at || 0));

  for (const file of sorted) {
    if (!MESH_EXT.test(file.filename)) continue;
    const slot = suggestSlotForFile(file);
    if (!slot) continue;

    const existing = assignedFile.get(slot);
    if (!existing) {
      assignedFile.set(slot, file);
      assignments[slot] = file.path;
      continue;
    }

    const better = pickBetterFile(existing, file);
    assignments[slot] = better.path;
    assignedFile.set(slot, better);
  }

  return assignments;
}

/**
 * @param {Record<ScanSlotId, string|null>} assignments
 */
export function getAssignedPaths(assignments) {
  return Object.values(assignments).filter(Boolean);
}

/**
 * @param {Record<ScanSlotId, string|null>} assignments
 * @param {object[]} files
 */
export function getFilesFromAssignments(assignments, files) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const out = [];
  const used = new Set();

  for (const def of SCAN_SLOT_DEFS) {
    const path = assignments[def.id];
    if (!path || used.has(path)) continue;
    const file = byPath.get(path);
    if (file) {
      out.push(file);
      used.add(path);
    }
  }

  return out;
}

/**
 * @param {Record<ScanSlotId, string|null>} assignments
 * @param {object[]} poolFiles
 */
export function getUnassignedPoolFiles(assignments, poolFiles) {
  const assigned = new Set(getAssignedPaths(assignments));
  return poolFiles.filter((f) => MESH_EXT.test(f.filename) && !assigned.has(f.path));
}

/**
 * @param {Record<ScanSlotId, string|null>} assignments
 * @param {object[]} files
 */
export function validateSlotAssignments(assignments, files) {
  /** @type {Array<{ severity: string, title: string, message: string, code?: string }>} */
  const issues = [];
  const byPath = new Map(files.map((f) => [f.path, f]));

  const paths = getAssignedPaths(assignments);
  const pathCounts = new Map();
  for (const p of paths) {
    pathCounts.set(p, (pathCounts.get(p) || 0) + 1);
  }
  for (const [path, count] of pathCounts) {
    if (count > 1) {
      const file = byPath.get(path);
      issues.push({
        code: "duplicate_path",
        severity: "error",
        title: "Aynı dosya birden fazla slotta",
        message: `${file?.filename || path} yalnızca bir alana atanabilir.`,
      });
    }
  }

  if (!assignments.upper) {
    issues.push({
      code: "missing_upper",
      severity: "error",
      title: "Üst çene gerekli",
      message: "Üst çene slotuna bir dosya atayın veya bekleyen listeden sürükleyin.",
    });
  }

  if (!assignments.lower) {
    issues.push({
      code: "missing_lower",
      severity: "error",
      title: "Alt çene gerekli",
      message: "Alt çene slotuna bir dosya atayın.",
    });
  }

  if (!assignments.bite && !assignments.bite2) {
    issues.push({
      code: "missing_bite",
      severity: "error",
      title: "Kapanış gerekli",
      message: "En az bir kapanış (Kapanış veya Kapanış 2) atanmalıdır.",
    });
  }

  const hasPreopHint = files.some((f) => suggestSlotForFile(f) === "upperPreop" || suggestSlotForFile(f) === "lowerPreop");
  if (hasPreopHint && !assignments.upperPreop && !assignments.lowerPreop) {
    issues.push({
      code: "preop_available",
      severity: "info",
      title: "Preop dosyası var",
      message: "İsterseniz preop slotlarına atayabilirsiniz; zorunlu değildir.",
    });
  }

  const unknown = getUnassignedPoolFiles(assignments, files).filter((f) => !suggestSlotForFile(f));
  if (unknown.length) {
    issues.push({
      code: "unassigned_unknown",
      severity: "warn",
      title: "Atanmamış dosyalar",
      message: `${unknown.length} dosya slota atanmadı (abutment vb. olabilir). Gönderime dahil edilmeyecek.`,
      files: unknown,
    });
  }

  const severity = issues.some((i) => i.severity === "error")
    ? "error"
    : issues.some((i) => i.severity === "warn")
      ? "warn"
      : issues.length
        ? "info"
        : "ok";

  return {
    issues,
    severity,
    canProceed: !issues.some((i) => i.severity === "error"),
  };
}

/**
 * Session.scans yapısına dönüştür (planlama / önizleme).
 * @param {Record<ScanSlotId, string|null>} assignments
 * @param {object[]} files
 */
export function assignmentsToSessionScans(assignments, files) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const pick = (slotId) => {
    const p = assignments[slotId];
    return p ? byPath.get(p) || null : null;
  };

  return {
    upper: pick("upper"),
    lower: pick("lower"),
    bite: pick("bite"),
    bite2: pick("bite2"),
    upperPreop: pick("upperPreop"),
    lowerPreop: pick("lowerPreop"),
  };
}

/**
 * @param {ScanSlotId} slotId
 * @param {string} path
 * @param {Record<ScanSlotId, string|null>} assignments
 */
export function assignPathToSlot(slotId, path, assignments) {
  const next = { ...assignments };
  for (const id of Object.keys(next)) {
    if (next[id] === path) next[id] = null;
  }
  next[slotId] = path;
  return next;
}

/**
 * @param {ScanSlotId} slotId
 * @param {Record<ScanSlotId, string|null>} assignments
 */
export function clearSlot(slotId, assignments) {
  return { ...assignments, [slotId]: null };
}

export function dedupeSlotAssignments(assignments) {
  const next = { ...assignments };
  const seen = new Set();
  for (const def of SCAN_SLOT_DEFS) {
    const p = next[def.id];
    if (!p) continue;
    if (seen.has(p)) {
      next[def.id] = null;
    } else {
      seen.add(p);
    }
  }
  return next;
}

/**
 * Slot → dosya meta (gönderim / bağlama).
 * @param {ScanSlotId} slotId
 */
export function slotToFileMeta(slotId) {
  const map = {
    upper: { scanType: "upper", scanRole: "upper" },
    upperPreop: { scanType: "unknown", scanRole: "pretreatment", isPreop: true },
    lower: { scanType: "lower", scanRole: "lower" },
    lowerPreop: { scanType: "unknown", scanRole: "pretreatment", isPreop: true },
    bite: { scanType: "bite", scanRole: "bite" },
    bite2: { scanType: "bite", scanRole: "bite2" },
  };
  return map[slotId] || {};
}

/**
 * @param {object} file
 * @param {ScanSlotId} slotId
 */
export function enrichFileForSlot(file, slotId) {
  return { ...file, ...slotToFileMeta(slotId) };
}

/** Boş slot haritası */
export function emptySlotAssignments() {
  return {
    upper: null,
    upperPreop: null,
    lower: null,
    lowerPreop: null,
    bite: null,
    bite2: null,
  };
}
