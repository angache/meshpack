/**
 * Tarayıcıdan bağımsız ölçü dosyası adı ayrıştırma.
 *
 * İlke: önce üst / alt / kapanış tipini bul, sonra o tipi dosya adından çıkar;
 * kalan kısım hasta önekidir. Böylece kısmi eşleşmeler (ör. sadece "Lower" silinip
 * "JawScan_1" kalması) oluşmaz.
 *
 * Desteklenen örnekler:
 *   3Shape:  Yilmaz-AhmetUpperJawScan.ply, sibelersayans LowerJawScan_1.ply
 *   Genel:   hasta_upper.stl, Smith_mandible.ply, Doe_occlusion.ply
 *   Türkçe:  hasta_ust_cene.ply, kapanis_olcu.stl
 */

const SCAN_EXTENSIONS = /\.(stl|ply|dcm|obj)$/i;

const DATE_PATTERNS = [
  /_\d{4}[-_]\d{2}[-_]\d{2}/,
  /_\d{8}/,
  /_\d{2}\.\d{2}\.\d{4}/,
  /[-_]\d{6,14}(?=[_.\s-]|$)/, // 202403151200
];

/** Opsiyonel sürüm / tekrar numarası: _1, _02, 2 */
const OPTIONAL_INDEX = "(?:_\\d+|\\d+)?";

/** Dosya adında tip belirteci: ayraç veya baş/son */
function tokenRule(type, body) {
  return {
    type,
    match: new RegExp(`(?:^|[\\s_.-])${body}(?:$|[\\s_.-])`, "i"),
    stripSuffix: new RegExp(`[\\s_.-]+${body}$`, "i"),
    stripPrefix: new RegExp(`^${body}[\\s_.-]+`, "i"),
    stripToken: new RegExp(`[\\s_.-]+${body}(?=[\\s_.-]|$)`, "gi"),
  };
}

/**
 * Öncelik sırası önemli — daha özel kurallar önce.
 * @type {Array<{
 *   type: 'upper' | 'lower' | 'bite',
 *   match: RegExp,
 *   stripSuffix?: RegExp,
 *   stripPrefix?: RegExp,
 *   stripToken?: RegExp,
 * }>}
 */
const SCAN_TYPE_RULES = [
  // ── 3Shape TRIOS ve benzeri tam sonekler ─────────────────────
  {
    type: "upper",
    match: new RegExp(`UpperJawScan${OPTIONAL_INDEX}`, "i"),
    stripSuffix: new RegExp(`\\s*_?UpperJawScan${OPTIONAL_INDEX}$`, "i"),
    stripPrefix: new RegExp(`^UpperJawScan${OPTIONAL_INDEX}[\\s_.-]+`, "i"),
  },
  {
    type: "lower",
    match: new RegExp(`(?:Lower|Lowe)JawScan${OPTIONAL_INDEX}`, "i"),
    stripSuffix: new RegExp(`\\s*_?(?:Lower|Lowe)JawScan${OPTIONAL_INDEX}$`, "i"),
    stripPrefix: new RegExp(`^(?:Lower|Lowe)JawScan${OPTIONAL_INDEX}[\\s_.-]+`, "i"),
  },
  {
    type: "bite",
    match: new RegExp(`BiteScan${OPTIONAL_INDEX}`, "i"),
    stripSuffix: new RegExp(`\\s*_?BiteScan${OPTIONAL_INDEX}$`, "i"),
    stripPrefix: new RegExp(`^BiteScan${OPTIONAL_INDEX}[\\s_.-]+`, "i"),
  },

  // ── iTero / exocad: upper_jaw_with_ditch_#… (tip önde) ────────
  {
    type: "upper",
    match: new RegExp(`Upper[\\s_-]?Jaw(?:Scan)?${OPTIONAL_INDEX}`, "i"),
    stripSuffix: new RegExp(`\\s*_?Upper[\\s_-]?Jaw(?:Scan)?${OPTIONAL_INDEX}$`, "i"),
    stripPrefix: new RegExp(`^Upper[\\s_-]?Jaw(?:Scan)?${OPTIONAL_INDEX}[\\s_.-]+`, "i"),
  },
  {
    type: "lower",
    match: new RegExp(`Lower[\\s_-]?Jaw(?:Scan)?${OPTIONAL_INDEX}`, "i"),
    stripSuffix: new RegExp(`\\s*_?Lower[\\s_-]?Jaw(?:Scan)?${OPTIONAL_INDEX}$`, "i"),
    stripPrefix: new RegExp(`^Lower[\\s_-]?Jaw(?:Scan)?${OPTIONAL_INDEX}[\\s_.-]+`, "i"),
  },
  {
    type: "bite",
    match: /Bite(?:\s+(?:Scan|Registration|Record)|(?:Scan|Registration|Record))?(?:_\d+)?/i,
    stripSuffix: /\s*_?Bite(?:\s+(?:Scan|Registration|Record)|(?:Scan|Registration|Record))?(?:_\d+)?$/i,
    stripPrefix: /^Bite(?:\s+(?:Scan|Registration|Record)|(?:Scan|Registration|Record))?(?:_\d+)?[\s_.-]+/i,
  },

  // ── Anatomik terimler (Medit, genel export) ─────────────────────
  tokenRule("upper", "maxill(?:ary|a)"),
  tokenRule("lower", "mandib(?:ular|le)"),

  // ── Türkçe (ayraç zorunlu — "hasta" içindeki st'yi yakalamamak için) ──
  tokenRule("upper", "(?:üst|ust)[\\s_-]?(?:çene|cene)"),
  tokenRule("lower", "(?:alt)[\\s_-]?(?:çene|cene)"),
  tokenRule("bite", "kapan(?:ış|is|ma)"),

  // ── jaw_upper / jaw_lower ────────────────────────────────────────
  tokenRule("upper", "jaw[\\s_-]?upper"),
  tokenRule("lower", "jaw[\\s_-]?lower"),

  // ── Kapanış / oklüzyon ─────────────────────────────────────────
  tokenRule("bite", "(?:occlusion|okluz(?:yon)?|articulation|registration|vestibular)"),

  // ── Genel upper / lower (en düşük öncelik) ─────────────────────
  tokenRule("upper", "upper"),
  tokenRule("lower", "lower"),
];

