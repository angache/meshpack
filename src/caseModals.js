/** Vaka ve eşleştirme modalları */
import { SCAN_LABELS } from "./utils.js";

let sameDayResolver = null;
let auditResolver = null;
let linkConfirmResolver = null;

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

function closeLinkConfirmModal() {
  document.getElementById("link-scan-confirm-modal")?.classList.add("hidden");
  const ack = document.getElementById("link-scan-confirm-ack");
  const btn = document.getElementById("btn-link-scan-confirm");
  if (ack) ack.checked = false;
  if (btn) btn.disabled = true;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

  const ack = document.getElementById("link-scan-confirm-ack");
  const confirmBtn = document.getElementById("btn-link-scan-confirm");
  ack?.addEventListener("change", () => {
    if (confirmBtn) confirmBtn.disabled = !ack.checked;
  });
  confirmBtn?.addEventListener("click", () => {
    if (!ack?.checked) return;
    closeLinkConfirmModal();
    linkConfirmResolver?.(true);
    linkConfirmResolver = null;
  });
  document.getElementById("btn-link-scan-cancel")?.addEventListener("click", () => {
    closeLinkConfirmModal();
    linkConfirmResolver?.(false);
    linkConfirmResolver = null;
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
export function askSameDayCase(existingCase, { addingFiles = 1 } = {}) {
  return new Promise((resolve) => {
    sameDayResolver = resolve;
    const modal = document.getElementById("same-day-case-modal");
    const text = document.getElementById("same-day-case-text");
    const count = existingCase.scan_count ?? 0;
    if (text) {
      text.textContent =
        addingFiles > 1
          ? `Bu hastanın ${existingCase.session_day} tarihli vakasında (${existingCase.case_number}) şu an ${count} dosya var. Eklediğiniz ${addingFiles} dosya (üst/alt/kapanış vb.) aynı tarama oturumunun parçasıysa «Mevcut vakaya ekle»yi seçin. Gerçekten ayrı bir randevu ise «Yeni vaka» açın.`
          : `Bu hastanın ${existingCase.session_day} tarihinde zaten bir vakası var (${existingCase.case_number}, ${count} dosya). Bu dosyayı mevcut vakaya mı ekleyelim, yoksa aynı gün için ayrı yeni vaka mı açalım?`;
    }
    modal?.classList.remove("hidden");
  });
}

/**
 * Bağlama öncesi zorunlu özet.
 * @param {{ patientLabel: string, isNewPatient?: boolean, files: object[], completeness?: object }} opts
 * @returns {Promise<boolean>}
 */
export function askLinkScanSetConfirm({ patientLabel, isNewPatient = false, files = [], completeness = null }) {
  return new Promise((resolve) => {
    linkConfirmResolver = resolve;
    const modal = document.getElementById("link-scan-confirm-modal");
    const patientEl = document.getElementById("link-scan-confirm-patient");
    const filesEl = document.getElementById("link-scan-confirm-files");
    const warnEl = document.getElementById("link-scan-confirm-warning");
    const ack = document.getElementById("link-scan-confirm-ack");
    const confirmBtn = document.getElementById("btn-link-scan-confirm");

    if (patientEl) {
      patientEl.textContent = isNewPatient ? `Yeni hasta: ${patientLabel}` : patientLabel;
    }

    if (filesEl) {
      filesEl.innerHTML = files
        .map((f) => {
          const type = f.scanType || "unknown";
          const label =
            SCAN_LABELS[type] || (f.scanRole === "pretreatment" || f.isPreop ? "Preop" : "Diğer");
          return `<li><span class="scan-link-confirm-type">${escapeHtml(label)}</span> ${escapeHtml(f.filename)}</li>`;
        })
        .join("");
    }

    if (warnEl) {
      if (completeness && !completeness.isComplete) {
        warnEl.classList.remove("hidden");
        warnEl.textContent = `Eksik: ${completeness.missing.join(", ")}. Yanlış veya eksik set laboratuvara gidebilir.`;
      } else {
        warnEl.classList.add("hidden");
        warnEl.textContent = "";
      }
    }

    if (ack) ack.checked = false;
    if (confirmBtn) confirmBtn.disabled = true;
    modal?.classList.remove("hidden");
  });
}

/** @returns {Promise<string|null>} gerekçe veya iptal */
export function askReassignReason(fromLabel, toLabel, { fileCount = 1 } = {}) {
  const subject = fileCount > 1 ? `${fileCount} dosya` : "Bu dosya";
  return askAuditReason({
    title: "Eşleştirmeyi düzelt",
    message: `${subject} şu an "${fromLabel}" hastasına bağlı. "${toLabel}" hastasına taşınacak. Bu işlem kayıt altına alınır.`,
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

/** @returns {Promise<string|null>} gerekçe veya iptal */
export function askDismissGroupReason(groupLabel, fileCount) {
  return askAuditReason({
    title: "Listeden kaldır",
    message: `"${groupLabel}" grubu (${fileCount} dosya) ölçü listesinden gizlenecek. Dosyalar izleme klasöründe kalır; aynı güne yeni dosya eklerseniz grup yeniden görünür.`,
    confirmLabel: "Listeden kaldır",
  });
}

/** @returns {Promise<string|null>} gerekçe veya iptal */
export function askDeleteCaseReason(caseNumber, fileCount) {
  const filesNote = fileCount > 0 ? ` Bağlı ${fileCount} ölçü bekleyen listeye döner.` : "";
  return askAuditReason({
    title: "Vakayı kaldır",
    message: `${caseNumber} vakası silinecek.${filesNote} Planlama verisi de kaldırılır. Gönderilmiş vakalar kaldırılamaz.`,
    confirmLabel: "Vakayı kaldır",
  });
}
