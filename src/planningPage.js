import {
  caseStatusMeta,
  detachScan,
  getCase,
  updateCasePlanning,
  updateCaseStatus,
} from "./cases.js";
import { buildCaseSummary, buildMailtoLink, buildUploadPatientName } from "./caseSummary.js";
import { createDentalChart, parseDentalPlan, serializeDentalPlan } from "./dentalChart.js";
import { patientListLabel } from "./patients.js";
import { SCAN_LABELS, formatFileSize } from "./utils.js";
import { askDetachReason } from "./caseModals.js";
import { MeshViewer } from "./viewer.js";
import { AnnotationLayer } from "./annotationLayer.js";
import { parseAnnotations, serializeAnnotations } from "./annotations.js";
import { getDefaultVisibility, getDentalTreatments, getSettings, hexToNumber, onSettingsChange } from "./settings.js";
import {
  VITA_CLASSICAL,
  VITA_3D_MASTER,
  detectVitaScale,
  normalizeShadeCode,
  populateShadeSelect,
} from "./config/vitaShades.js";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

let context = null;
let onClose = null;
let onDataChange = null;
let dirty = false;
let dentalChart = null;
let planningViewer = null;
let annotationLayer = null;
let planningVisibility = getDefaultVisibility();
let annotateMode = false;
/** @type {{ scanType: string, position: number[], normal: number[] } | null} */
let pendingHit = null;
let shadeSelectorsReady = false;

function initShadeSelectors() {
  if (shadeSelectorsReady) return;
  populateShadeSelect(el("planning-tooth-shade-classical"), VITA_CLASSICAL);
  populateShadeSelect(el("planning-tooth-shade-3d"), VITA_3D_MASTER);
  shadeSelectorsReady = true;
}

function switchShadeTab(tabId) {
  const isClassical = tabId === VITA_CLASSICAL.id;
  el("planning-shade-tab-classical")?.classList.toggle("is-active", isClassical);
  el("planning-shade-tab-3d")?.classList.toggle("is-active", !isClassical);
  el("planning-tooth-shade-classical")?.classList.toggle("hidden", !isClassical);
  el("planning-tooth-shade-3d")?.classList.toggle("hidden", isClassical);
}

function getToothShade() {
  const classical = el("planning-tooth-shade-classical")?.value ?? "";
  const master = el("planning-tooth-shade-3d")?.value ?? "";
  return normalizeShadeCode(classical || master);
}

function setToothShade(value) {
  initShadeSelectors();
  const shade = normalizeShadeCode(value);
  const scale = detectVitaScale(shade);
  switchShadeTab(scale);

  const classical = el("planning-tooth-shade-classical");
  const master = el("planning-tooth-shade-3d");

  if (scale === VITA_CLASSICAL.id) {
    populateShadeSelect(classical, VITA_CLASSICAL, shade);
    if (master) master.value = "";
  } else {
    populateShadeSelect(master, VITA_3D_MASTER, shade);
    if (classical) classical.value = "";
  }
}

function onShadeChange(fromScale) {
  dirty = true;
  if (fromScale === VITA_CLASSICAL.id) {
    const master = el("planning-tooth-shade-3d");
    if (master) master.value = "";
  } else {
    const classical = el("planning-tooth-shade-classical");
    if (classical) classical.value = "";
  }
  renderSendSummary();
}

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
  annotationLayer = new AnnotationLayer(planningViewer);
  annotationLayer.onChange = () => {
    dirty = true;
    renderAnnotationList();
    renderSendSummary();
  };
  annotationLayer.onPlaceRequest = (hit) => {
    pendingHit = {
      scanType: hit.scanType,
      position: hit.position,
      normal: hit.normal,
    };
    showAnnotationCompose(true);
    el("planning-annotation-text")?.focus();
  };
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
  annotationLayer?.syncPositions();
}

function showAnnotationCompose(show) {
  el("planning-annotation-compose")?.classList.toggle("hidden", !show);
  if (!show) {
    pendingHit = null;
    const input = el("planning-annotation-text");
    if (input) input.value = "";
  }
}

function setAnnotateMode(on) {
  annotateMode = !!on;
  annotationLayer?.setMode(annotateMode);
  const btn = el("btn-planning-annotate");
  if (btn) {
    btn.classList.toggle("is-active", annotateMode);
    btn.textContent = annotateMode ? "📍 İşaretleme açık" : "📍 İşaretle";
  }
  if (!annotateMode) showAnnotationCompose(false);
}

