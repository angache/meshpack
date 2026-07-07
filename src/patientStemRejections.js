import { invoke } from "@tauri-apps/api/core";

export async function listStemRejections() {
  return invoke("list_stem_rejections");
}

export async function rejectStemSuggestion(fileStem, patientId) {
  return invoke("reject_stem_suggestion", { fileStem, patientId });
}

/** `${stemKey}:${patientId}` kümesi */
export function buildStemRejectionSet(rejections) {
  const set = new Set();
  for (const row of rejections || []) {
    set.add(`${row.stem_key}:${row.patient_id}`);
  }
  return set;
}
