/** Vaka ve eşleştirme modalları */

let sameDayResolver = null;
let auditResolver = null;

function resetAuditModal() {
  const title = document.getElementById("audit-modal-title");
  const confirm = document.getElementById("btn-reassign-confirm");
  if (title) title.textContent = "Eşleştirmeyi düzelt";
  if (confirm) confirm.textContent = "Onayla";
}

function closeAuditModal() {
  document.getElementById("reassign-scan-modal")?.classList.add("hidden");
  resetAuditModal();
}

export function initCaseModals() {
  document.getElementById("btn-same-day-add")?.addEventListener("click", () => {
    document.getElementById("same-day-case-modal")?.classList.add("hidden");
    sameDayResolver?.("add");
    sameDayResolver = null;
  });
  document.getElementById("btn-same-day-new")?.addEventListener("click", () => {
    document.getElementById("same-day-case-modal")?.classList.add("hidden");
    sameDayResolver?.("new");
    sameDayResolver = null;
  });
  document.getElementById("btn-same-day-cancel")?.addEventListener("click", () => {
    document.getElementById("same-day-case-modal")?.classList.add("hidden");
    sameDayResolver?.("cancel");
    sameDayResolver = null;
  });

  document.getElementById("btn-reassign-confirm")?.addEventListener("click", () => {
    const reason = document.getElementById("reassign-reason")?.value?.trim() || "";
    if (reason.length < 3) {
      alert("Lütfen en az 3 karakterlik bir gerekçe yazın.");
      return;
    }
    closeAuditModal();
    auditResolver?.(reason);
    auditResolver = null;
  });
  document.getElementById("btn-reassign-cancel")?.addEventListener("click", () => {
    closeAuditModal();
    auditResolver?.(null);
    auditResolver = null;
  });
}

function askAuditReason({ title, message, confirmLabel }) {
  return new Promise((resolve) => {
    auditResolver = resolve;
    const modal = document.getElementById("reassign-scan-modal");
    const titleEl = document.getElementById("audit-modal-title");
    const text = document.getElementById("reassign-scan-text");
    const input = document.getElementById("reassign-reason");
    const confirm = document.getElementById("btn-reassign-confirm");

    if (titleEl) titleEl.textContent = title;
    if (text) text.textContent = message;
    if (confirm) confirm.textContent = confirmLabel;
    if (input) input.value = "";
    modal?.classList.remove("hidden");
    input?.focus();
  });
}

/** @returns {Promise<'add'|'new'|'cancel'>} */
export function askSameDayCase(existingCase) {
  return new Promise((resolve) => {
    sameDayResolver = resolve;
    const modal = document.getElementById("same-day-case-modal");
    const text = document.getElementById("same-day-case-text");
    if (text) {
      text.textContent = `Bu hasta için ${existingCase.session_day} tarihinde zaten bir vaka var (${existingCase.case_number}, ${existingCase.scan_count ?? 0} dosya). Yeni ölçüyü nereye ekleyelim?`;
    }
    modal?.classList.remove("hidden");
  });
}

/** @returns {Promise<string|null>} gerekçe veya iptal */
export function askReassignReason(fromLabel, toLabel) {
  return askAuditReason({
    title: "Eşleştirmeyi düzelt",
    message: `Bu ölçü şu an "${fromLabel}" hastasına bağlı. "${toLabel}" hastasına taşınacak. Bu işlem kayıt altına alınır.`,
    confirmLabel: "Taşı ve kaydet",
  });
}

/** @returns {Promise<string|null>} gerekçe veya iptal */
export function askDetachReason(filename, patientLabel) {
  return askAuditReason({
    title: "Ölçüyü kaldır",
    message: `"${filename}" dosyası ${patientLabel} vakasından kaldırılacak ve bekleyen ölçülere dönecek. Bu işlem kayıt altına alınır.`,
    confirmLabel: "Kaldır",
  });
}
