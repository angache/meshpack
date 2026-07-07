/**
 * Jaro-Winkler benzerliği (0–1). Kısa isim önekleri için uygun.
 * Harici bağımlılık yok — Tauri/WASM uyumlu.
 */

function jaro(s1, s2) {
  if (s1 === s2) return 1;
  if (!s1.length || !s2.length) return 0;

  const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (!matches) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (
    (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3
  );
}

/** @returns {number} 0–1 */
export function jaroWinkler(a, b, { prefixScale = 0.1, maxPrefix = 4 } = {}) {
  const s1 = String(a || "");
  const s2 = String(b || "");
  if (!s1.length || !s2.length) return 0;

  const j = jaro(s1, s2);
  let prefix = 0;
  for (let i = 0; i < Math.min(maxPrefix, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return j + prefix * prefixScale * (1 - j);
}

/** Aday listeden en yüksek benzerlik */
export function bestStringSimilarity(needle, haystack) {
  if (!needle || !haystack?.length) return 0;
  let best = 0;
  for (const candidate of haystack) {
    if (!candidate) continue;
    best = Math.max(best, jaroWinkler(needle, candidate));
  }
  return best;
}
