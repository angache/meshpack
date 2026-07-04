/** VITA diş rengi skalaları — resmi tablo düzeni */

export const VITA_CLASSICAL = {
  id: "classical",
  label: "VITA Classical",
  groups: [
    { label: "A — kırmızımsı kahve", shades: ["A1", "A2", "A3", "A3.5", "A4"] },
    { label: "B — kırmızımsı sarı", shades: ["B1", "B2", "B3", "B4"] },
    { label: "C — gri", shades: ["C1", "C2", "C3", "C4"] },
    { label: "D — kırmızımsı gri", shades: ["D2", "D3", "D4"] },
  ],
};

/** VITA SYSTEM 3D-Master (26 doğal + 3 bleached) */
export const VITA_3D_MASTER = {
  id: "3d-master",
  label: "VITA 3D-Master",
  groups: [
    { label: "Bleached (0)", shades: ["0M1", "0M2", "0M3"] },
    { label: "Seviye 1", shades: ["1M1", "1M2"] },
    {
      label: "Seviye 2",
      shades: ["2L1.5", "2L2.5", "2M1", "2M2", "2M3", "2R1.5", "2R2.5"],
    },
    {
      label: "Seviye 3",
      shades: ["3L1.5", "3L2.5", "3M1", "3M2", "3M3", "3R1.5", "3R2.5"],
    },
    {
      label: "Seviye 4",
      shades: ["4L1.5", "4L2.5", "4M1", "4M2", "4M3", "4R1.5", "4R2.5"],
    },
    { label: "Seviye 5", shades: ["5M1", "5M2", "5M3"] },
  ],
};

const CLASSICAL_FLAT = VITA_CLASSICAL.groups.flatMap((g) => g.shades);
const MASTER_FLAT = VITA_3D_MASTER.groups.flatMap((g) => g.shades);

/** Eski/yanlış yazımları düzelt (OM1 → 0M1) */
export function normalizeShadeCode(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (v === "OM1") return "0M1";
  if (v === "OM2") return "0M2";
  if (v === "OM3") return "0M3";
  if (v === "A3,5") return "A3.5";
  return v;
}

export function detectVitaScale(value) {
  const shade = normalizeShadeCode(value);
  if (!shade) return VITA_CLASSICAL.id;
  if (CLASSICAL_FLAT.includes(shade)) return VITA_CLASSICAL.id;
  if (MASTER_FLAT.includes(shade)) return VITA_3D_MASTER.id;
  return VITA_CLASSICAL.id;
}

export function isKnownVitaShade(value) {
  const shade = normalizeShadeCode(value);
  return CLASSICAL_FLAT.includes(shade) || MASTER_FLAT.includes(shade);
}

export function populateShadeSelect(selectEl, scale, selectedValue = "") {
  if (!selectEl) return;
  const shade = normalizeShadeCode(selectedValue);
  selectEl.innerHTML = '<option value="">— Seçin —</option>';

  for (const group of scale.groups) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    for (const code of group.shades) {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = code;
      optgroup.appendChild(opt);
    }
    selectEl.appendChild(optgroup);
  }

  if (shade && !isKnownVitaShade(shade)) {
    const opt = document.createElement("option");
    opt.value = shade;
    opt.textContent = `${shade} (özel)`;
    selectEl.appendChild(opt);
  }

  selectEl.value = shade;
}