/** iTero / sipariş no: #310361423 */
export function extractCaseOrderRef(filenameOrStem) {
  const s = String(filenameOrStem || "");
  return s.match(/#(\d{5,})/)?.[1] || "";
}

function isPretreatmentName(base) {
  return /pretreatment|pre-?op(?:erative)?|\bpreop\b/i.test(base);
}

function stripRoleNoise(stem) {
  return stem
    .replace(/^(?:with[_-]?ditch|without[_-]?ditch|pretreatment|pre-?op(?:erative)?|preop)[_\s.-]*/i, "")
    .replace(/[_\s.-]*(?:with[_-]?ditch|without[_-]?ditch|pretreatment|pre-?op(?:erative)?|preop)$/i, "")
    .replace(/^#+/, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}
function baseName(filename) {
  return filename.replace(SCAN_EXTENSIONS, "");
}

function stripDates(base) {
  let out = base;
  for (const pattern of DATE_PATTERNS) {
    out = out.replace(pattern, "");
  }
  return out;
}

function findScanTypeRule(base) {
  for (const rule of SCAN_TYPE_RULES) {
    if (rule.match.test(base)) return rule;
  }
  return null;
}

function applyTypeStrip(base, rule) {
  if (!rule) return base;

  if (rule.stripPrefix) {
    const fromPrefix = base.replace(rule.stripPrefix, "");
    if (fromPrefix !== base) return fromPrefix;
  }

  if (rule.stripSuffix) {
    const fromSuffix = base.replace(rule.stripSuffix, "");
    if (fromSuffix !== base) return fromSuffix;
  }

  if (rule.stripToken) {
    return base.replace(rule.stripToken, "");
  }

  return base;
}

function cleanStem(stem) {
  let out = stem
    .replace(/(?:_|-|\s)?(?:copy|kopya|kopyası)(?:\s*\d+)?$/i, "")
    .replace(/(?:_|-|\s)?(?:v|rev)\d+$/i, "")
    .replace(/(?:_\d+|\(\d+\))$/, "")
    .replace(/[\s_.-]+$/, "")
    .replace(/^[\s_.-]+/, "")
    .replace(/__+/g, "_")
    .trim();

  return out;
}

/**
 * Dosya adını tip + hasta öneki olarak ayrıştırır.
 * Sipariş no (#310361423) varsa gruplama anahtarı olarak kullanılır (iTero vb.).
 * @returns {{ base: string, scanType: 'upper'|'lower'|'bite'|'unknown', stem: string, orderId: string|null, isPreop: boolean }}
 */
export function parseScanFilename(filename) {
  const base = baseName(filename);
  let working = stripDates(base);
  const rule = findScanTypeRule(working);
  const isPreop = isPretreatmentName(working);
  /** Pretreatment ana üst/alt slotunu doldurmasın */
  const scanType = isPreop ? "unknown" : rule?.type ?? "unknown";

  let stem = cleanStem(stripRoleNoise(applyTypeStrip(working, rule)));
  const orderId = extractCaseOrderRef(working) || extractCaseOrderRef(stem);

  if (orderId) {
    stem = `itero-${orderId}`;
  } else {
    stem = cleanStem(stripRoleNoise(stem));
  }

  return { base, scanType, stem, orderId: orderId || null, isPreop };
}

/** @returns {'upper' | 'lower' | 'bite' | 'unknown'} */
export function classifyScanType(filename) {
  return parseScanFilename(filename).scanType;
}

/** Dosya adından ham hasta öneki */
export function extractFileStem(filename) {
  return parseScanFilename(filename).stem;
}

export function isScanFile(filename) {
  return SCAN_EXTENSIONS.test(filename);
}

export const SCAN_LABELS = {
  upper: "Üst Çene",
  lower: "Alt Çene",
  bite: "Kapanış",
};
