/**
 * Tarayıcı dosya adı formatı (3Shape TRIOS vb.):
 *   {HastaAdi}UpperJawScan.ply
 *   {HastaAdi}LowerJawScan.ply
 *   {HastaAdi}BiteScan.ply / BiteScan2.ply
 */
const SCAN_EXTENSIONS = /\.(stl|ply|dcm)$/i;

const DATE_PATTERNS = [
  /_\d{4}[-_]\d{2}[-_]\d{2}/,
  /_\d{8}/,
  /_\d{2}\.\d{2}\.\d{4}/,
];

/** Öncelikli tarayıcı sonekleri — sonda veya _ ile ayrılmış */
const SCANNER_SUFFIXES = [
  { type: "upper", match: /UpperJawScan/i, strip: /_?UpperJawScan$/i },
  { type: "lower", match: /(?:Lower|Lowe)JawScan/i, strip: /_?(?:Lower|Lowe)JawScan$/i },
  { type: "bite", match: /BiteScan\d*/i, strip: /_?BiteScan\d*$/i },
];

/** Eski / alternatif adlandırma kalıpları */
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

function formatPatientName(stem) {
  let name = stem.replace(/_+$/, "").replace(/^_+/, "").replace(/__+/g, "_").trim();
  if (!name) return "Bilinmeyen Hasta";

  if (name.includes("_")) {
    return name
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }

  // CamelCase: AhmetYilmaz → Ahmet Yilmaz
  const spaced = name.replace(/([a-zğüşıöç])([A-ZİĞÜŞÖÇ])/g, "$1 $2");
  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function stripScannerSuffix(base) {
  for (const { strip } of SCANNER_SUFFIXES) {
    const cleaned = base.replace(strip, "");
    if (cleaned !== base) return cleaned;
  }
  return null;
}

export function parsePatientName(filename) {
  let base = baseName(filename);

  for (const pattern of DATE_PATTERNS) {
    base = base.replace(pattern, "");
  }

  const fromScanner = stripScannerSuffix(base);
  if (fromScanner !== null) {
    return formatPatientName(fromScanner);
  }

  // Eski format: tip anahtar kelimelerini çıkar
  for (const patterns of Object.values(LEGACY_TYPE_PATTERNS)) {
    for (const p of patterns) {
      base = base.replace(p, "");
    }
  }

  return formatPatientName(base);
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

/** Gruplama için normalize anahtar — boşluk/underscore farkını yok sayar */
export function patientKey(name) {
  return (name || "bilinmeyen")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_.-]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function groupFilesByPatient(files) {
  const groups = new Map();

  for (const file of files) {
    const name = file.patientName || "Bilinmeyen Hasta";
    const key = patientKey(name);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        patientName: name,
        scans: { upper: null, lower: null, bite: null },
        extras: [],
        latestModified: 0,
        fileCount: 0,
      });
    }

    const group = groups.get(key);
    group.fileCount++;
    group.latestModified = Math.max(group.latestModified, file.modified_at);

    const type = file.scanType;
    if (type === "upper" || type === "lower" || type === "bite") {
      const existing = group.scans[type];
      if (!existing || file.modified_at > existing.modified_at) {
        group.scans[type] = file;
      }
    } else {
      group.extras.push(file);
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.latestModified - a.latestModified);
}

export function getPatientScanCount(group) {
  return ["upper", "lower", "bite"].filter((t) => group.scans[t]).length;
}

export const SCAN_LABELS = {
  upper: "Üst Çene",
  lower: "Alt Çene",
  bite: "Kapanış",
};
