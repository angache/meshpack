import { patientKeyFromStem } from "../utils.js";

/**
 * Tarayıcıdan bağımsız dosya öneki normalizasyonu.
 * 3Shape, Medit, iTero vb. farklı adlandırmalar aynı anahtara indirgenir.
 */

export function normalizeStemKey(stem) {
  return patientKeyFromStem(stem);
}

/** Sürüm/numara soneklerini çıkar: serdaltinic2 → serdaltinic */
export function canonicalStemKey(stem) {
  let key = normalizeStemKey(stem);
  if (!key) return "";

  key = key.replace(/(?:_v|_rev|_copy)\d+$/i, "");
  key = key.replace(/\d+$/i, "");
  key = key.replace(/_+$/, "");

  return key.length >= 3 ? key : normalizeStemKey(stem);
}

/** Öneri / alias kaydı için denenecek tüm anahtarlar */
export function stemLookupKeys(stem) {
  const raw = normalizeStemKey(stem);
  const canonical = canonicalStemKey(stem);
  const keys = new Set();
  if (raw) keys.add(raw);
  if (canonical) keys.add(canonical);
  return [...keys];
}

export function patientNameKeys(patient) {
  const surname = normalizeStemKey(patient.surname);
  const firstName = normalizeStemKey(patient.first_name);
  if (!surname && !firstName) return [];

  const keys = new Set();
  if (surname && firstName) {
    keys.add(`${surname}${firstName}`);
    keys.add(`${firstName}${surname}`);
  } else {
    keys.add(surname || firstName);
  }
  return [...keys];
}

export function stemsMatchFuzzy(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a))) return true;
  return false;
}
