/**
 * Tarayıcı dosya adı formatı (3Shape TRIOS vb.):
 *   {HastaOnEki}UpperJawScan.ply
 *   {HastaOnEki}LowerJawScan.ply
 *   {HastaOnEki}BiteScan.ply
 *
 * Önerilen önek: Soyad-Ad → Yilmaz-AhmetUpperJawScan.ply
 */
const SCAN_EXTENSIONS = /\.(stl|ply|dcm)$/i;

const DATE_PATTERNS = [
  /_\d{4}[-_]\d{2}[-_]\d{2}/,
  /_\d{8}/,
  /_\d{2}\.\d{2}\.\d{4}/,
];

const SCANNER_SUFFIXES = [
  { type: "upper", match: /UpperJawScan/i, strip: /_?UpperJawScan$/i },
  { type: "lower", match: /(?:Lower|Lowe)JawScan/i, strip: /_?(?:Lower|Lowe)JawScan$/i },
  { type: "bite", match: /BiteScan\d*/i, strip: /_?BiteScan\d*$/i },
];

const LEGACY_TYPE_PATTERNS = {
  upper: [
    /upper/i, /maxilla/i, /ust[\s_-]?cene/i, /üst[\s_-]?çene/i,
    /maxillary/i, /jaw[\s_-]?upper/i,
  ],
  lower: [
    /lower/i, /mandible/i, /mandibular/i, /alt[\s_-]?cene/i,
    /alt[\s_-]?çene/i, /jaw[\s_-]?lower/i,
  ],
  bite: [
    /occlusion/i, /okluz/i, /okluzyon/i, /kapan/i,
    /articulation/i, /vestibular/i, /registration/i,
  ],
};

function baseName(filename) {
  return filename.replace(SCAN_EXTENSIONS, "");
}

function capitalizePart(part) {
  if (!part) return "";
  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
}

function formatPatientName(stem) {
  let name = stem.replace(/_+$/, "").replace(/^_+/, "").replace(/__+/g, "_").trim();
  if (!name) return "Bilinmeyen Hasta";

  if (name.includes("_")) {
    return name
      .split("_")
      .filter(Boolean)
      .map(capitalizePart)
      .join(" ");
  }

  const spaced = name.replace(/([a-zğüşıöç])([A-ZİĞÜŞÖÇ])/g, "$1 $2");
  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map(capitalizePart)
    .join(" ");
}

function stripScannerSuffix(base) {
  for (const { strip } of SCANNER_SUFFIXES) {
    const cleaned = base.replace(strip, "");
    if (cleaned !== base) return cleaned;
  }
  return null;
}

/** Dosya adından ham hasta öneki (tarama tipi ve tarih sonekleri çıkarılmış) */
export function extractFileStem(filename) {
  let base = baseName(filename);

  for (const pattern of DATE_PATTERNS) {
    base = base.replace(pattern, "");
  }

  const fromScanner = stripScannerSuffix(base);
  if (fromScanner !== null) {
    return fromScanner.replace(/_+$/, "").replace(/^_+/, "").trim();
  }

  for (const patterns of Object.values(LEGACY_TYPE_PATTERNS)) {
    for (const p of patterns) {
      base = base.replace(p, "");
    }
  }

  return base.replace(/_+$/, "").replace(/^_+/, "").trim();
}

/** Dosya önekinden önerilen görünen ad — tire (-) varsa soyad-ad ayrımı */
export function parseSuggestedName(stem) {
  if (!stem) return "Bilinmeyen Hasta";

  if (stem.includes("-")) {
    return stem
      .split("-")
      .filter(Boolean)
      .map(capitalizePart)
      .join(" ");
  }

  return formatPatientName(stem);
}

export function parsePatientName(filename) {
  return parseSuggestedName(extractFileStem(filename));
}

/** Gruplama anahtarı — dosya önekinden, görünen addan bağımsız */
export function patientKeyFromStem(stem) {
  return (stem || "bilinmeyen")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_.-]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function patientKeyFromFilename(filename) {
  return patientKeyFromStem(extractFileStem(filename));
}

/** @deprecated Görünen ad yerine patientKeyFromStem kullanın */
export function patientKey(name) {
  return patientKeyFromStem(name);
}

/**
 * @returns {'upper' | 'lower' | 'bite' | 'unknown'}
 */
