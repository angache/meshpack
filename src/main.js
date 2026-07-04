import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { MeshViewer } from "./viewer.js";
import { ScanSession } from "./scanSession.js";
import { FileBrowser } from "./fileBrowser.js";
import {
  classifyScanType,
  formatFileSize,
  parsePatientName,
  patientKey,
  SCAN_LABELS,
} from "./utils.js";
import { identityTransformSet, matrixToArray } from "./alignment.js";
import {
  applySettings,
  getDefaultVisibility,
  getSettings,
  hexToNumber,
  onSettingsChange,
  settingsFromConfig,
  settingsToPayload,
} from "./settings.js";
import { initSettingsUI, loadSettingsIntoForm, updateDriveStatus } from "./settingsUI.js";
import { t } from "./i18n.js";

const statusBadge = document.getElementById("status-badge");
const statusText = document.getElementById("status-text");
const fileInfoBar = document.getElementById("file-info-bar");
const viewerPlaceholder = document.getElementById("viewer-placeholder");
const patientNameInput = document.getElementById("patient-name");
const labNotesInput = document.getElementById("lab-notes");
const btnUpload = document.getElementById("btn-upload");
const btnAlign = document.getElementById("btn-align");
const uploadStatus = document.getElementById("upload-status");
const settingsModal = document.getElementById("settings-modal");

const SLOT_IDS = { upper: "slot-upper", lower: "slot-lower", bite: "slot-bite" };
const OVERLAY_SLOT_IDS = { upper: "overlay-slot-upper", lower: "overlay-slot-lower", bite: "overlay-slot-bite" };
const SCAN_TYPES = ["upper", "lower", "bite"];

const OVERLAY_BTN_ACTIVE = {
  upper: "bg-medical-accent/25 text-medical-accent border-medical-accent/50",
  lower: "bg-medical-green/25 text-medical-green border-medical-green/50",
  bite: "bg-orange-400/25 text-orange-400 border-orange-400/50",
};

let viewer = null;
let session = new ScanSession();
let fileBrowser = null;
let watchFolder = null;
let visibility = getDefaultVisibility();

function applyViewerSettings() {
  const s = getSettings();
  viewer?.applyVisualSettings({
    color_upper: hexToNumber(s.color_upper),
    color_lower: hexToNumber(s.color_lower),
    color_bite: hexToNumber(s.color_bite),
    camera_preset: s.camera_preset,
    lower_jaw_offset_mm: s.lower_jaw_offset_mm,
  });
}

/** Yeni ölçü takibi — gönderimden sonra temizlenir */
const newPatientKeys = new Set();
const newFilePaths = new Set();
let lastNewScan = null; // { key, patientName, filename, scanType }

const newScanBanner = document.getElementById("new-scan-banner");
const newScanBannerText = document.getElementById("new-scan-banner-text");
const viewerSlot = document.getElementById("viewer-slot");
const viewerContainer = document.getElementById("viewer-container");
const previewOverlay = document.getElementById("preview-overlay");
const viewerOverlayHost = document.getElementById("viewer-overlay-host");

function initViewer() {
  viewer = new MeshViewer(document.getElementById("mesh-canvas"));
}

function initFileBrowser() {
  fileBrowser = new FileBrowser({
    container: document.getElementById("file-browser-root"),
    onPatientSelect: (patient) => selectPatient(patient),
    onToggleScan: (type) => toggleScanVisibility(type),
    getSessionPaths: () => session.getAllScans().map((s) => s.path),
    getSessionPatientKey: () => session.patientKey,
    isScanVisible: (type) => visibility[type],
    getNewPatientKeys: () => newPatientKeys,
    getNewFilePaths: () => newFilePaths,
  });
}

function markNewScan({ path, filename, patientName, patientKey: key, scanType }) {
  newPatientKeys.add(key);
  newFilePaths.add(path);
  lastNewScan = { key, patientName, filename, scanType };
  updateNewScanBanner();
  setStatus("active", "🟢 Yeni ölçü algılandı");
  fileBrowser?.render();
}

function clearNewForPatient(key) {
  newPatientKeys.delete(key);
  if (lastNewScan?.key === key) {
    lastNewScan = null;
    updateNewScanBanner();
  }
  fileBrowser?.render();
}

