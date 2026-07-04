import {
  DEFAULT_DENTAL_TREATMENTS,
  TREATMENT_COLOR_KEYS,
} from "./config/dentalTreatments.js";

/** @typedef {{ id: string, label: string, abbr: string, color?: string }} TreatmentDef */

export function cloneDefaultTreatments() {
  return DEFAULT_DENTAL_TREATMENTS.map(({ id, label, abbr, color }) => ({
    id,
    label,
    abbr,
    color,
  }));
}

export function normalizeTreatments(list) {
  if (!Array.isArray(list) || list.length === 0) return cloneDefaultTreatments();
  return list.map((item, index) => ({
    id: String(item?.id || `item_${index + 1}`).trim(),
    label: String(item?.label || "").trim(),
    abbr: String(item?.abbr || "").trim().slice(0, 2),
    color: TREATMENT_COLOR_KEYS.includes(item?.color) ? item.color : TREATMENT_COLOR_KEYS[index % TREATMENT_COLOR_KEYS.length],
  }));
}

function slugId(label, existingIds) {
  const ascii = label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

  let base = ascii || `protez_${Date.now().toString(36)}`;
  let id = base;
  let n = 2;
  while (existingIds.has(id)) {
    id = `${base}_${n++}`;
  }
  return id;
}

/** @param {TreatmentDef[]} list */
export function validateTreatments(list) {
  if (!list.length) {
    return { ok: false, message: "En az bir protez tipi olmalı." };
  }

  const ids = new Set();
  for (const item of list) {
    if (!item.label) {
      return { ok: false, message: "Tüm protez tiplerinin adı dolu olmalı." };
    }
    if (!item.abbr) {
      return { ok: false, message: `"${item.label}" için kısaltma (harf) gerekli.` };
    }
    if (!item.id) {
      return { ok: false, message: `"${item.label}" için kimlik (id) gerekli.` };
    }
    if (ids.has(item.id)) {
      return { ok: false, message: `Yinelenen id: ${item.id}` };
    }
    ids.add(item.id);
  }

  return { ok: true };
}

function colorOptions(selected) {
  return TREATMENT_COLOR_KEYS.map(
    (key) => `<option value="${key}" ${selected === key ? "selected" : ""}>${key}</option>`
  ).join("");
}

function renderRow(item, index, total) {
  return `
    <div class="dental-treatment-row" data-index="${index}">
      <div class="dental-treatment-row-main">
        <div class="dental-treatment-field dental-treatment-field-label">
          <span class="dental-treatment-field-label-text">Ad</span>
          <input type="text" class="settings-input dental-treatment-label" value="${escapeAttr(item.label)}" placeholder="Kron" />
        </div>
        <div class="dental-treatment-field dental-treatment-field-abbr">
          <span class="dental-treatment-field-label-text">Harfi</span>
          <input type="text" class="settings-input dental-treatment-abbr" maxlength="2" value="${escapeAttr(item.abbr)}" placeholder="K" />
        </div>
        <div class="dental-treatment-field dental-treatment-field-color">
          <span class="dental-treatment-field-label-text">Renk</span>
          <select class="settings-input dental-treatment-color">${colorOptions(item.color)}</select>
        </div>
      </div>
      <div class="dental-treatment-row-meta">
        <span class="dental-treatment-id" title="Vakada saklanan kimlik">${escapeHtml(item.id)}</span>
        <button type="button" class="dental-treatment-remove mp-btn-ghost text-[10px] px-2 py-1 rounded text-red-400"
          ${total <= 1 ? "disabled" : ""} title="Listeden kaldır">Sil</button>
      </div>
    </div>`;
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * @param {HTMLElement} container
 * @param {TreatmentDef[]} treatments
 * @param {(list: TreatmentDef[]) => void} onChange
 */
export function mountDentalTreatmentsEditor(container, treatments, onChange) {
  let list = normalizeTreatments(treatments);

  function emit() {
    onChange([...list]);
  }

  function render() {
    container.innerHTML = `
      <p class="text-[11px] mp-text-faint leading-relaxed mb-3">
        Planlama chart paletinde görünen protez tipleri. Eski vakalarda kaldırılan tipler <strong>?</strong> ile gösterilir.
      </p>
      <div class="dental-treatment-list space-y-2">${list.map((item, i) => renderRow(item, i, list.length)).join("")}</div>
      <button type="button" id="btn-add-dental-treatment" class="settings-btn-secondary w-full mt-3">+ Yeni protez tipi</button>`;

    container.querySelectorAll(".dental-treatment-label").forEach((input) => {
      input.addEventListener("input", (e) => {
        const row = e.target.closest(".dental-treatment-row");
        const index = Number(row?.dataset.index);
        if (Number.isNaN(index)) return;
        list[index].label = e.target.value;
        emit();
      });
    });

    container.querySelectorAll(".dental-treatment-abbr").forEach((input) => {
      input.addEventListener("input", (e) => {
        const row = e.target.closest(".dental-treatment-row");
        const index = Number(row?.dataset.index);
        if (Number.isNaN(index)) return;
        list[index].abbr = e.target.value.slice(0, 2);
        emit();
      });
    });

    container.querySelectorAll(".dental-treatment-color").forEach((select) => {
      select.addEventListener("change", (e) => {
        const row = e.target.closest(".dental-treatment-row");
        const index = Number(row?.dataset.index);
        if (Number.isNaN(index)) return;
        list[index].color = e.target.value;
        emit();
      });
    });

    container.querySelectorAll(".dental-treatment-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const row = e.target.closest(".dental-treatment-row");
        const index = Number(row?.dataset.index);
        if (Number.isNaN(index) || list.length <= 1) return;
        list.splice(index, 1);
        render();
        emit();
      });
    });

    container.querySelector("#btn-add-dental-treatment")?.addEventListener("click", () => {
      const ids = new Set(list.map((t) => t.id));
      const label = "Yeni protez";
      list.push({
        id: slugId(label, ids),
        label,
        abbr: "Y",
        color: TREATMENT_COLOR_KEYS[list.length % TREATMENT_COLOR_KEYS.length],
      });
      render();
      emit();
      const inputs = container.querySelectorAll(".dental-treatment-label");
      inputs[inputs.length - 1]?.focus();
      inputs[inputs.length - 1]?.select();
    });
  }

  render();

  return {
    getTreatments() {
      return normalizeTreatments(list);
    },
    setTreatments(next) {
      list = normalizeTreatments(next);
      render();
    },
  };
}