function renderAnnotationList() {
  const listEl = el("planning-annotation-list");
  if (!listEl || !annotationLayer) return;

  const markers = annotationLayer.getAnnotations().markers;
  if (!markers.length) {
    listEl.innerHTML = `<p class="text-[10px] mp-text-faint">${annotateMode ? "Modele tıklayarak işaret ekleyin." : "Henüz işaret yok."}</p>`;
    return;
  }

  listEl.innerHTML = markers
    .map(
      (m, i) => `
      <div class="planning-annotation-item" data-annotation-id="${m.id}">
        <div class="planning-annotation-item-head">
          <span class="planning-annotation-badge">${i + 1}</span>
          <span class="planning-annotation-scan">${SCAN_LABELS[m.scanType] || m.scanType}</span>
          <button type="button" class="planning-annotation-remove mp-btn-ghost text-[10px] text-red-400 px-1" data-remove-annotation="${m.id}">Sil</button>
        </div>
        <p class="planning-annotation-text">${escapeHtml(m.text || "—")}</p>
      </div>`
    )
    .join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function loadAnnotations(raw) {
  initPlanningViewer();
  annotationLayer?.setAnnotations(raw || "{}");
  renderAnnotationList();
}

function confirmPendingAnnotation() {
  if (!pendingHit || !annotationLayer) return;
  const text = el("planning-annotation-text")?.value?.trim() ?? "";
  if (!text) {
    alert("Lütfen bir not yazın.");
    return;
  }
  annotationLayer.addMarker({ ...pendingHit, text });
  showAnnotationCompose(false);
}

function updateAnnotateButtonState(hasMesh) {
  const btn = el("btn-planning-annotate");
  if (btn) btn.disabled = !hasMesh;
}

function getSummaryInput() {
  if (!context) return null;
  return {
    caseRow: context.caseRow,
    patient: context.patient,
    scanSession: context.scanSession,
    labNotes: el("planning-lab-notes")?.value ?? "",
    toothShade: getToothShade(),
    dentalPlanRaw: serializeDentalPlan(dentalChart?.getPlan() || emptyPlan()),
    annotationsRaw: serializeAnnotations(annotationLayer?.getAnnotations() || {}),
    treatments: getDentalTreatments(),
  };
}

function renderSendSummary() {
  const pre = el("planning-send-summary");
  if (!pre || !context) {
    if (pre) pre.textContent = "";
    return;
  }
  pre.textContent = buildCaseSummary(getSummaryInput());

  const uploadBtn = el("btn-planning-upload");
  const scans = context.scanSession?.scans || {};
  const hasFiles = ["upper", "lower", "bite"].some((t) => scans[t]);
  if (uploadBtn) {
    uploadBtn.disabled = !hasFiles || context.caseRow.status === "sent";
    uploadBtn.textContent = context.caseRow.status === "sent" ? "✓ Gönderildi" : "Drive'a yükle";
  }
}

function setSendStatus(message, type = "") {
  const statusEl = el("planning-send-status");
  if (!statusEl) return;
  if (!message) {
    statusEl.textContent = "";
    statusEl.className = "planning-send-status hidden";
    return;
  }
  statusEl.textContent = message;
  statusEl.className = `planning-send-status ${type === "ok" ? "is-ok" : type === "err" ? "is-err" : ""}`;
}

async function copySendSummary() {
  const summary = buildCaseSummary(getSummaryInput());
  if (!summary) return;
  try {
    await writeText(summary);
    setSendStatus("Özet panoya kopyalandı.", "ok");
  } catch (err) {
    setSendStatus(`Kopyalanamadı: ${err}`, "err");
  }
}

function emailSendSummary() {
  if (!context) return;
  const summary = buildCaseSummary(getSummaryInput());
  window.location.href = buildMailtoLink(summary, context.caseRow);
  setSendStatus("E-posta uygulamanız açılıyor…", "ok");
}

async function uploadCaseToDrive() {
  if (!context || context.caseRow.status === "sent") return;

  const scans = context.scanSession?.scans || {};
  const filePaths = ["upper", "lower", "bite"].map((t) => scans[t]?.path).filter(Boolean);
  if (!filePaths.length) {
    alert("Bu vakaya bağlı ölçü dosyası yok.");
    return;
  }

  if (!getSettings().drive_connected) {
    alert("Google Drive bağlı değil. Ayarlar → Gönderim sekmesinden bağlanın.");
    return;
  }

  await savePlanning();

  const uploadBtn = el("btn-planning-upload");
  if (uploadBtn) {
    uploadBtn.disabled = true;
    uploadBtn.textContent = "⏳ Yükleniyor…";
  }
  setSendStatus("ZIP oluşturuluyor ve Drive'a yükleniyor…");

  try {
    const summary = buildCaseSummary(getSummaryInput());
    const link = await invoke("compress_and_upload", {
      filePaths,
      patientName: buildUploadPatientName(context.caseRow, context.patient),
      notes: summary,
      alignment: null,
    });

    await writeText(link);
    const updated = await updateCaseStatus(context.caseRow.id, "sent");
    context.caseRow = updated;
    dirty = false;
    renderHeader(updated, context.patient);
    renderSendSummary();
    setSendStatus("✅ Drive'a yüklendi. İndirme linki panoya kopyalandı.", "ok");
    await onDataChange?.();
  } catch (err) {
    setSendStatus(`❌ ${err}`, "err");
    renderSendSummary();
  }
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
  updateAnnotateButtonState(loaded > 0);
  annotationLayer?.refresh();
  annotationLayer?.syncPositions();
}

function togglePlanningScan(type) {
  if (!planningViewer?.hasMesh(type)) return;
  planningVisibility[type] = !planningVisibility[type];
  planningViewer.setVisible(type, planningVisibility[type]);
  planningViewer._fitCamera();
  updatePlanningViewerToggles();
}

function clearPlanningViewer() {
  setAnnotateMode(false);
  annotationLayer?.clear();
  planningViewer?.clearAll();
  el("planning-viewer-placeholder")?.classList.remove("hidden");
  updatePlanningViewerToggles();
  updateAnnotateButtonState(false);
  renderAnnotationList();
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
      renderSendSummary();
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

  initShadeSelectors();

  el("btn-planning-back")?.addEventListener("click", () => closePlanning());
  el("btn-planning-save")?.addEventListener("click", () => savePlanning());
  el("btn-planning-ready")?.addEventListener("click", () => markReadyToSend());

  el("planning-scan-list")?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".planning-detach-btn");
    if (btn) await detachFromCase(btn.dataset.path);
  });

  el("planning-lab-notes")?.addEventListener("input", () => {
    dirty = true;
    renderSendSummary();
  });

  el("planning-shade-tab-classical")?.addEventListener("click", () => switchShadeTab(VITA_CLASSICAL.id));
  el("planning-shade-tab-3d")?.addEventListener("click", () => switchShadeTab(VITA_3D_MASTER.id));

  el("planning-tooth-shade-classical")?.addEventListener("change", () =>
    onShadeChange(VITA_CLASSICAL.id)
  );
  el("planning-tooth-shade-3d")?.addEventListener("change", () =>
    onShadeChange(VITA_3D_MASTER.id)
  );

  el("btn-planning-copy-summary")?.addEventListener("click", () => copySendSummary());
  el("btn-planning-email")?.addEventListener("click", () => emailSendSummary());
  el("btn-planning-upload")?.addEventListener("click", () => uploadCaseToDrive());

  for (const type of SCAN_TYPES) {
    el(`planning-toggle-${type}`)?.addEventListener("click", () => togglePlanningScan(type));
  }

  el("btn-planning-annotate")?.addEventListener("click", () => setAnnotateMode(!annotateMode));
  el("planning-annotation-add")?.addEventListener("click", () => confirmPendingAnnotation());
  el("planning-annotation-cancel-compose")?.addEventListener("click", () => showAnnotationCompose(false));
  el("planning-annotation-list")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-annotation]");
    if (!btn) return;
    annotationLayer?.removeMarker(btn.dataset.removeAnnotation);
  });

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

  setToothShade(caseRow.tooth_shade || "");

  loadDentalPlan(caseRow.dental_plan || "{}");

  renderHeader(caseRow, patient);
  renderScanList(scanSession);
  await loadPlanningScans(scanSession);
  loadAnnotations(caseRow.annotations || "{}");
  renderSendSummary();

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
  setSendStatus("");
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
    renderSendSummary();
    await loadPlanningScans(context.scanSession);
  } catch (err) {
    alert(`Kaldırılamadı: ${err}`);
  }
}

async function savePlanning() {
  if (!context) return null;
  const notes = el("planning-lab-notes")?.value?.trim() ?? "";
  const toothShade = getToothShade();
  const dentalPlan = serializeDentalPlan(dentalChart?.getPlan() || emptyPlan());
  const annotations = serializeAnnotations(annotationLayer?.getAnnotations() || {});

  try {
    const updated = await updateCasePlanning(
      context.caseRow.id,
      notes,
      toothShade,
      dentalPlan,
      annotations
    );
    context.caseRow = updated;
    dirty = false;
    renderHeader(updated, context.patient);
    renderSendSummary();
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
