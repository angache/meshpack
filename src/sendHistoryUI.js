import { listSentCases } from "./cases.js";

let openCaseHandler = null;

function formatSentAt(timestamp) {
  if (!timestamp) return "—";
  return new Date(timestamp * 1000).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function patientLabel(entry) {
  const surname = entry.patient_surname || "";
  const first = entry.patient_first_name || "";
  if (surname && first) return `${surname}, ${first}`;
  return surname || first || "—";
}

function renderEntries(entries) {
  const listEl = document.getElementById("send-history-list");
  if (!listEl) return;

  if (!entries.length) {
    listEl.innerHTML = `<p class="text-xs mp-text-muted">Henüz gönderilmiş vaka yok.</p>`;
    return;
  }

  listEl.innerHTML = entries
    .map(
      (entry) => `
    <article class="send-history-entry">
      <div class="send-history-head">
        <span class="send-history-case font-mono">${entry.case_number}</span>
        <time class="send-history-time">${formatSentAt(entry.sent_at)}</time>
      </div>
      <p class="send-history-patient">${patientLabel(entry)}</p>
      <button type="button" class="send-history-open text-[10px] text-medical-accent hover:underline"
        data-case-id="${entry.id}" data-patient-id="${entry.patient_id}">
        Görüntüle →
      </button>
    </article>`
    )
    .join("");

  listEl.querySelectorAll(".send-history-open").forEach((btn) => {
    btn.addEventListener("click", () => {
      const entry = entries.find(
        (e) => e.id === btn.dataset.caseId && e.patient_id === btn.dataset.patientId
      );
      if (entry) openCaseHandler?.(entry);
    });
  });
}

export async function refreshSendHistory() {
  const listEl = document.getElementById("send-history-list");
  if (!listEl) return;

  listEl.innerHTML = `<p class="text-xs mp-text-muted">Yükleniyor…</p>`;

  try {
    const entries = await listSentCases(50);
    renderEntries(entries);
  } catch (err) {
    listEl.innerHTML = `<p class="text-xs text-red-400">Geçmiş yüklenemedi: ${err}</p>`;
  }
}

export function initSendHistoryUI({ onOpenCase }) {
  openCaseHandler = onOpenCase;
  document.getElementById("btn-send-history-refresh")?.addEventListener("click", () =>
    refreshSendHistory()
  );
}