function clearAllNewScans() {
  newPatientKeys.clear();
  newFilePaths.clear();
  lastNewScan = null;
  updateNewScanBanner();
}

function updateNewScanBanner() {
  if (!lastNewScan) {
    newScanBanner.classList.add("hidden");
    return;
  }
  const typeLabel = SCAN_LABELS[lastNewScan.scanType] || "Tarama";
  newScanBannerText.textContent = `Yeni ölçü: ${lastNewScan.patientName} — ${typeLabel}`;
  newScanBanner.classList.remove("hidden");
}

async function gotoNewScan() {
  if (!lastNewScan) return;
  await fileBrowser?.refresh();
  const patient = fileBrowser?.patients.find((p) => p.key === lastNewScan.key);
  if (patient) {
    fileBrowser.openPatient(patient);
    await selectPatient(patient);
  }
}

function expandPreview() {
  if (previewOverlay.classList.contains("hidden") === false) return;
  viewerOverlayHost.appendChild(viewerContainer);
  viewerContainer.classList.remove("viewer-compact");
  viewerContainer.classList.add("viewer-expanded", "h-full", "w-full");
  previewOverlay.classList.remove("hidden");
  updateOverlayScanToggles();
  requestAnimationFrame(() => viewer?._resize());
}

function collapsePreview() {
  if (previewOverlay.classList.contains("hidden")) return;
  previewOverlay.classList.add("hidden");
  viewerSlot.appendChild(viewerContainer);
  viewerContainer.classList.add("viewer-compact");
  viewerContainer.classList.remove("viewer-expanded", "h-full", "w-full");
  requestAnimationFrame(() => viewer?._resize());
}

document.getElementById("btn-expand-preview").addEventListener("click", expandPreview);
document.getElementById("btn-close-preview").addEventListener("click", collapsePreview);
document.getElementById("btn-goto-new-scan").addEventListener("click", gotoNewScan);

viewerContainer.addEventListener("dblclick", (e) => {
  e.preventDefault();
  if (previewOverlay.classList.contains("hidden")) {
    expandPreview();
  } else {
    collapsePreview();
  }
});

previewOverlay.addEventListener("click", (e) => {
  if (e.target === previewOverlay) collapsePreview();
});

for (const type of SCAN_TYPES) {
  document.getElementById(OVERLAY_SLOT_IDS[type])?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleScanVisibility(type);
  });
}

function setStatus(mode, text) {
  statusText.textContent = text;
  if (mode === "active") {
    statusBadge.classList.add("active");
  } else if (mode === "watching") {
    statusBadge.classList.remove("active");
    statusBadge.className =
      "status-badge-idle inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium";
  } else if (mode === "aligned") {
    statusBadge.classList.add("active");
    statusText.textContent = text;
  } else {
    statusBadge.classList.remove("active");
    statusBadge.className =
      "status-badge-idle inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium";
  }
}

function markSessionAligned(transforms, { fromScanner = false } = {}) {
  session.aligned = true;
  session.transforms = transforms;
  setStatus(
    "aligned",
    fromScanner ? "✅ Tarayıcı hizası kullanılıyor" : "✅ Çeneler kapanışa göre hizalandı"
  );
  btnAlign.textContent = fromScanner ? "✅ Tarayıcı hizalı" : "✅ Hizalandı";
  btnAlign.classList.add("done");
  btnAlign.disabled = true;
  updateScanSlots();
}

function acceptScannerAlignment() {
  if (!session.isComplete()) return;
  if (!viewer.hasMesh("upper") || !viewer.hasMesh("lower") || !viewer.hasMesh("bite")) return;
  viewer.aligned = true;
  markSessionAligned(identityTransformSet(), { fromScanner: true });
  maybeAutoUpload();
}

async function maybeAutoUpload() {
  const s = getSettings();
  if (!s.auto_upload || !session.isComplete() || !session.aligned) return;
  if (!patientNameInput.value.trim()) return;
  if (btnUpload.disabled) return;
  await performUpload();
}

function resetAlignButton() {
  btnAlign.disabled = true;
  btnAlign.textContent = "3 tarama bekleniyor";
  btnAlign.className =
    "mp-btn-secondary w-full px-2 py-1.5 rounded-lg text-[10px] font-medium disabled:opacity-40 disabled:cursor-not-allowed";
}

