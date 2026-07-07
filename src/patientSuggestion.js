import { splitPatientName } from "./utils.js";
import { patientListLabel } from "./patients.js";
import {
  canonicalStemKey,
  normalizeStemKey,
  patientNameKeys,
  stemLookupKeys,
  stemsMatchFuzzy,
} from "./matching/stemKeys.js";
import { bestStringSimilarity } from "./matching/stringSimilarity.js";

const MIN_SCORE = 55;
const MIN_DISPLAY_SCORE = 60;

function isPairRejected(group, patient, stemRejections) {
  if (!stemRejections?.size || !patient?.id) return false;
  for (const key of stemLookupKeys(group.fileStem)) {
    if (stemRejections.has(`${key}:${patient.id}`)) return true;
  }
  return false;
}

function asLinkArray(scanLinks) {
  return Array.isArray(scanLinks) ? scanLinks : [...scanLinks.values()];
}

function aliasForGroup(group, stemAliases) {
  if (!stemAliases?.size) return null;
  for (const key of stemLookupKeys(group.fileStem)) {
    const row = stemAliases.get(key);
    if (row) return { ...row, matchedKey: key };
  }
  return null;
}

function scoreNameTokenOverlap(groupKey, patient) {
  const surname = normalizeStemKey(patient.surname);
  const firstName = normalizeStemKey(patient.first_name);
  if (!surname || !firstName || surname.length < 3 || firstName.length < 3) {
    return { score: 0, reason: null };
  }

  const hasSurname = groupKey.includes(surname);
  const hasFirst = groupKey.includes(firstName);
  if (!hasSurname || !hasFirst) return { score: 0, reason: null };

  const nameKeys = patientNameKeys(patient);
  if (nameKeys.some((k) => k === groupKey)) {
    return { score: 88, reason: "dosya öneki eşleşmesi" };
  }
  if (nameKeys.some((k) => k.length >= 5 && groupKey.startsWith(k))) {
    return { score: 84, reason: "isim öneki + sürüm" };
  }
  return { score: 78, reason: "ad ve soyad önekte" };
}

function scoreFuzzySimilarity(groupCanonical, patient, links) {
  const candidates = new Set(patientNameKeys(patient));

  for (const link of links) {
    candidates.add(normalizeStemKey(link.file_stem));
    candidates.add(canonicalStemKey(link.file_stem));
  }

  const similarity = bestStringSimilarity(groupCanonical, [...candidates].filter((k) => k.length >= 4));
  if (similarity >= 0.94) return { score: 80, reason: "yüksek isim benzerliği" };
  if (similarity >= 0.88) return { score: 72, reason: "benzer isim" };
  if (similarity >= 0.82) return { score: 62, reason: "kısmi isim benzerliği" };
  return { score: 0, reason: null };
}

