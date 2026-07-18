/** FDI 11–48 dental chart — planlama sayfası */

import {
  buildTreatmentCatalog,
  defaultActiveTreatmentId,
  resolveTreatment,
} from "./config/dentalTreatments.js";
import { iconHtml } from "./icons.js";

export const FDI_UPPER_RIGHT = [18, 17, 16, 15, 14, 13, 12, 11];
export const FDI_UPPER_LEFT = [21, 22, 23, 24, 25, 26, 27, 28];
export const FDI_LOWER_LEFT = [31, 32, 33, 34, 35, 36, 37, 38];
export const FDI_LOWER_RIGHT = [48, 47, 46, 45, 44, 43, 42, 41];

export function emptyDentalPlan() {
  return { teeth: {} };
}

export function parseDentalPlan(raw) {
  if (!raw || raw === "{}") return emptyDentalPlan();
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!data || typeof data !== "object") return emptyDentalPlan();
    if (!data.teeth || typeof data.teeth !== "object") return emptyDentalPlan();
    return { teeth: { ...data.teeth } };
  } catch {
    return emptyDentalPlan();
  }
}

export function serializeDentalPlan(plan) {
  return JSON.stringify(plan?.teeth ? plan : emptyDentalPlan());
}

function toothTypeClass(num) {
  const d = num % 10;
  if (d >= 6) return "fdi-tooth-molar";
  if (d >= 4) return "fdi-tooth-premolar";
  if (d === 3) return "fdi-tooth-canine";
  return "fdi-tooth-incisor";
}

function renderTooth(num, plan, selected, catalog) {
  const key = String(num);
  const entry = plan.teeth[key];
  const meta = entry ? resolveTreatment(catalog, entry.treatment) : null;
  const selectedCls = selected === key ? "fdi-tooth-selected" : "";
  const treatmentCls = meta ? meta.cls : "";
  const typeCls = toothTypeClass(num);
  const abbr = meta ? meta.abbr : "";

  return `
    <button type="button"
      class="fdi-tooth ${typeCls} ${selectedCls} ${treatmentCls}"
      data-tooth="${key}"
      aria-label="Diş ${num}${meta ? `, ${meta.label}` : ""}"
      title="${key}${meta ? ` · ${meta.label}` : ""}${meta?.unknown ? " (tanımsız protez)" : ""} · Shift+tık kaldır">
      <span class="fdi-tooth-crown"></span>
      <span class="fdi-tooth-num">${num}</span>
      ${abbr ? `<span class="fdi-tooth-abbr">${abbr}</span>` : ""}
    </button>`;
}

function renderQuadrant(nums, plan, selected, catalog) {
  return nums.map((n) => renderTooth(n, plan, selected, catalog)).join("");
}

function planCount(plan) {
  return Object.keys(plan.teeth || {}).length;
}

function renderPalette(catalog, activeTreatment, selectedTooth, selEntry) {
  const activeMeta = resolveTreatment(catalog, activeTreatment);
  const selMeta = selEntry ? resolveTreatment(catalog, selEntry.treatment) : null;

  return `
    <div class="fdi-palette">
      <div class="fdi-palette-head">
        <span class="fdi-palette-title">Protez tipi seçin, ardından dişe tıklayın</span>
        ${
          selectedTooth
            ? `<span class="fdi-palette-focus">Seçili: <strong>${selectedTooth}</strong>${selMeta ? ` · ${selMeta.label}` : ""}</span>`
            : activeTreatment
              ? `<span class="fdi-palette-focus">Fırça: <strong>${activeMeta.label}</strong></span>`
              : ""
        }
      </div>
      <div class="fdi-palette-grid">
        ${catalog
          .map(
            (t) => `
          <button type="button"
            class="fdi-palette-btn ${t.cls} ${activeTreatment === t.id ? "fdi-palette-active" : ""}"
            data-pick-treatment="${t.id}"
            title="${t.label} — dişlere uygulamak için seçin">
            <span class="fdi-palette-abbr">${t.abbr}</span>
            <span class="fdi-palette-label">${t.label}</span>
          </button>`
          )
          .join("")}
      </div>
    </div>`;
}

function renderSummary(plan, catalog) {
  const entries = Object.entries(plan.teeth || {}).sort(([a], [b]) => Number(a) - Number(b));
  if (!entries.length) {
    return `<p class="fdi-summary-empty">Planlanmış diş yok. Üstten protez tipi seçip chart üzerinde dişlere tıklayın.</p>`;
  }
  return `
    <div class="fdi-summary-chips">
      ${entries
        .map(([num, entry]) => {
          const meta = resolveTreatment(catalog, entry.treatment);
          return `
          <span class="fdi-chip ${meta.cls}${meta.unknown ? " fdi-chip-unknown" : ""}">
            <span class="fdi-chip-num">${num}</span>
            <span class="fdi-chip-label">${meta.label}</span>
            <button type="button" class="fdi-chip-remove mp-btn-with-icon" data-remove-tooth="${num}" title="Kaldır">${iconHtml("x", { size: 12, className: "mp-icon mp-icon-xs" })}</button>
          </span>`;
        })
        .join("")}
    </div>`;
}

function renderLegend(catalog) {
  return catalog
    .map(
      (t) => `
      <span class="fdi-legend-item ${t.cls}">
        <span class="fdi-legend-dot"></span>${t.label}
      </span>`
    )
    .join("");
}

/**
 * @param {HTMLElement} root
 * @param {{ plan?: object, onChange?: (plan: object) => void, treatments?: import('./config/dentalTreatments.js').DentalTreatment[] }} options
 */
