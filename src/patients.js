import { invoke } from "@tauri-apps/api/core";
import { splitPatientName } from "./utils.js";

export async function listPatients() {
  return invoke("list_patients");
}

export async function createPatient(surname, firstName, notes = "") {
  return invoke("create_patient", { surname, firstName, notes });
}

export async function updatePatient(id, surname, firstName, notes = "") {
  return invoke("update_patient", { id, surname, firstName, notes });
}

export async function deletePatient(id) {
  return invoke("delete_patient", { id });
}

export async function listScanLinks() {
  return invoke("list_scan_links");
}

export async function listPatientScans(patientId) {
  return invoke("list_patient_scans", { patientId });
}

export async function createPatientFromGroup(group) {
  const { surname, firstName } = splitPatientName(group.suggestedName, group.fileStem);
  return createPatient(surname === "—" ? "" : surname, firstName === "—" ? "" : firstName, "");
}

export function patientDisplayName(patient) {
  const parts = [patient.surname, patient.first_name].filter(Boolean);
  return parts.length ? parts.join(" ") : "Yeni hasta";
}

export function patientListLabel(patient) {
  const s = patient.surname?.trim();
  const f = patient.first_name?.trim();
  if (s && f) return `${s}, ${f}`;
  return patientDisplayName(patient);
}