function clearPatientData() {
  session.reset();
  viewer.clearAll();
  visibility = getDefaultVisibility();
  patientNameInput.value = "";
  labNotesInput.value = "";
  resetAlignButton();
  viewerPlaceholder.classList.remove("hidden");
  updateScanSlots();
  updateFileInfoBar();
}

function toggleScanVisibility(type) {
  if (!session.scans[type]) return;
  visibility[type] = !visibility[type];
  viewer.setVisible(type, visibility[type]);
  updateScanSlots();
  viewer._fitCamera();
}

function updateScanSlots() {
  for (const type of SCAN_TYPES) {
    const el = document.getElementById(SLOT_IDS[type]);
    const scan = session.scans[type];
    el.className =
      "scan-slot flex-1 px-1 py-1 rounded border text-center cursor-pointer transition-colors border-dashed border-anthracite-600";
    el.disabled = !scan;

    if (!scan) {
      el.classList.add("opacity-50");
      el.querySelector(".slot-status").textContent = "—";
      el.title = `${SCAN_LABELS[type]} — dosya yok`;
      continue;
    }

    el.classList.add(`filled-${type}`);
    if (session.aligned) el.classList.add("aligned");

    const visible = visibility[type];
    if (visible) {
      el.querySelector(".slot-status").textContent = "👁";
      el.title = `${SCAN_LABELS[type]} — görünür (gizlemek için tıkla)`;
    } else {
      el.classList.add("scan-hidden");
      el.querySelector(".slot-status").textContent = "🚫";
      el.title = `${SCAN_LABELS[type]} — gizli (göstermek için tıkla)`;
    }
  }

  const complete = session.isComplete();
  btnAlign.disabled = !complete || session.aligned;
  if (!complete) {
    btnAlign.textContent = "3 tarama bekleniyor";
    btnAlign.className =
      "mp-btn-secondary w-full px-2 py-1.5 rounded-lg text-[10px] font-medium disabled:opacity-40 disabled:cursor-not-allowed";
  } else if (session.aligned) {
    btnAlign.className =
      "mp-btn-secondary w-full px-2 py-1.5 rounded-lg text-[10px] font-medium done border disabled:opacity-40 disabled:cursor-not-allowed";
  } else {
    btnAlign.textContent = "✅ Hazır";
    btnAlign.className =
      "mp-btn-secondary w-full px-2 py-1.5 rounded-lg text-[10px] font-medium ready border";
  }

  btnUpload.disabled = session.getCompletedCount() === 0;
  updateOverlayScanToggles();
  fileBrowser?.render();
}

function updateOverlayScanToggles() {
  for (const type of SCAN_TYPES) {
    const el = document.getElementById(OVERLAY_SLOT_IDS[type]);
    if (!el) continue;

    const hasScan = !!session.scans[type];
    const visible = visibility[type];

    el.disabled = !hasScan;

    if (!hasScan) {
      el.className =
        "overlay-scan-btn px-3 py-1.5 rounded-lg text-xs font-medium border border-anthracite-600 text-gray-500 opacity-30 cursor-default";
      el.textContent = `${SCAN_LABELS[type]} —`;
      continue;
    }

    const base = `overlay-scan-btn px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${OVERLAY_BTN_ACTIVE[type]}`;
    el.className = visible ? base : `${base} opacity-40 line-through`;
    el.textContent = visible ? `${SCAN_LABELS[type]} 👁` : `${SCAN_LABELS[type]} 🚫`;
  }
}

function updateFileInfoBar() {
  const scans = session.getAllScans();
  if (scans.length === 0) {
    fileInfoBar.textContent = "📁 Henüz dosya algılanmadı";
    return;
  }

  const parts = scans.map((s) => {
    const label = SCAN_LABELS[s.type] || s.type;
    const vis = visibility[s.type] ? "" : " (gizli)";
    return `${label}: ${formatFileSize(s.sizeBytes)}${vis}`;
  });

  fileInfoBar.textContent = `📁 ${parts.join(" | ")} — Toplam: ${formatFileSize(session.getTotalSize())}`;
}

/**
 * Hasta seçildiğinde: önceki veriyi temizle, tüm taramaları yükle.
 * Üst ve alt çene otomatik görünür; kapanış yüklü ama gizli.
 */
