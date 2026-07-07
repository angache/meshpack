import { listActivityLog, logCategoryLabel, LOG_CATEGORY_LABELS } from "./activityLog.js";

let activeCategory = "all";

function formatLogTime(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp * 1000).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderFilterChips() {
  const wrap = document.getElementById("activity-log-filters");
  if (!wrap) return;

  wrap.innerHTML = Object.entries(LOG_CATEGORY_LABELS)
    .map(
      ([id, label]) =>
        `<button type="button" class="activity-log-filter${id === activeCategory ? " is-active" : ""}" data-log-category="${id}">${label}</button>`
    )
    .join("");

  wrap.querySelectorAll("[data-log-category]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      activeCategory = btn.dataset.logCategory;
      renderFilterChips();
      await refreshActivityLog();
    });
  });
}

function renderEntries(entries) {
  const listEl = document.getElementById("audit-log-list");
  if (!listEl) return;

  if (!entries.length) {
    listEl.innerHTML = `<p class="text-xs mp-text-muted">Henüz kayıt yok.</p>`;
    return;
  }

  listEl.innerHTML = entries
    .map((entry) => {
      const details = entry.details
        ? `<p class="audit-log-reason">${entry.details}</p>`
        : "";
      return `
      <article class="audit-log-entry">
        <div class="audit-log-head">
          <time class="audit-log-time">${formatLogTime(entry.created_at)}</time>
          <span class="activity-log-category">${logCategoryLabel(entry.category)}</span>
        </div>
        ${entry.user_name ? `<p class="audit-log-user">👤 ${entry.user_name}</p>` : ""}
        <p class="audit-log-detail">${entry.summary}</p>
        ${details}
      </article>`;
    })
    .join("");
}

export async function refreshActivityLog() {
  const listEl = document.getElementById("audit-log-list");
  if (!listEl) return;

  listEl.innerHTML = `<p class="text-xs mp-text-muted">Yükleniyor…</p>`;

  try {
    const category = activeCategory === "all" ? null : activeCategory;
    const entries = await listActivityLog(150, category);
    renderEntries(entries);
  } catch (err) {
    listEl.innerHTML = `<p class="text-xs text-red-400">Kayıtlar yüklenemedi: ${err}</p>`;
  }
}

export function initAuditLogUI() {
  renderFilterChips();
  document.getElementById("btn-audit-refresh")?.addEventListener("click", () => refreshActivityLog());
}

/** @deprecated use refreshActivityLog */
export const refreshAuditLog = refreshActivityLog;