export function classifyScanType(filename) {
  const base = baseName(filename);

  for (const { match, type } of SCANNER_SUFFIXES) {
    if (match.test(base)) return type;
  }

  for (const [type, patterns] of Object.entries(LEGACY_TYPE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(base)) return type;
    }
  }

  return "unknown";
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isScanFile(filename) {
  return SCAN_EXTENSIONS.test(filename);
}

function dayKey(timestamp) {
  const d = new Date(timestamp * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Aynı hastanın dosyalarını günlük oturumlara ayırır */
export function groupFilesIntoSessions(files) {
  const byDay = new Map();

  for (const file of files) {
    const dk = dayKey(file.modified_at);
    if (!byDay.has(dk)) {
      byDay.set(dk, {
        id: dk,
        dayKey: dk,
        modifiedAt: 0,
        scans: { upper: null, lower: null, bite: null },
        files: [],
      });
    }

    const session = byDay.get(dk);
    session.files.push(file);
    session.modifiedAt = Math.max(session.modifiedAt, file.modified_at);

    const type = file.scanType;
    if (type === "upper" || type === "lower" || type === "bite") {
      const existing = session.scans[type];
      if (!existing || file.modified_at > existing.modified_at) {
        session.scans[type] = file;
      }
    }
  }

  return Array.from(byDay.values()).sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export function groupFilesByPatient(files) {
  const groups = new Map();

  for (const file of files) {
    const stem = file.fileStem || extractFileStem(file.filename);
    const key = patientKeyFromStem(stem);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        fileStem: stem,
        suggestedName: parseSuggestedName(stem),
        allFiles: [],
      });
    }

    const group = groups.get(key);
    group.allFiles.push(file);
    group.latestModified = Math.max(group.latestModified || 0, file.modified_at);
    group.fileCount = group.allFiles.length;
  }

  return Array.from(groups.values())
    .map((group) => {
      const sessions = groupFilesIntoSessions(group.allFiles);
      const latest = sessions[0] || { scans: {}, modifiedAt: 0 };
      return {
        key: group.key,
        fileStem: group.fileStem,
        suggestedName: group.suggestedName,
        sessions,
        scans: latest.scans,
        latestModified: latest.modifiedAt || group.latestModified || 0,
        fileCount: group.fileCount,
        allFiles: group.allFiles,
      };
    })
    .sort((a, b) => b.latestModified - a.latestModified);
}

export function buildLinkableGroups(folderFiles, isLinked) {
  const stems = groupFilesByPatient(folderFiles);
  const groups = [];

  for (const stem of stems) {
    for (const session of stem.sessions) {
      const files = (session.files?.length ? session.files : Object.values(session.scans).filter(Boolean));
      if (!files.length) continue;

      const unassigned = files.filter((f) => !isLinked(f.path));
      const assigned = files.filter((f) => isLinked(f.path));

      groups.push({
        id: `${stem.key}_${session.id}`,
        stemKey: stem.key,
        fileStem: stem.fileStem,
        suggestedName: stem.suggestedName,
        session,
        files,
        unassigned,
        assigned,
        modifiedAt: session.modifiedAt,
        pendingCount: unassigned.length,
        isFullyLinked: unassigned.length === 0,
      });
    }
  }

  return groups.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export function getPatientScanCount(group) {
  return ["upper", "lower", "bite"].filter((t) => group.scans?.[t]).length;
}

/** Görünen ad veya dosya önekinden soyad/ad ayrımı */
export function splitPatientName(displayName, fileStem = null) {
  if (fileStem?.includes("-")) {
    const parts = fileStem.split("-").filter(Boolean);
    if (parts.length >= 2) {
      return {
        surname: capitalizePart(parts[0]),
        firstName: parts.slice(1).map(capitalizePart).join(" "),
      };
    }
  }

  const parts = (displayName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { surname: parts[0] || "—", firstName: "—" };
  }
  const firstName = parts.pop();
  return { surname: parts.join(" "), firstName };
}

export function needsNamingHint(fileStem) {
  if (!fileStem) return true;
  return !fileStem.includes("-") && !fileStem.includes("_");
}

export const SCAN_LABELS = {
  upper: "Üst Çene",
  lower: "Alt Çene",
  bite: "Kapanış",
};
