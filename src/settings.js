import { setLanguage, t } from "./i18n.js";
import { cloneDefaultTreatments } from "./settingsDentalTreatmentsUI.js";

export const DEFAULT_SETTINGS = {
  watch_folder: null,
  drive_connected: false,
  theme: "dark",
  font_size: "normal",
  font_family: "system",
  preview_width: 576,
  preview_height: 480,
  layout_order: "list-preview",
  layout_density: "comfortable",
  focus_on_new_scan: true,
  file_extensions: ["stl", "ply", "dcm"],
  drive_folder_name: "MeshPack",
  zip_name_template: "{patient}_{date}",
  after_upload: "none",
  archive_folder: null,
  auto_upload: false,
  visibility_upper: true,
  visibility_lower: true,
  visibility_bite: false,
  color_upper: "#c9b87a",
  color_lower: "#c9b87a",
  color_bite: "#d45c5c",
  camera_preset: "default",
  lower_jaw_offset_mm: 0,
  dental_treatments: cloneDefaultTreatments(),
  planning_preview_height: 480,
  language: "tr",
  start_fullscreen: false,
  session_timeout_min: 15,
};

/** @type {typeof DEFAULT_SETTINGS} */
let settings = { ...DEFAULT_SETTINGS };

const listeners = new Set();

export function getSettings() {
  return settings;
}

export function setSettings(partial) {
  settings = { ...settings, ...partial };
  listeners.forEach((fn) => fn(settings));
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function resolveTheme(theme) {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applySettings(s = settings) {
  const resolved = resolveTheme(s.theme);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.fontSize = s.font_size;
  document.documentElement.dataset.fontFamily = s.font_family;
  document.documentElement.dataset.density = s.layout_density;

  setLanguage(s.language);

  const previewPanel = document.getElementById("preview-panel");
  if (previewPanel) {
    previewPanel.style.width = `${s.preview_width}px`;
  }

  const viewerContainer = document.getElementById("viewer-container");
  if (viewerContainer?.classList.contains("viewer-compact")) {
    viewerContainer.style.height = `${s.preview_height}px`;
  }

  const planningViewer = document.getElementById("planning-viewer-container");
  if (planningViewer) {
    planningViewer.style.height = `${s.planning_preview_height}px`;
  }

  const main = document.getElementById("main-layout");
  const listPanel = document.getElementById("patient-list-panel");
  const detailPanel = document.getElementById("patient-detail-panel");
  const previewAside = document.getElementById("preview-panel");
  if (main && listPanel && detailPanel && previewAside) {
    const panels = [listPanel, detailPanel, previewAside];
    if (s.layout_order === "preview-list") {
      panels.sort((a, b) => {
        const order = { [previewAside.id]: 0, [detailPanel.id]: 1, [listPanel.id]: 2 };
        return order[a.id] - order[b.id];
      });
    } else {
      panels.sort((a, b) => {
        const order = { [listPanel.id]: 0, [detailPanel.id]: 1, [previewAside.id]: 2 };
        return order[a.id] - order[b.id];
      });
    }
    panels.forEach((panel) => main.appendChild(panel));
  }

  applyI18nToDom();
}

export function applyI18nToDom() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    if (key) el.placeholder = t(key);
  });
}

export function getDefaultVisibility() {
  return {
    upper: settings.visibility_upper,
    lower: settings.visibility_lower,
    bite: settings.visibility_bite,
  };
}

export function getSessionTimeoutMs() {
  return Math.max(1, settings.session_timeout_min) * 60 * 1000;
}

export function hexToNumber(hex) {
  return parseInt(hex.replace("#", ""), 16);
}

export function getDentalTreatments() {
  const list = settings.dental_treatments;
  if (Array.isArray(list) && list.length > 0) return list;
  return cloneDefaultTreatments();
}

export function settingsFromConfig(config) {
  const merged = { ...DEFAULT_SETTINGS, ...config };
  if (!Array.isArray(merged.dental_treatments) || merged.dental_treatments.length === 0) {
    merged.dental_treatments = cloneDefaultTreatments();
  }
  merged.planning_preview_height = Number(merged.planning_preview_height) || DEFAULT_SETTINGS.planning_preview_height;
  return merged;
}

export function settingsToPayload(s = settings) {
  return {
    watch_folder: s.watch_folder,
    drive_connected: s.drive_connected,
    theme: s.theme,
    font_size: s.font_size,
    font_family: s.font_family,
    preview_width: Number(s.preview_width),
    preview_height: Number(s.preview_height),
    layout_order: s.layout_order,
    layout_density: s.layout_density,
    focus_on_new_scan: !!s.focus_on_new_scan,
    file_extensions: Array.isArray(s.file_extensions)
      ? s.file_extensions
      : String(s.file_extensions || "stl,ply,dcm")
          .split(",")
          .map((e) => e.trim().replace(/^\./, ""))
          .filter(Boolean),
    drive_folder_name: s.drive_folder_name,
    zip_name_template: s.zip_name_template,
    after_upload: s.after_upload,
    archive_folder: s.archive_folder || null,
    auto_upload: !!s.auto_upload,
    visibility_upper: !!s.visibility_upper,
    visibility_lower: !!s.visibility_lower,
    visibility_bite: !!s.visibility_bite,
    color_upper: s.color_upper,
    color_lower: s.color_lower,
    color_bite: s.color_bite,
    camera_preset: s.camera_preset,
    lower_jaw_offset_mm: Number(s.lower_jaw_offset_mm) || 0,
    dental_treatments: Array.isArray(s.dental_treatments)
      ? s.dental_treatments.map((t) => ({
          id: String(t.id || "").trim(),
          label: String(t.label || "").trim(),
          abbr: String(t.abbr || "").trim().slice(0, 2),
          color: t.color || null,
        }))
      : cloneDefaultTreatments(),
    planning_preview_height: Math.min(900, Math.max(240, Number(s.planning_preview_height) || 480)),
    language: s.language,
    start_fullscreen: !!s.start_fullscreen,
    session_timeout_min: Number(s.session_timeout_min) || 15,
  };
}

// Sistem teması değişince güncelle
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
  if (settings.theme === "system") applySettings();
});
