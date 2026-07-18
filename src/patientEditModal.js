/** Hasta demografik bilgileri — ana iş akışından ayrı düzenleme penceresi */

let saveHandler = null;
let deleteHandler = null;

function $(id) {
  return document.getElementById(id);
}

function modalEl() {
  return $("patient-edit-modal");
}

export function closePatientEditModal() {
  modalEl()?.classList.add("hidden");
  saveHandler = null;
  deleteHandler = null;
}

function readForm() {
  return {
    surname: $("patient-edit-surname")?.value?.trim() ?? "",
    firstName: $("patient-edit-first-name")?.value?.trim() ?? "",
    notes: $("patient-edit-notes")?.value?.trim() ?? "",
  };
}

function fillForm(patient) {
  if ($("patient-edit-surname")) $("patient-edit-surname").value = patient?.surname || "";
  if ($("patient-edit-first-name")) $("patient-edit-first-name").value = patient?.first_name || "";
  if ($("patient-edit-notes")) $("patient-edit-notes").value = patient?.notes || "";
}

export function openPatientEditModal(patient, { onSave, onDelete } = {}) {
  if (!patient) return;
  saveHandler = onSave;
  deleteHandler = onDelete;
  fillForm(patient);
  modalEl()?.classList.remove("hidden");
  $("patient-edit-surname")?.focus();
}

export function initPatientEditModal() {
  $("btn-patient-edit-cancel")?.addEventListener("click", () => closePatientEditModal());

  $("patient-edit-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "patient-edit-modal") closePatientEditModal();
  });

  $("btn-patient-edit-save")?.addEventListener("click", async () => {
    if (!saveHandler) return;
    const data = readForm();
    const ok = await saveHandler(data);
    if (ok !== false) closePatientEditModal();
  });

  $("btn-patient-edit-delete")?.addEventListener("click", async () => {
    if (!deleteHandler) return;
    const ok = await deleteHandler();
    if (ok !== false) closePatientEditModal();
  });

  $("patient-edit-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    $("btn-patient-edit-save")?.click();
  });
}