export function createDentalChart(root, { plan = emptyDentalPlan(), onChange, treatments } = {}) {
  const catalog = buildTreatmentCatalog(treatments);

  let state = {
    plan: parseDentalPlan(plan),
    selected: null,
    activeTreatment: defaultActiveTreatmentId(catalog),
    readOnly: false,
  };

  function emitChange() {
    onChange?.(state.plan);
  }

  function applyTreatment(toothKey, treatmentId) {
    if (!treatmentId) return;
    const existing = state.plan.teeth[toothKey];
    if (existing?.treatment === treatmentId) {
      delete state.plan.teeth[toothKey];
    } else {
      state.plan.teeth[toothKey] = { treatment: treatmentId };
    }
    emitChange();
  }

  function render() {
    const sel = state.selected;
    const selEntry = sel ? state.plan.teeth[sel] : null;
    const count = planCount(state.plan);

    if (!catalog.some((t) => t.id === state.activeTreatment)) {
      state.activeTreatment = defaultActiveTreatmentId(catalog);
    }

    root.innerHTML = `
      <div class="fdi-shell">
        <div class="fdi-shell-head">
          <div>
            <span class="fdi-shell-title">Protez planı</span>
            <span class="fdi-shell-hint">Oklüzal chart · FDI · hasta perspektifi</span>
          </div>
          <div class="fdi-shell-actions">
            ${count ? `<span class="fdi-plan-badge">${count} diş</span>` : ""}
            ${count ? `<button type="button" class="fdi-clear-all" data-action="clear-all">Tümünü temizle</button>` : ""}
          </div>
        </div>

        ${renderPalette(catalog, state.activeTreatment, sel, selEntry)}

        <div class="fdi-occlusal-wrap">
          <div class="fdi-occlusal-label fdi-occlusal-label-upper">Üst çene</div>
          <div class="fdi-chart">
            <div class="fdi-arch fdi-arch-upper">
              <div class="fdi-quadrant fdi-quadrant-ur">
                <span class="fdi-quadrant-tag">Sağ</span>
                ${renderQuadrant(FDI_UPPER_RIGHT, state.plan, sel, catalog)}
              </div>
              <div class="fdi-midline" aria-hidden="true">
                <span class="fdi-midline-label">Orta hat</span>
              </div>
              <div class="fdi-quadrant fdi-quadrant-ul">
                <span class="fdi-quadrant-tag">Sol</span>
                ${renderQuadrant(FDI_UPPER_LEFT, state.plan, sel, catalog)}
              </div>
            </div>
            <div class="fdi-arch-divider" aria-hidden="true"></div>
            <div class="fdi-arch fdi-arch-lower">
              <div class="fdi-quadrant fdi-quadrant-lr">
                <span class="fdi-quadrant-tag">Sağ</span>
                ${renderQuadrant(FDI_LOWER_RIGHT, state.plan, sel, catalog)}
              </div>
              <div class="fdi-midline fdi-midline-lower" aria-hidden="true"></div>
              <div class="fdi-quadrant fdi-quadrant-ll">
                <span class="fdi-quadrant-tag">Sol</span>
                ${renderQuadrant(FDI_LOWER_LEFT, state.plan, sel, catalog)}
              </div>
            </div>
          </div>
          <div class="fdi-occlusal-label fdi-occlusal-label-lower">Alt çene</div>
        </div>

        <div class="fdi-legend">${renderLegend(catalog)}</div>

        <div class="fdi-summary">
          <h4 class="fdi-summary-title">Plan özeti</h4>
          ${renderSummary(state.plan, catalog)}
        </div>
      </div>`;

    root.querySelectorAll("[data-pick-treatment]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (state.readOnly) return;
        state.activeTreatment = btn.dataset.pickTreatment;
        render();
      });
    });

    root.querySelectorAll("[data-tooth]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        if (state.readOnly) return;
        const tooth = btn.dataset.tooth;
        if (e.shiftKey) {
          delete state.plan.teeth[tooth];
          state.selected = tooth;
          emitChange();
          render();
          return;
        }
        if (state.activeTreatment) {
          applyTreatment(tooth, state.activeTreatment);
          state.selected = tooth;
          render();
          return;
        }
        state.selected = state.selected === tooth ? null : tooth;
        render();
      });
    });

    root.querySelectorAll("[data-remove-tooth]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        if (state.readOnly) return;
        e.stopPropagation();
        delete state.plan.teeth[btn.dataset.removeTooth];
        emitChange();
        render();
      });
    });

    root.querySelector("[data-action='clear-all']")?.addEventListener("click", () => {
      if (state.readOnly) return;
      if (!confirm("Tüm diş planı silinsin mi?")) return;
      state.plan = emptyDentalPlan();
      state.selected = null;
      emitChange();
      render();
    });
  }

  render();

  return {
    getPlan() {
      return state.plan;
    },
    setPlan(raw) {
      state.plan = parseDentalPlan(raw);
      state.selected = null;
      render();
    },
    setTreatments(defs) {
      catalog.length = 0;
      catalog.push(...buildTreatmentCatalog(defs));
      if (!catalog.some((t) => t.id === state.activeTreatment)) {
        state.activeTreatment = defaultActiveTreatmentId(catalog);
      }
      render();
    },
    setReadOnly(readonly) {
      state.readOnly = !!readonly;
      root.classList.toggle("fdi-chart-readonly", state.readOnly);
      render();
    },
  };
}
