/**
 * Protez planlama kataloğu — tek kaynak.
 *
 * Sadece lab’a gidecek protez işleri (kron, köprü, veneer vb.).
 * Çekim, implant gibi cerrahi/tedavi adımları burada yok.
 *
 * Yeni protez tipi eklemek için listeye bir satır eklemeniz yeterli:
 *   { id: "laminate", label: "Lamine", abbr: "L", color: "purple" }
 *
 * `id` vakada JSON olarak saklanır (backend enum değil).
 * `color` isteğe bağlı; yoksa paletten otomatik atanır.
 * Eski vakalarda bilinmeyen id kalırsa chart "?" ile gösterir, veri silinmez.
 *
 * İlk kurulum: varsayılan liste burada. Kullanıcı değişiklikleri
 * Ayarlar → Planlama sekmesinden yapılır (`config.json`).
 */

/** @typedef {{ id: string, label: string, abbr: string, color?: string, cls?: string, unknown?: boolean }} DentalTreatment */

export const TREATMENT_COLOR_KEYS = [
  "blue",
  "green",
  "teal",
  "purple",
  "amber",
  "pink",
  "red",
  "neutral",
];

/** @type {DentalTreatment[]} */
export const DEFAULT_DENTAL_TREATMENTS = [
  { id: "crown", label: "Kron", abbr: "K", color: "blue" },
  { id: "inlay", label: "İnley", abbr: "I", color: "green" },
  { id: "onlay", label: "Onley", abbr: "O", color: "teal" },
  { id: "veneer", label: "Veneer", abbr: "V", color: "purple" },
  { id: "bridge", label: "Köprü", abbr: "B", color: "amber" },
  { id: "temp", label: "Geçici", abbr: "G", color: "neutral" },
  // Örnek — yeni protez tipi eklerken aşağıya satır ekleyin:
  // { id: "laminate", label: "Lamine", abbr: "L", color: "purple" },
];

function clsForColor(color) {
  return `fdi-t-${color}`;
}

/**
 * @param {DentalTreatment[]} defs
 * @returns {DentalTreatment[]}
 */
export function buildTreatmentCatalog(defs = DEFAULT_DENTAL_TREATMENTS) {
  return defs.map((t, index) => {
    const color = t.color || TREATMENT_COLOR_KEYS[index % TREATMENT_COLOR_KEYS.length];
    return {
      id: t.id,
      label: t.label,
      abbr: t.abbr,
      color,
      cls: clsForColor(color),
    };
  });
}

/**
 * @param {DentalTreatment[]} catalog
 * @param {string | undefined} id
 * @returns {DentalTreatment | null}
 */
export function findTreatment(catalog, id) {
  if (!id) return null;
  return catalog.find((t) => t.id === id) || null;
}

/**
 * Kayıtlı planda bilinmeyen id (eski / kaldırılmış işlem).
 * @param {string} id
 * @returns {DentalTreatment}
 */
export function unknownTreatment(id) {
  return {
    id,
    label: id,
    abbr: "?",
    color: "neutral",
    cls: clsForColor("neutral"),
    unknown: true,
  };
}

/**
 * @param {DentalTreatment[]} catalog
 * @param {string | undefined} id
 * @returns {DentalTreatment}
 */
export function resolveTreatment(catalog, id) {
  return findTreatment(catalog, id) || unknownTreatment(id);
}

/** @param {DentalTreatment[]} catalog */
export function defaultActiveTreatmentId(catalog) {
  return catalog[0]?.id || "crown";
}