/** Tek hasta için grup eşleşme skoru (0–100) */
export function scorePatientForGroup(group, patient, scanLinks, stemAliases = null, stemRejections = null) {
  if (isPairRejected(group, patient, stemRejections)) {
    return { score: 0, reasons: [] };
  }
  const reasons = new Set();
  let score = 0;

  const groupKey = group.stemKey || normalizeStemKey(group.fileStem);
  const groupCanonical = canonicalStemKey(group.fileStem);
  if (!groupKey || groupKey === "bilinmeyen") {
    return { score: 0, reasons: [] };
  }

  const alias = aliasForGroup(group, stemAliases);
  if (alias?.patient_id === patient.id) {
    return {
      score: 100,
      reasons: [
        alias.hit_count > 1 ? `kayıtlı önek (${alias.hit_count}×)` : "kayıtlı dosya öneki",
      ],
    };
  }

  const links = asLinkArray(scanLinks).filter((l) => l.patient_id === patient.id);

  const exactStemCount = links.filter(
    (l) => normalizeStemKey(l.file_stem) === groupKey
  ).length;
  if (exactStemCount > 0) {
    score = Math.max(score, Math.min(100, 92 + exactStemCount));
    reasons.add(exactStemCount === 1 ? "1 önceki eşleşme" : `${exactStemCount} önceki eşleşme`);
  }

  const fuzzyStemCount = links.filter((l) => {
    const linkKey = normalizeStemKey(l.file_stem);
    const linkCanonical = canonicalStemKey(l.file_stem);
    return (
      stemsMatchFuzzy(linkKey, groupKey) ||
      stemsMatchFuzzy(linkCanonical, groupCanonical) ||
      stemsMatchFuzzy(linkKey, groupCanonical) ||
      stemsMatchFuzzy(linkCanonical, groupKey)
    );
  }).length;

  if (fuzzyStemCount > 0 && exactStemCount === 0) {
    score = Math.max(score, Math.min(96, 86 + fuzzyStemCount));
    reasons.add(
      fuzzyStemCount === 1 ? "benzer önceki ölçü" : `${fuzzyStemCount} benzer önceki ölçü`
    );
  }

  for (const nameKey of patientNameKeys(patient)) {
    if (nameKey && nameKey === groupKey) {
      score = Math.max(score, 88);
      reasons.add("dosya öneki eşleşmesi");
    } else if (nameKey.length >= 5 && groupKey.startsWith(nameKey)) {
      score = Math.max(score, 84);
      reasons.add("isim öneki + sürüm");
    } else if (nameKey.length >= 5 && groupCanonical === nameKey) {
      score = Math.max(score, 86);
      reasons.add("isim öneki eşleşmesi");
    }
  }

  const tokenOverlap = scoreNameTokenOverlap(groupKey, patient);
  if (tokenOverlap.score > 0) {
    score = Math.max(score, tokenOverlap.score);
    reasons.add(tokenOverlap.reason);
  }

  const fuzzyName = scoreFuzzySimilarity(groupCanonical, patient, links);
  if (fuzzyName.score > 0) {
    score = Math.max(score, fuzzyName.score);
    reasons.add(fuzzyName.reason);
  }

  const { surname, firstName } = splitPatientName(group.suggestedName, group.fileStem);
  const normSurname = normalizeStemKey(surname);
  const normFirst = normalizeStemKey(firstName);
  const patSurname = normalizeStemKey(patient.surname);
  const patFirst = normalizeStemKey(patient.first_name);

  if (normSurname && patSurname && normSurname === patSurname) {
    if (normFirst && firstName !== "—" && patFirst && normFirst === patFirst) {
      score = Math.max(score, exactStemCount > 0 || fuzzyStemCount > 0 ? score : 82);
      reasons.add("ad soyad eşleşmesi");
    } else {
      score = Math.max(score, 65);
      reasons.add("soyad eşleşmesi");
    }
  }

  const patientKey = patientNameKeys(patient)[0] || "";
  if (patientKey.length >= 5 && groupKey.includes(patientKey)) {
    score = Math.max(score, 76);
    reasons.add("isim öneki benzer");
  }

  if (patSurname.length >= 4 && groupKey.includes(patSurname) && score < 60) {
    score = Math.max(score, 58);
    reasons.add("benzer önek");
  }

  return { score, reasons: [...reasons] };
}

/** Bekleyen grup için skorlanmış hasta listesi */
export function suggestPatientsForGroup(
  group,
  patients,
  scanLinks,
  { limit = 3, stemAliases = null, stemRejections = null } = {}
) {
  if (!group?.pendingCount || !patients?.length) return [];

  return patients
    .map((patient) => {
      const { score, reasons } = scorePatientForGroup(
        group,
        patient,
        scanLinks,
        stemAliases,
        stemRejections
      );
      return {
        patient,
        score,
        reasons,
        label: patientListLabel(patient),
      };
    })
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Grup kartında gösterilecek en iyi öneri */
export function topPatientSuggestion(
  group,
  patients,
  scanLinks,
  stemAliases = null,
  stemRejections = null
) {
  const top = suggestPatientsForGroup(group, patients, scanLinks, {
    limit: 1,
    stemAliases,
    stemRejections,
  })[0];
  if (!top || top.score < MIN_DISPLAY_SCORE) return null;
  return top;
}