async function selectPatient(patient) {
  if (session.patientKey && session.patientKey !== patient.key) {
    clearPatientData();
  } else {
    viewer.clearAll();
    session.reset();
  }

  session.patientKey = patient.key;
  session.patientName = patient.patientName;
  session.lastActivity = Date.now();
  patientNameInput.value = patient.patientName;

  visibility = getDefaultVisibility();
  resetAlignButton();

  let loaded = 0;
  for (const type of SCAN_TYPES) {
    const file = patient.scans[type];
    if (!file) continue;

    session.scans[type] = {
      path: file.path,
      filename: file.filename,
      sizeBytes: file.size_bytes,
      type,
    };

    try {
      await viewer.addScan(file.path, type);
      viewer.setVisible(type, visibility[type]);
      loaded++;
    } catch (err) {
      console.warn(`${type} yüklenemedi:`, err);
      session.scans[type] = null;
    }
  }

  if (loaded > 0) {
    viewerPlaceholder.classList.add("hidden");
    viewer._fitCamera();
    acceptScannerAlignment();
  } else {
    viewerPlaceholder.classList.remove("hidden");
  }

  setStatus("active", session.getStatusText());
  updateScanSlots();
  updateFileInfoBar();
}

/** Klasör izleyiciden gelen tek dosya */
async function addScanFromWatcher({ path, filename, size_bytes }) {
  const name = parsePatientName(filename);
  const key = patientKey(name);
  let type = classifyScanType(filename);

  markNewScan({
    path,
    filename,
    patientName: name,
    patientKey: key,
    scanType: type === "unknown" ? "upper" : type,
  });

  if (session.patientKey && session.patientKey !== key) {
    await fileBrowser?.refresh();
    const patient = fileBrowser?.patients.find((p) => p.key === key);
    if (patient) {
      fileBrowser.openPatient(patient);
      await selectPatient(patient);
      return;
    }
    clearPatientData();
  }

  if (!session.patientKey) {
    session.patientKey = key;
    session.patientName = name;
    patientNameInput.value = name;
    visibility = getDefaultVisibility();
  }

  if (type === "unknown") {
    type = findEmptySlot();
  }

  session.scans[type] = { path, filename, sizeBytes: size_bytes, type };
  session.aligned = false;
  session.lastActivity = Date.now();

  if (visibility[type] === undefined) {
    visibility[type] = type !== "bite";
  }

  try {
    await viewer.addScan(path, type);
    viewer.setVisible(type, visibility[type]);
    viewerPlaceholder.classList.add("hidden");
    viewer._fitCamera();
    acceptScannerAlignment();
  } catch (err) {
    console.warn("3B önizleme yüklenemedi:", err);
  }

  setStatus("active", session.getStatusText());
  updateScanSlots();
  updateFileInfoBar();
}

function findEmptySlot() {
  return SCAN_TYPES.find((s) => !session.scans[s]) || "upper";
}

async function onScanDetected(event) {
  await addScanFromWatcher(event.payload);
  fileBrowser?.refresh();
}

async function setupWatchFolder(folder) {
  watchFolder = folder;
  fileBrowser.setWatchFolder(folder);
  if (folder) {
    await invoke("start_watching", { folder });
    await fileBrowser.refresh();
    setStatus("watching", `👁 ${t("watching")}`);
  }
}

// Slot tıklama → görünürlük
for (const type of SCAN_TYPES) {
  document.getElementById(SLOT_IDS[type]).addEventListener("click", () => {
    toggleScanVisibility(type);
  });
}

btnAlign.addEventListener("click", () => {
  if (session.aligned) return;
  acceptScannerAlignment();
});

async function runIcpAlign() {
  if (!session.isComplete()) {
    alert("ICP hizalama için üst, alt ve kapanış taraması gerekli.");
    return;
  }

  const proceed = confirm(
    "ICP hizalama tarayıcıdan gelen doğru hizayı bozabilir.\n\nSadece modeller belirgin şekilde kayıksa kullanın. Devam edilsin mi?"
  );
  if (!proceed) return;

  const btn = document.getElementById("btn-icp-align");
  btn.disabled = true;
  const prevText = btn.textContent;
  btn.textContent = "⏳ ICP çalışıyor...";

  try {
    for (const type of SCAN_TYPES) {
      if (session.scans[type]) viewer.setVisible(type, true);
      visibility[type] = true;
    }

    const transforms = await viewer.alignBite();
    session.transforms = {
      upper: matrixToArray(transforms.upper),
      bite: matrixToArray(transforms.bite),
      lower: matrixToArray(transforms.lower),
    };
    markSessionAligned(session.transforms, { fromScanner: false });
  } catch (err) {
    console.error("ICP hizalama hatası:", err);
    alert(`ICP hizalama başarısız: ${err.message || err}`);
  } finally {
    btn.disabled = false;
    btn.textContent = prevText;
  }
}

