import {
  caseStatusMeta,
  detachScan,
  getCase,
  updateCasePlanning,
  updateCaseStatus,
} from "./cases.js";
import { createDentalChart, parseDentalPlan, serializeDentalPlan } from "./dentalChart.js";
import { patientListLabel } from "./patients.js";
import { SCAN_LABELS, formatFileSize } from "./utils.js";
import { askDetachReason } from "./caseModals.js";
import { MeshViewer } from "./viewer.js";
import { getDefaultVisibility, getDentalTreatments, getSettings, hexToNumber, onSettingsChange } from "./settings.js";

let context = null;
let onClose = null;
let onDataChange = null;
let dirty = false;
let dentalChart = null;
let planningViewer = null;
let planningVisibility = getDefaultVisibility();

const SCAN_TYPES = ["upper", "lower", "bite"];

function el(id) {
  return document.getElementById(id);
}

function formatSessionDay(day) {
  if (!day) return "—";
  const [y, m, d] = day.split("-");
  if (!d) return day;
  return `${d}.${m}.${y}`;
}

function initPlanningViewer() {
  const canvas = el("planning-mesh-canvas");
  if (!canvas || planningViewer) return;
  planningViewer = new MeshViewer(canvas);
  applyPlanningViewerSettings();
}

function applyPlanningViewerSettings() {
  const s = getSettings();
  planningViewer?.applyVisualSettings({
    color_upper: hexToNumber(s.color_upper),
    color_lower: hexToNumber(s.color_lower),
    color_bite: hexToNumber(s.color_bite),
    camera_preset: s.camera_preset,
    lower_jaw_offset_mm: s.lower_jaw_offset_mm,
  });
}

function updatePlanningViewerToggles() {
  for (const type of SCAN_TYPES) {
    const btn = el(`planning-toggle-${type}`);
    if (!btn) continue;
    const hasMesh = planningViewer?.hasMesh(type);
    const visible = planningVisibility[type];
    btn.disabled = !hasMesh;
    btn.classList.toggle("is-on", hasMesh && visible);
    btn.classList.toggle("is-off", !hasMesh || !visible);
    btn.textContent = hasMesh
      ? visible
        ? `${SCAN_LABELS[type]} · açık`
        : `${SCAN_LABELS[type]} · kapalı`
      : SCAN_LABELS[type];
  }
}

async function loadPlanningScans(scanSession) {
  initPlanningViewer();
  planningViewer?.clearAll();
  planningVisibility = getDefaultVisibility();

  const scans = scanSession?.scans || {};
  let loaded = 0;

  for (const type of SCAN_TYPES) {
    const file = scans[type];
    if (!file) continue;
    try {
      await planningViewer.addScan(file.path, type);
      planningViewer.setVisible(type, planningVisibility[type]);
      loaded++;
    } catch (err) {
      console.warn(`Planlama önizlemesi — ${type} yüklenemedi:`, err);
    }
  }

  const placeholder = el("planning-viewer-placeholder");
  if (loaded > 0) {
    placeholder?.classList.add("hidden");
    requestAnimationFrame(() => {
      planningViewer?._resize();
      planningViewer?._fitCamera();
    });
  } else {
    placeholder?.classList.remove("hidden");
  }

  updatePlanningViewerToggles();
}

function togglePlanningScan(type) {
  if (!planningViewer?.hasMesh(type)) return;
  planningVisibility[type] = !planningVisibility[type];
  planningViewer.setVisible(type, planningVisibility[type]);
  planningViewer._fitCamera();
  updatePlanningViewerToggles();
}

function clearPlanningViewer() {
  planningViewer?.clearAll();
  el("planning-viewer-placeholder")?.classList.remove("hidden");
  updatePlanningViewerToggles();
}

function renderScanList(session) {
  const listEl = el("planning-scan-list");
  if (!listEl) return;

  const scans = session?.scans || {};
  const types = ["upper", "lower", "bite"];

  listEl.innerHTML = types
    .map((type) => {
      const file = scans[type];
      const label = SCAN_LABELS[type];
      if (!file) {
        return `
        <div class="planning-scan-row planning-scan-row-missing">
          <span class="text-xs font-medium mp-text-faint">${label}</span>
          <span class="text-[10px] mp-text-faint">Bağlı değil</span>
        </div>`;
      }
      return `
      <div class="planning-scan-row">
        <div class="min-w-0 flex-1">
          <span class="text-xs font-medium mp-text-secondary">${label}</span>
          <span class="text-[10px] mp-text-muted truncate block" title="${file.filename}">${file.filename}</span>
          <span class="text-[10px] mp-text-faint">${formatFileSize(file.size_bytes)}</span>
        </div>
        <button type="button" class="planning-detach-btn mp-btn-ghost text-[10px] px-1.5 py-0.5 rounded shrink-0 text-red-400"
          data-path="${file.path}" title="Vakadan kaldır">Kaldır</button>
      </div>`;
    })
    .join("");
}

