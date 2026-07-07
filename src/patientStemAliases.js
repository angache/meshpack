import { invoke } from "@tauri-apps/api/core";

export async function listStemAliases() {
  return invoke("list_stem_aliases");
}

/** stem_key → { patient_id, hit_count, source } */
export function buildStemAliasMap(aliases) {
  const map = new Map();
  for (const row of aliases || []) {
    map.set(row.stem_key, row);
  }
  return map;
}