document.querySelectorAll(".template-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const text = btn.dataset.template;
    const current = labNotesInput.value;
    labNotesInput.value = current ? `${current}, ${text}` : text;
    labNotesInput.focus();
  });
});

const appWindow = getCurrentWindow();

async function toggleFullscreen() {
  const isFs = await appWindow.isFullscreen();
  await appWindow.setFullscreen(!isFs);
}

document.getElementById("btn-maximize").addEventListener("click", () => {
  toggleFullscreen();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "F11") {
    e.preventDefault();
    toggleFullscreen();
  }
});

async function performUpload() {
  const scans = session.getAllScans();
  if (scans.length === 0) return;

  const patientName = patientNameInput.value.trim();
  if (!patientName) {
    alert("Lütfen hasta adını girin.");
    patientNameInput.focus();
    return;
  }

  if (session.isComplete() && !session.aligned) {
    const proceed = confirm(
      "Üç tarama tamamlandı ancak hizalama onaylanmadı. Yine de yüklemek istiyor musunuz?"
    );
    if (!proceed) return;
  }

  btnUpload.disabled = true;
  btnUpload.textContent = "⏳ Sıkıştırılıyor ve yükleniyor...";
  uploadStatus.classList.remove("hidden");
  uploadStatus.textContent = "ZIP oluşturuluyor...";

  try {
    const filePaths = scans.map((s) => s.path);
    const link = await invoke("compress_and_upload", {
      filePaths,
      patientName,
      notes: labNotesInput.value.trim(),
      alignment: session.transforms,
    });

    uploadStatus.textContent = "✅ Yükleme tamamlandı! Link panoya kopyalandı.";
    uploadStatus.className = "text-xs text-center text-medical-green mt-2";
    await writeText(link);
    btnUpload.textContent = "✅ Yüklendi — Link Kopyalandı";

    const uploadedKey = session.patientKey;
    for (const s of session.getAllScans()) {
      newFilePaths.delete(s.path);
    }
    if (uploadedKey) clearNewForPatient(uploadedKey);

    clearPatientData();
    await fileBrowser?.refresh();
  } catch (err) {
    uploadStatus.textContent = `❌ Hata: ${err}`;
    uploadStatus.className = "text-xs text-center text-red-400 mt-2";
    btnUpload.disabled = false;
    btnUpload.textContent = `🚀 ${t("upload_btn")}`;
  }
}

btnUpload.addEventListener("click", () => performUpload());

async function saveSettingsToBackend(payload) {
  const saved = await invoke("save_settings", { settings: payload });
  const merged = settingsFromConfig(saved);
  loadSettingsIntoForm(merged);
  applyViewerSettings();
  if (merged.watch_folder) {
    await setupWatchFolder(merged.watch_folder);
  }
  if (merged.start_fullscreen) {
    await appWindow.setFullscreen(true);
  }
}

initSettingsUI({
  onSave: saveSettingsToBackend,
  onDriveAuth: async () => {
    try {
      const result = await invoke("drive_authenticate");
      updateDriveStatus(!!result);
    } catch (err) {
      updateDriveStatus(false, `Hata: ${err}`);
    }
  },
  onIcpAlign: runIcpAlign,
});

onSettingsChange(() => {
  applyViewerSettings();
  applySettings();
});

async function init() {
  initViewer();
  initFileBrowser();
  applyViewerSettings();
  updateScanSlots();

  await listen("scan-detected", onScanDetected);

  try {
    const config = await invoke("get_config");
    const merged = settingsFromConfig(config);
    loadSettingsIntoForm(merged);
    updateDriveStatus(merged.drive_connected);
    if (merged.watch_folder) {
      await setupWatchFolder(merged.watch_folder);
    }
    if (merged.start_fullscreen) {
      await appWindow.setFullscreen(true);
    }
  } catch {
    applySettings();
  }
}

init();