function renderHeader(caseRow, patient) {
  const meta = caseStatusMeta(caseRow.status);
  const caseNum = el("planning-case-number");
  const pill = el("planning-status-pill");
  const subtitle = el("planning-subtitle");

  if (caseNum) caseNum.textContent = caseRow.case_number;
  if (pill) {
    pill.textContent = meta.label;
    pill.className = `case-status-pill ${meta.cls}`;
  }
  if (subtitle) {
    subtitle.textContent = `${patientListLabel(patient)} · ${formatSessionDay(caseRow.session_day)}`;
  }

  const readyBtn = el("btn-planning-ready");
  if (readyBtn) {
    readyBtn.disabled = caseRow.status === "sent";
    readyBtn.textContent =
      caseRow.status === "ready_to_send" ? "✓ Gönderime hazır" : "Gönderime hazır";
  }
}

function initDentalChart() {
  const root = el("dental-chart-root");
  if (!root || dentalChart) return;

  dentalChart = createDentalChart(root, {
    plan: emptyPlan(),
    treatments: getDentalTreatments(),
    onChange: () => {
      dirty = true;
    },
  });
}

function emptyPlan() {
  return parseDentalPlan("{}");
}

function loadDentalPlan(raw) {
  initDentalChart();
  dentalChart?.setPlan(parseDentalPlan(raw));
}

export function initPlanningPage({ onClose: closeHandler, onDataChange: dataChangeHandler }) {
  onClose = closeHandler;
  onDataChange = dataChangeHandler;

  initDentalChart();

  el("btn-planning-back")?.addEventListener("click", () => closePlanning());
  el("btn-planning-save")?.addEventListener("click", () => savePlanning());
  el("btn-planning-ready")?.addEventListener("click", () => markReadyToSend());

  el("planning-scan-list")?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".planning-detach-btn");
    if (btn) await detachFromCase(btn.dataset.path);
  });

  el("planning-lab-notes")?.addEventListener("input", () => {
    dirty = true;
  });

  for (const type of SCAN_TYPES) {
    el(`planning-toggle-${type}`)?.addEventListener("click", () => togglePlanningScan(type));
  }

  onSettingsChange(() => {
    applyPlanningViewerSettings();
    requestAnimationFrame(() => {
      planningViewer?._resize();
      planningViewer?._fitCamera();
    });
    dentalChart?.setTreatments(getDentalTreatments());
  });
}

export async function openPlanning(patient, scanSession) {
  if (!patient || !scanSession?.caseId) {
    alert("Planlama için önce bir vaka seçin.");
    return;
  }

  const caseRow = await getCase(scanSession.caseId);
  context = { patient, scanSession, caseRow };
  dirty = false;

  const notesInput = el("planning-lab-notes");
  if (notesInput) notesInput.value = caseRow.lab_notes || "";

  loadDentalPlan(caseRow.dental_plan || "{}");

  renderHeader(caseRow, patient);
  renderScanList(scanSession);
  await loadPlanningScans(scanSession);

  el("new-scan-banner")?.classList.add("hidden");
  el("main-layout")?.classList.add("hidden");
  el("planning-view")?.classList.remove("hidden");
}

export function closePlanning() {
  if (dirty && !confirm("Kaydedilmemiş değişiklikler var. Çıkmak istediğinize emin misiniz?")) {
    return;
  }

  el("planning-view")?.classList.add("hidden");
  el("main-layout")?.classList.remove("hidden");
  clearPlanningViewer();
  context = null;
  dirty = false;
  onClose?.();
}

async function detachFromCase(filePath) {
  if (!context) return;
  const file = context.scanSession.files?.find((f) => f.path === filePath)
    || Object.values(context.scanSession.scans || {}).find((f) => f?.path === filePath);
  if (!file) return;

  const reason = await askDetachReason(
    file.filename,
    `${patientListLabel(context.patient)} (${context.caseRow.case_number})`
  );
  if (!reason) return;

  try {
    await detachScan(filePath, reason);
    await onDataChange?.();
    const refreshed = await getCase(context.caseRow.id);
    context.caseRow = refreshed;
    delete context.scanSession.scans[file.scanType];
    context.scanSession.files = (context.scanSession.files || []).filter((f) => f.path !== filePath);
    renderScanList(context.scanSession);
    renderHeader(refreshed, context.patient);
    await loadPlanningScans(context.scanSession);
  } catch (err) {
    alert(`Kaldırılamadı: ${err}`);
  }
}

async function savePlanning() {
  if (!context) return null;
  const notes = el("planning-lab-notes")?.value?.trim() ?? "";
  const dentalPlan = serializeDentalPlan(dentalChart?.getPlan() || emptyPlan());

  try {
    const updated = await updateCasePlanning(context.caseRow.id, notes, dentalPlan);
    context.caseRow = updated;
    dirty = false;
    renderHeader(updated, context.patient);
    return updated;
  } catch (err) {
    alert(`Kaydedilemedi: ${err}`);
    return null;
  }
}

async function markReadyToSend() {
  if (!context) return;
  if (context.caseRow.status === "sent") return;

  await savePlanning();

  try {
    const updated = await updateCaseStatus(context.caseRow.id, "ready_to_send");
    context.caseRow = updated;
    renderHeader(updated, context.patient);
  } catch (err) {
    alert(`Durum güncellenemedi: ${err}`);
  }
}

export function getPlanningContext() {
  return context;
}

export function isPlanningOpen() {
  return !el("planning-view")?.classList.contains("hidden");
}
