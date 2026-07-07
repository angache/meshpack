import { open } from "@tauri-apps/plugin-dialog";
import { t } from "./i18n.js";
import {
  applySettings,
  getSettings,
  setSettings,
  settingsToPayload,
} from "./settings.js";
import {
  mountDentalTreatmentsEditor,
  validateTreatments,
} from "./settingsDentalTreatmentsUI.js";

let draft = null;
let activeTab = "appearance";
let dentalEditor = null;

const TAB_IDS = [
  "appearance",
  "layout",
  "watch",
  "upload",
  "cloud",
  "preview",
  "planning",
  "alignment",
  "general",
  "audit",
];

let onTabSwitch = null;

function $(id) {
  return document.getElementById(id);
}

function bindDraft() {
  draft = { ...getSettings() };
  fillForm();
  switchTab(activeTab);
}

function fillForm() {
  if (!draft) return;

  setVal("setting-theme", draft.theme);
  setVal("setting-font-size", draft.font_size);
  setVal("setting-font-family", draft.font_family);
  setVal("setting-preview-width", draft.preview_width);
  setVal("setting-preview-height", draft.preview_height);
  setVal("setting-layout-order", draft.layout_order);
  setVal("setting-layout-density", draft.layout_density);
  setVal("setting-watch-folder", draft.watch_folder || "");
  setCheck("setting-focus-new", draft.focus_on_new_scan);
  setVal(
    "setting-extensions",
    Array.isArray(draft.file_extensions)
      ? draft.file_extensions.join(", ")
      : draft.file_extensions
  );
  setVal("setting-drive-folder", draft.drive_folder_name);
  setVal("setting-zip-template", draft.zip_name_template);
  setVal("setting-after-upload", draft.after_upload);
  setVal("setting-archive-folder", draft.archive_folder || "");
  setCheck("setting-vis-upper", draft.visibility_upper);
  setCheck("setting-vis-lower", draft.visibility_lower);
  setCheck("setting-vis-bite", draft.visibility_bite);
  setVal("setting-color-upper", draft.color_upper);
  setVal("setting-color-lower", draft.color_lower);
  setVal("setting-color-bite", draft.color_bite);
  setVal("setting-camera-preset", draft.camera_preset);
  setVal("setting-lower-offset", draft.lower_jaw_offset_mm);
  setVal("setting-language", draft.language);
  setCheck("setting-start-fullscreen", draft.start_fullscreen);
  setVal("setting-session-timeout", draft.session_timeout_min);
  setVal("setting-planning-preview-height", draft.planning_preview_height);

  mountDentalEditor();
  toggleArchiveRow();
}

function mountDentalEditor() {
  const root = $("dental-treatments-editor");
  if (!root) return;
  dentalEditor = mountDentalTreatmentsEditor(root, draft.dental_treatments, (list) => {
    draft.dental_treatments = list;
  });
}

function readForm() {
  return {
    ...draft,
    theme: getVal("setting-theme"),
    font_size: getVal("setting-font-size"),
    font_family: getVal("setting-font-family"),
    preview_width: Number(getVal("setting-preview-width")),
    preview_height: Number(getVal("setting-preview-height")),
    layout_order: getVal("setting-layout-order"),
    layout_density: getVal("setting-layout-density"),
    watch_folder: getVal("setting-watch-folder") || null,
    focus_on_new_scan: getCheck("setting-focus-new"),
    file_extensions: getVal("setting-extensions")
      .split(",")
      .map((e) => e.trim().replace(/^\./, ""))
      .filter(Boolean),
    drive_folder_name: getVal("setting-drive-folder"),
    zip_name_template: getVal("setting-zip-template"),
    after_upload: getVal("setting-after-upload"),
    archive_folder: getVal("setting-archive-folder") || null,
    visibility_upper: getCheck("setting-vis-upper"),
    visibility_lower: getCheck("setting-vis-lower"),
    visibility_bite: getCheck("setting-vis-bite"),
    color_upper: getVal("setting-color-upper"),
    color_lower: getVal("setting-color-lower"),
    color_bite: getVal("setting-color-bite"),
    camera_preset: getVal("setting-camera-preset"),
    lower_jaw_offset_mm: Number(getVal("setting-lower-offset")) || 0,
    language: getVal("setting-language"),
    start_fullscreen: getCheck("setting-start-fullscreen"),
    session_timeout_min: Number(getVal("setting-session-timeout")) || 15,
    dental_treatments: dentalEditor?.getTreatments() || draft.dental_treatments,
    planning_preview_height: Number(getVal("setting-planning-preview-height")) || 480,
  };
}

function setVal(id, value) {
  const el = $(id);
  if (el) el.value = value ?? "";
}

function getVal(id) {
  return $(id)?.value ?? "";
}

function setCheck(id, checked) {
  const el = $(id);
  if (el) el.checked = !!checked;
}

function getCheck(id) {
  return !!$(id)?.checked;
}

function toggleArchiveRow() {
  const row = $("setting-archive-row");
  if (!row) return;
  row.classList.toggle("hidden", getVal("setting-after-upload") !== "archive");
}

function switchTab(tab) {
  if (!TAB_IDS.includes(tab)) tab = "appearance";
  activeTab = tab;
  TAB_IDS.forEach((id) => {
    $(`settings-tab-${id}`)?.classList.toggle("active", id === tab);
    $(`settings-panel-${id}`)?.classList.toggle("hidden", id !== tab);
  });
  onTabSwitch?.(tab);
}

export function openSettingsModal(initialTab = activeTab) {
  bindDraft();
  switchTab(initialTab);
  $("settings-modal")?.classList.remove("hidden");
}

export function closeSettingsModal() {
  $("settings-modal")?.classList.add("hidden");
}

export function initSettingsUI({ onSave, onDriveAuth, onIcpAlign, onTabSwitch: tabSwitchHandler }) {
  onTabSwitch = tabSwitchHandler;
  $("btn-settings")?.addEventListener("click", openSettingsModal);
  $("btn-settings-close")?.addEventListener("click", closeSettingsModal);
  $("btn-settings-cancel")?.addEventListener("click", closeSettingsModal);

  TAB_IDS.forEach((id) => {
    $(`settings-tab-${id}`)?.addEventListener("click", () => switchTab(id));
  });

  $("btn-pick-folder")?.addEventListener("click", async () => {
    const selected = await open({ directory: true, multiple: false, title: t("watch_folder") });
    if (selected) setVal("setting-watch-folder", selected);
  });

  $("btn-pick-archive")?.addEventListener("click", async () => {
    const selected = await open({ directory: true, multiple: false, title: t("archive_folder") });
    if (selected) setVal("setting-archive-folder", selected);
  });

  $("setting-after-upload")?.addEventListener("change", toggleArchiveRow);

  $("btn-drive-auth")?.addEventListener("click", () => onDriveAuth?.());

  $("btn-icp-align")?.addEventListener("click", () => onIcpAlign?.());

  $("btn-settings-save")?.addEventListener("click", async () => {
    const next = readForm();
    const check = validateTreatments(next.dental_treatments);
    if (!check.ok) {
      alert(check.message);
      switchTab("planning");
      return;
    }
    setSettings(next);
    applySettings(next);
    await onSave?.(settingsToPayload(next));
    closeSettingsModal();
  });

  $("settings-modal")?.addEventListener("click", (e) => {
    if (e.target === $("settings-modal")) closeSettingsModal();
  });
}

export function updateDriveStatus(connected, errorMsg) {
  const el = $("drive-status");
  if (!el) return;
  if (errorMsg) {
    el.textContent = errorMsg;
    el.className = "text-xs text-red-400 mt-1.5";
    return;
  }
  el.textContent = connected ? `✅ ${t("drive_connected")}` : t("drive_not_connected");
  el.className = connected
    ? "text-xs text-medical-green mt-1.5"
    : "text-xs text-gray-500 mt-1.5";
}

export function loadSettingsIntoForm(config) {
  setSettings(config);
  applySettings(config);
}
