import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  buildWizardGroupFromFiles,
  enrichScanFile,
  reanalyzeSelection,
} from "./scanGroupQuality.js";
import {
  SCAN_SLOT_DEFS,
  buildDefaultSlotAssignments,
  validateSlotAssignments,
  getFilesFromAssignments,
  getUnassignedPoolFiles,
  assignPathToSlot,
  clearSlot,
  dedupeSlotAssignments,
  enrichFileForSlot,
  emptySlotAssignments,
} from "./scanSlots.js";
import { needsNamingHint } from "./utils.js";
import { patientListLabel } from "./patients.js";
import { rejectStemSuggestion } from "./patientStemRejections.js";
import { openSettingsModal } from "./settingsUI.js";
import { askLinkScanSetConfirm } from "./caseModals.js";
import { analyzeLinkCompleteness } from "./utils.js";
import { initIcons, iconHtml } from "./icons.js";
import { MeshViewer } from "./viewer.js";

const $ = (id) => document.getElementById(id);

function wizardEl(id) {
  const root = document.getElementById("scan-import-wizard");
  return root?.querySelector(`#${id}`) || document.getElementById(id);
}

/** Slot adımları — sırayla */
const SLOT_FLOW = [
  {
    id: "upper",
    label: "Üst çene",
    short: "Üst",
    title: "Üst çene ekle",
    hint: "Ana üst çene modelini sürükleyin veya seçin.",
    required: true,
    viewerType: "upper",
  },
  {
    id: "upperPreop",
    label: "Üst çene (preop)",
    short: "Üst preop",
    title: "Üst çene preop (opsiyonel)",
    hint: "Pretreatment üst model varsa ekleyin. Yoksa atlayabilirsiniz.",
    required: false,
    viewerType: "upper",
  },
  {
    id: "lower",
    label: "Alt çene",
    short: "Alt",
    title: "Alt çene ekle",
    hint: "Ana alt çene modelini sürükleyin veya seçin.",
    required: true,
    viewerType: "lower",
  },
  {
    id: "lowerPreop",
    label: "Alt çene (preop)",
    short: "Alt preop",
    title: "Alt çene preop (opsiyonel)",
    hint: "Pretreatment alt model varsa ekleyin. Yoksa atlayabilirsiniz.",
    required: false,
    viewerType: "lower",
  },
  {
    id: "bite",
    label: "Kapanış",
    short: "Kapanış",
    title: "Kapanış ekle",
    hint: "En az bir kapanış gerekli. İsterseniz ikinci kapanışı da ekleyin.",
    required: true,
    viewerType: "bite",
    allowSecond: true,
    secondId: "bite2",
  },
];

let getFileBrowser = null;
let onComplete = null;
let getLastNewScanPath = null;
let dragUnlisten = null;

/** @type {'source'|'slot'|'patient'|'confirm'} */
let phase = "source";
let slotIndex = 0;
let wizardGroup = null;
let slotAssignments = emptySlotAssignments();
let selectedPatientId = null;
let createNew = false;
let patientFilter = "";
let finishing = false;

/** @type {MeshViewer|null} */
let previewViewer = null;
let previewSyncToken = 0;

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setVisible(open) {
  $("scan-import-wizard")?.classList.toggle("hidden", !open);
  document.body.classList.toggle("scan-wizard-open", open);
  if (!open) disposePreview();
}

function currentSlotDef() {
  return SLOT_FLOW[slotIndex] || null;
}

function selectionAnalysis() {
  if (!wizardGroup) return null;
  return reanalyzeSelection(submissionFiles());
}

function slotValidation() {
  if (!wizardGroup?.files?.length) return null;
  return validateSlotAssignments(slotAssignments, wizardGroup.files);
}

function submissionFiles() {
  if (!wizardGroup) return [];
  const files = getFilesFromAssignments(slotAssignments, wizardGroup.files);
  return files.map((f) => {
    const slotId = Object.entries(slotAssignments).find(([, p]) => p === f.path)?.[0];
    return slotId ? enrichFileForSlot(enrichScanFile(f), slotId) : enrichScanFile(f);
  });
}

function syncSlotsFromPool({ reset = false } = {}) {
  if (!wizardGroup?.files?.length) return;
  const auto = buildDefaultSlotAssignments(wizardGroup.files);
  if (reset || !wizardGroup.slotAssignments) {
    slotAssignments = dedupeSlotAssignments(auto);
  } else {
    const next = { ...auto };
    for (const def of SCAN_SLOT_DEFS) {
      const prev = slotAssignments[def.id] ?? wizardGroup.slotAssignments[def.id];
      if (prev && wizardGroup.files.some((f) => f.path === prev)) {
        next[def.id] = prev;
      }
    }
    slotAssignments = dedupeSlotAssignments(next);
  }
  wizardGroup.slotAssignments = slotAssignments;
  wizardGroup.selectedFiles = getFilesFromAssignments(slotAssignments, wizardGroup.files);
}

function fileForSlot(slotId) {
  const path = slotAssignments[slotId];
  if (!path || !wizardGroup?.files) return null;
  return wizardGroup.files.find((f) => f.path === path) || null;
}

function setPhase(next, nextSlotIndex = slotIndex) {
  phase = next;
  slotIndex = nextSlotIndex;
  renderWizard();
}

function severityClass(severity) {
  return (
    {
      error: "scan-wiz-alert-error",
      warn: "scan-wiz-alert-warn",
      info: "scan-wiz-alert-info",
      ok: "scan-wiz-alert-ok",
    }[severity] || "scan-wiz-alert-info"
  );
}

/* ─── Preview ─── */

function ensurePreview() {
  const canvas = $("scan-wiz-preview-canvas");
  if (!canvas) return null;
  if (!previewViewer) {
    previewViewer = new MeshViewer(canvas);
  }
  return previewViewer;
}

function disposePreview() {
  previewViewer?.dispose();
  previewViewer = null;
  previewSyncToken += 1;
}

async function syncPreview() {
  const token = ++previewSyncToken;
  const empty = $("scan-wiz-preview-empty");
  const legend = $("scan-wiz-preview-legend");
  const viewer = ensurePreview();
  if (!viewer) return;

  const upper = fileForSlot("upper");
  const lower = fileForSlot("lower");
  const bite = fileForSlot("bite") || fileForSlot("bite2");
  const hasAny = !!(upper || lower || bite);

  empty?.classList.toggle("hidden", hasAny);

  try {
    viewer.clearAll();
    if (upper) await viewer.addScan(upper.path, "upper");
    if (token !== previewSyncToken) return;
    if (lower) await viewer.addScan(lower.path, "lower");
    if (token !== previewSyncToken) return;
    if (bite) await viewer.addScan(bite.path, "bite");
    if (token !== previewSyncToken) return;

    viewer.setVisible("upper", !!upper);
    viewer.setVisible("lower", !!lower);
    viewer.setVisible("bite", !!bite);

    requestAnimationFrame(() => {
      if (token !== previewSyncToken) return;
      viewer._resize?.();
      if (hasAny) viewer._fitCamera?.();
    });
  } catch (err) {
    console.warn("[scanWizard] preview:", err);
  }

  if (legend) {
    const chips = SLOT_FLOW.flatMap((def) => {
      const items = [{ id: def.id, label: def.short }];
      if (def.allowSecond && def.secondId) {
        items.push({ id: def.secondId, label: "Kap. 2" });
      }
      return items;
    })
      .map(({ id, label }) => {
        const filled = !!slotAssignments[id];
        return `<span class="scan-wiz-legend-chip ${filled ? "is-filled" : ""}">${escapeHtml(label)}</span>`;
      })
      .join("");
    legend.innerHTML = chips;
  }
}

/* ─── Progress ─── */

function renderStepIndicator() {
  const phases = [
    { key: "source", label: "Kaynak" },
    ...SLOT_FLOW.map((s, i) => ({ key: `slot-${i}`, label: s.short, slotIndex: i })),
    { key: "patient", label: "Hasta" },
    { key: "confirm", label: "Onay" },
  ];

  let activeKey = "source";
  if (phase === "slot") activeKey = `slot-${slotIndex}`;
  else if (phase === "patient") activeKey = "patient";
  else if (phase === "confirm") activeKey = "confirm";

  const activeIdx = phases.findIndex((p) => p.key === activeKey);

  return phases
    .map((p, i) => {
      const done = i < activeIdx;
      const active = p.key === activeKey;
      const filled =
        p.slotIndex != null &&
        (slotAssignments[SLOT_FLOW[p.slotIndex].id] ||
          (SLOT_FLOW[p.slotIndex].secondId && slotAssignments[SLOT_FLOW[p.slotIndex].secondId]));
      return `<span class="scan-wiz-step ${done ? "is-done" : ""} ${active ? "is-active" : ""} ${filled ? "is-filled" : ""}">${escapeHtml(p.label)}</span>`;
    })
    .join('<span class="scan-wiz-step-sep"></span>');
}

function updateSubtitle() {
  const el = $("scan-wiz-subtitle");
  if (!el) return;
  if (phase === "source") el.textContent = "Bekleyen set seçin veya manuel eklemeye başlayın.";
  else if (phase === "slot") {
    const def = currentSlotDef();
    el.textContent = def ? `${def.title} — sağda biriken önizleme` : "";
  } else if (phase === "patient") el.textContent = "Ölçüyü bir hastaya bağlayın.";
  else el.textContent = "Gönderim özetini kontrol edin.";
}

/* ─── Source ─── */

function renderPendingGroupPicker() {
  const fb = getFileBrowser?.();
  const pending = fb?.getPendingGroups?.() || [];
  if (!pending.length) return "";

  const cards = pending
    .slice(0, 8)
    .map((g) => {
      const files = g.unassigned?.length ? g.unassigned : g.files;
      const assignments = buildDefaultSlotAssignments(files);
      const ready = !!(assignments.upper && assignments.lower && (assignments.bite || assignments.bite2));
      return `
      <button type="button" class="scan-wiz-pending-card" data-pending-group="${escapeHtml(g.id)}">
        <span class="scan-wiz-pending-name">${escapeHtml(g.suggestedName)}</span>
        <span class="scan-wiz-pending-meta">${files.length} dosya${ready ? " · hazır set" : ""}</span>
      </button>`;
    })
    .join("");

  return `
    <div class="scan-wiz-section">
      <h3 class="scan-wiz-section-title">Bekleyen setler</h3>
      <p class="scan-wiz-pool-hint">Seçince dosyalar slotlara yerleşir; adım adım kontrol edersiniz.</p>
      <div class="scan-wiz-pending-list">${cards}</div>
    </div>`;
}

function renderSourceStep() {
  const pending = renderPendingGroupPicker();
  const fb = getFileBrowser?.();
  const watchFolder = fb?.getWatchFolder?.();

  return `
    ${pending || `<p class="scan-wiz-empty">Bekleyen ölçü seti yok.</p>`}
    <div class="scan-wiz-section scan-wiz-manual-section">
      <h3 class="scan-wiz-section-title">Manuel ekle</h3>
      <p class="scan-wiz-pool-hint">Üst çeneden başlayarak adım adım ekleyin.</p>
      ${watchFolder ? "" : `<div class="scan-wiz-alert scan-wiz-alert-warn mb-2">İzleme klasörü seçilmemiş. <button type="button" class="scan-wiz-link" data-open-settings>Ayarlardan seçin</button></div>`}
      <button type="button" class="scan-wiz-cta" data-manual-start ${watchFolder ? "" : "disabled"}>
        ${iconHtml("arrow-right", { size: 16, className: "mp-icon" })}
        <span>Üst çene ile başla</span>
      </button>
    </div>`;
}

/* ─── Slot step ─── */

function renderAssignedCard(file, slotId, { secondary = false } = {}) {
  if (!file) return "";
  return `
    <div class="scan-wiz-assigned ${secondary ? "is-secondary" : ""}">
      <div class="scan-wiz-assigned-check">${iconHtml("check", { size: 16, className: "mp-icon" })}</div>
      <div class="scan-wiz-assigned-meta">
        <span class="scan-wiz-assigned-label">${secondary ? "Kapanış 2" : "Eklendi"}</span>
        <span class="scan-wiz-assigned-name" title="${escapeHtml(file.filename)}">${escapeHtml(file.filename)}</span>
      </div>
      <button type="button" class="mp-icon-btn" data-clear-slot="${slotId}" title="Kaldır" aria-label="Kaldır">
        ${iconHtml("x", { size: 14, className: "mp-icon mp-icon-sm" })}
      </button>
    </div>`;
}

function renderDropzone({ forSecond = false } = {}) {
  const fb = getFileBrowser?.();
  const watchFolder = fb?.getWatchFolder?.();
  const attr = forSecond ? "data-drop-second" : "data-drop-primary";

  return `
    <div id="scan-wiz-dropzone" class="scan-wiz-dropzone scan-wiz-dropzone-hero ${watchFolder ? "" : "is-disabled"}" ${attr}>
      <div class="scan-wiz-dropzone-icon">${iconHtml("upload", { size: 32, className: "mp-icon mp-icon-xl" })}</div>
      <p class="scan-wiz-dropzone-title">Dosyayı buraya sürükleyin</p>
      <p class="scan-wiz-dropzone-sub">STL · PLY · OBJ</p>
      <button type="button" class="mp-btn-secondary text-xs mt-3" data-pick-files ${forSecond ? 'data-pick-second="1"' : ""} ${watchFolder ? "" : "disabled"}>
        Dosya seç…
      </button>
    </div>`;
}

function renderSlotStep() {
  const def = currentSlotDef();
  if (!def) return `<p class="scan-wiz-empty">Adım bulunamadı.</p>`;

  const primary = fileForSlot(def.id);
  const second = def.allowSecond && def.secondId ? fileForSlot(def.secondId) : null;
  const stepNum = slotIndex + 1;
  const total = SLOT_FLOW.length;

  let body = "";
  if (!primary) {
    body = renderDropzone();
  } else {
    body = `
      ${renderAssignedCard(primary, def.id)}
      ${
        def.allowSecond
          ? second
            ? renderAssignedCard(second, def.secondId, { secondary: true })
            : `
          <div class="scan-wiz-second-block">
            <p class="scan-wiz-pool-hint">İkinci kapanış (opsiyonel)</p>
            ${renderDropzone({ forSecond: true })}
          </div>`
          : ""
      }`;
  }

  return `
    <div class="scan-wiz-slot-step">
      <div class="scan-wiz-slot-step-kicker">Adım ${stepNum} / ${total}${def.required ? "" : " · opsiyonel"}</div>
      <h3 class="scan-wiz-slot-step-title">${escapeHtml(def.title)}</h3>
      <p class="scan-wiz-slot-step-hint">${escapeHtml(def.hint)}</p>
      ${body}
    </div>`;
}

/* ─── Patient / Confirm ─── */

function renderPatientStep() {
  const fb = getFileBrowser?.();
  const patients = fb?.patients || [];
  const analysis = selectionAnalysis();
  const group = {
    ...wizardGroup,
    fileStem: analysis?.stems?.length === 1 ? analysis.stems[0] : wizardGroup?.fileStem,
    suggestedName: wizardGroup?.suggestedName || "Yeni hasta",
    unassigned: submissionFiles(),
    pendingCount: submissionFiles().length,
    slotAssignments,
  };
  const suggestion = fb?.getSuggestionForGroup?.(group);
  const q = patientFilter.trim().toLowerCase();
  const filtered = patients.filter((p) => {
    if (!q) return true;
    return patientListLabel(p).toLowerCase().includes(q);
  });

  const namingHint =
    needsNamingHint(group.fileStem) &&
    `<div class="scan-wiz-alert scan-wiz-alert-info">Dosya adında soyad-ad ayrımı net değil. Yeni hasta oluşturursanız ismi düzenleyebilirsiniz.</div>`;

  const suggestionHtml = suggestion
    ? `
    <div class="scan-wiz-suggestion">
      <div class="scan-wiz-suggestion-label">Önerilen hasta</div>
      <div class="scan-wiz-suggestion-row">
        <span>${escapeHtml(patientListLabel(suggestion.patient))}</span>
        <span class="scan-wiz-suggestion-score">${suggestion.score}%</span>
      </div>
      <div class="scan-wiz-suggestion-actions">
        <button type="button" class="mp-btn-primary text-xs" data-use-suggestion="${suggestion.patient.id}">Öneriyi kullan</button>
        <button type="button" class="mp-btn-ghost text-xs" data-reject-suggestion="${suggestion.patient.id}">Bu değil</button>
      </div>
    </div>`
    : "";

  const list = filtered
    .slice(0, 40)
    .map((p) => {
      const active = selectedPatientId === p.id && !createNew;
      return `
      <button type="button" class="scan-wiz-patient-row ${active ? "is-active" : ""}" data-patient-id="${p.id}">
        ${escapeHtml(patientListLabel(p))}
      </button>`;
    })
    .join("");

  return `
    ${namingHint || ""}
    ${suggestionHtml}
    <div class="scan-wiz-section">
      <button type="button" class="scan-wiz-new-patient ${createNew ? "is-active" : ""}" data-create-new-patient>
        + Yeni hasta: ${escapeHtml(group.suggestedName)}
      </button>
      <input type="search" class="mp-input w-full text-xs mt-2" placeholder="Hasta ara…" id="scan-wiz-patient-search" value="${escapeHtml(patientFilter)}" />
      <div class="scan-wiz-patient-list">${list || '<p class="scan-wiz-empty">Hasta bulunamadı</p>'}</div>
    </div>`;
}

function renderConfirmStep() {
  const fb = getFileBrowser?.();
  const files = submissionFiles();
  const validation = slotValidation();
  const patient = createNew
    ? { surname: wizardGroup?.suggestedName, first_name: "" }
    : fb?.patients?.find((p) => p.id === selectedPatientId);

  const fileLines = SCAN_SLOT_DEFS.filter((def) => slotAssignments[def.id])
    .map((def) => {
      const file = wizardGroup.files.find((f) => f.path === slotAssignments[def.id]);
      if (!file) return "";
      const tag = def.required || def.requiredGroup ? "Gönderime" : "Ek";
      const tagCls = def.required || def.requiredGroup ? "scan-wiz-confirm-primary" : "scan-wiz-confirm-extra";
      return `<li><strong>${escapeHtml(def.label)}</strong> <span class="scan-wiz-confirm-tag ${tagCls}">${tag}</span> — ${escapeHtml(file.filename)}</li>`;
    })
    .join("");

  const unassigned = getUnassignedPoolFiles(slotAssignments, wizardGroup.files);

  return `
    <div class="scan-wiz-section">
      <h3 class="scan-wiz-section-title">Gönderim özeti</h3>
      <div class="scan-wiz-summary-row"><span>Hasta</span><strong>${escapeHtml(createNew ? `Yeni: ${wizardGroup.suggestedName}` : patientListLabel(patient || {}))}</strong></div>
      <div class="scan-wiz-summary-row"><span>Gönderime gidecek</span><strong>${files.length} dosya</strong></div>
      ${renderIssues(validation?.issues?.filter((i) => i.severity !== "info") || [])}
      <ul class="scan-wiz-summary-files">${fileLines}</ul>
      ${unassigned.length ? `<p class="scan-wiz-pool-hint mt-2">${unassigned.length} dosya gönderime dahil edilmeyecek.</p>` : ""}
    </div>`;
}

function renderIssues(issues) {
  if (!issues?.length) {
    return `<div class="scan-wiz-alert scan-wiz-alert-ok">Zorunlu slotlar dolu — gönderime hazır.</div>`;
  }
  return issues
    .map(
      (w) => `
    <div class="scan-wiz-alert ${severityClass(w.severity)}">
      <div class="scan-wiz-alert-title">${escapeHtml(w.title)}</div>
      <div class="scan-wiz-alert-msg">${escapeHtml(w.message)}</div>
    </div>`
    )
    .join("");
}

/* ─── Footer ─── */

function canAdvanceSlot() {
  const def = currentSlotDef();
  if (!def) return false;
  if (!def.required) return true;
  if (def.allowSecond) return !!(slotAssignments[def.id] || slotAssignments[def.secondId]);
  return !!slotAssignments[def.id];
}

function renderFooter() {
  const backHidden = phase === "source" ? "hidden" : "";
  let nextLabel = "Devam";
  let canNext = true;
  let showSkip = false;

  if (finishing) {
    nextLabel = "Bağlanıyor…";
    canNext = false;
  } else if (phase === "source") {
    nextLabel = "Üst çene ile başla";
    canNext = !!getFileBrowser?.()?.getWatchFolder?.();
  } else if (phase === "slot") {
    const def = currentSlotDef();
    showSkip = def && !def.required && !slotAssignments[def.id];
    if (slotIndex >= SLOT_FLOW.length - 1) nextLabel = "Hastaya geç";
    else nextLabel = "Sonraki";
    canNext = canAdvanceSlot();
  } else if (phase === "patient") {
    nextLabel = "Özete geç";
    canNext = createNew || !!selectedPatientId;
  } else if (phase === "confirm") {
    nextLabel = "Bağla ve bitir";
  }

  return `
    <button type="button" class="mp-btn-ghost text-xs" data-wiz-back ${backHidden}>Geri</button>
    <div class="scan-wiz-footer-right">
      ${showSkip ? '<button type="button" class="mp-btn-ghost text-xs" data-wiz-skip>Atla</button>' : ""}
      <button type="button" class="mp-btn-primary text-xs" data-wiz-next ${canNext ? "" : "disabled"}>${nextLabel}</button>
    </div>`;
}

/* ─── Render ─── */

function renderWizard() {
  const body = wizardEl("scan-wiz-body");
  const footer = wizardEl("scan-wiz-footer");
  const stepsEl = wizardEl("scan-wiz-steps");
  if (!body) return;

  try {
    updateSubtitle();
    if (stepsEl) stepsEl.innerHTML = renderStepIndicator();

    if (phase === "source") body.innerHTML = renderSourceStep();
    else if (phase === "slot") body.innerHTML = renderSlotStep();
    else if (phase === "patient") body.innerHTML = renderPatientStep();
    else if (phase === "confirm") body.innerHTML = renderConfirmStep();
    else body.innerHTML = `<p class="scan-wiz-empty">Bilinmeyen adım</p>`;

    if (footer) footer.innerHTML = renderFooter();
    bindStepEvents();
    initIcons(document.getElementById("scan-import-wizard"));
    syncPreview();
  } catch (err) {
    console.error("[scanWizard] render:", err);
    body.innerHTML = `<p class="scan-wiz-empty text-red-400">Sihirbaz yüklenemedi: ${escapeHtml(err.message)}</p>`;
  }
}

/* ─── Navigation ─── */

function goNext() {
  if (phase === "source") {
    setPhase("slot", 0);
    return;
  }
  if (phase === "slot") {
    if (!canAdvanceSlot()) return;
    if (slotIndex < SLOT_FLOW.length - 1) {
      setPhase("slot", slotIndex + 1);
      return;
    }
    setPhase("patient");
    return;
  }
  if (phase === "patient") {
    setPhase("confirm");
    return;
  }
  if (phase === "confirm") {
    finishWizard().catch((err) => alert(err.message || String(err)));
  }
}

function goBack() {
  if (phase === "slot") {
    if (slotIndex > 0) setPhase("slot", slotIndex - 1);
    else setPhase("source");
    return;
  }
  if (phase === "patient") {
    setPhase("slot", SLOT_FLOW.length - 1);
    return;
  }
  if (phase === "confirm") setPhase("patient");
}

function skipOptional() {
  const def = currentSlotDef();
  if (!def || def.required) return;
  if (slotAssignments[def.id]) {
    slotAssignments = clearSlot(def.id, slotAssignments);
    if (wizardGroup) wizardGroup.slotAssignments = slotAssignments;
  }
  goNext();
}

/* ─── Events ─── */

function bindStepEvents() {
  const body = wizardEl("scan-wiz-body");
  const footer = wizardEl("scan-wiz-footer");
  if (!body) return;

  body.querySelector("[data-open-settings]")?.addEventListener("click", () => openSettingsModal("watch"));

  body.querySelector("[data-manual-start]")?.addEventListener("click", () => {
    wizardGroup = null;
    slotAssignments = emptySlotAssignments();
    setPhase("slot", 0);
  });

  body.querySelectorAll("[data-pending-group]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fb = getFileBrowser?.();
      const group = fb?.findGroupById?.(btn.dataset.pendingGroup);
      if (group) startWithGroup(group);
    });
  });

  body.querySelectorAll("[data-pick-files]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const forSecond = btn.dataset.pickSecond === "1";
      pickAndImportFiles({ forSecond }).catch((err) => alert(err.message || String(err)));
    });
  });

  body.querySelectorAll("[data-clear-slot]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const slotId = btn.dataset.clearSlot;
      slotAssignments = clearSlot(slotId, slotAssignments);
      if (wizardGroup) {
        wizardGroup.slotAssignments = slotAssignments;
        wizardGroup.selectedFiles = getFilesFromAssignments(slotAssignments, wizardGroup.files);
      }
      renderWizard();
    });
  });

  body.querySelector("[data-use-suggestion]")?.addEventListener("click", (e) => {
    selectedPatientId = e.target.dataset.useSuggestion;
    createNew = false;
    setPhase("confirm");
  });

  body.querySelector("[data-reject-suggestion]")?.addEventListener("click", async (e) => {
    const fb = getFileBrowser?.();
    const patientId = e.target.dataset.rejectSuggestion;
    const analysis = selectionAnalysis();
    const stem = analysis?.stems?.[0] || wizardGroup?.fileStem;
    try {
      await rejectStemSuggestion(stem, patientId);
      await fb?.refresh?.();
      renderWizard();
    } catch (err) {
      console.warn(err);
    }
  });

  body.querySelector("[data-create-new-patient]")?.addEventListener("click", () => {
    createNew = true;
    selectedPatientId = null;
    renderWizard();
  });

  body.querySelectorAll("[data-patient-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedPatientId = btn.dataset.patientId;
      createNew = false;
      renderWizard();
    });
  });

  const search = body.querySelector("#scan-wiz-patient-search");
  search?.addEventListener("input", () => {
    patientFilter = search.value;
    renderWizard();
    body.querySelector("#scan-wiz-patient-search")?.focus();
  });

  footer?.querySelector("[data-wiz-back]")?.addEventListener("click", goBack);
  footer?.querySelector("[data-wiz-next]")?.addEventListener("click", () => {
    if (finishing) return;
    goNext();
  });
  footer?.querySelector("[data-wiz-skip]")?.addEventListener("click", skipOptional);
}

/* ─── File import ─── */

function targetSlotId({ forSecond = false } = {}) {
  const def = currentSlotDef();
  if (!def) return "upper";
  if (forSecond && def.secondId) return def.secondId;
  return def.id;
}

async function pickAndImportFiles({ forSecond = false } = {}) {
  const fb = getFileBrowser?.();
  if (!fb?.getWatchFolder?.()) {
    openSettingsModal("watch");
    throw new Error("Önce ayarlardan izleme klasörü seçin.");
  }

  const def = currentSlotDef();
  const selected = await open({
    multiple: false,
    title: `${def?.label || "Ölçü"} — dosya seç`,
    filters: [{ name: "Tarama", extensions: ["stl", "ply", "dcm", "obj"] }],
  });
  if (!selected) return;
  const path = Array.isArray(selected) ? selected[0] : selected;
  await importPaths([path], { targetSlot: targetSlotId({ forSecond }) });
}

async function importPaths(paths, { targetSlot = null } = {}) {
  const staged = new Set(wizardGroup?.files?.map((f) => f.path) || []);
  const incoming = paths.filter((p) => !staged.has(p));
  if (!incoming.length && paths.length) {
    const existing = wizardGroup?.files?.find((f) => f.path === paths[0]);
    if (existing && targetSlot) {
      slotAssignments = assignPathToSlot(targetSlot, existing.path, slotAssignments);
      if (wizardGroup) {
        wizardGroup.slotAssignments = slotAssignments;
        wizardGroup.selectedFiles = getFilesFromAssignments(slotAssignments, wizardGroup.files);
      }
      renderWizard();
    }
    return;
  }
  if (!incoming.length) return;

  const imported = await invoke("import_scan_files", { paths: incoming });
  await getFileBrowser?.()?.refresh?.();
  addFilesToWizard(imported, { targetSlot });
}

function addFilesToWizard(newFiles, { targetSlot = null } = {}) {
  if (!newFiles?.length) return;

  const existing = wizardGroup?.files || [];
  const byPath = new Map(existing.map((f) => [f.path, f]));
  for (const f of newFiles) byPath.set(f.path, f);
  const merged = [...byPath.values()];

  wizardGroup = buildWizardGroupFromFiles(merged, { id: wizardGroup?.id });
  slotAssignments = wizardGroup.slotAssignments;
  syncSlotsFromPool();

  const slot = targetSlot || (phase === "slot" ? targetSlotId() : null);
  if (slot && newFiles[0]?.path) {
    slotAssignments = assignPathToSlot(slot, newFiles[0].path, slotAssignments);
    wizardGroup.slotAssignments = slotAssignments;
    wizardGroup.selectedFiles = getFilesFromAssignments(slotAssignments, wizardGroup.files);
  }

  if (phase === "source") setPhase("slot", 0);
  else renderWizard();
}

function startWithGroup(group) {
  const files = group.unassigned?.length ? group.unassigned : group.files;
  wizardGroup = buildWizardGroupFromFiles(files, { id: group.id });
  wizardGroup.suggestedName = group.suggestedName;
  wizardGroup.fileStem = group.fileStem;
  slotAssignments = wizardGroup.slotAssignments;
  syncSlotsFromPool({ reset: true });
  selectedPatientId = null;
  createNew = false;
  patientFilter = "";

  // İlk boş zorunlu slotta başla; hepsi doluysa ilk adımdan gözden geçir
  let start = 0;
  for (let i = 0; i < SLOT_FLOW.length; i++) {
    const def = SLOT_FLOW[i];
    if (def.required && !slotAssignments[def.id] && !(def.secondId && slotAssignments[def.secondId])) {
      start = i;
      break;
    }
  }
  setPhase("slot", start);
}

async function finishWizard() {
  const fb = getFileBrowser?.();
  if (!fb) throw new Error("Dosya tarayıcı hazır değil");

  const files = submissionFiles();
  if (!files.length) throw new Error("Bağlanacak dosya yok");

  const completeness = analyzeLinkCompleteness(files);
  const patientLabel = createNew
    ? wizardGroup.suggestedName || "Yeni hasta"
    : patientListLabel(fb.patients.find((p) => p.id === selectedPatientId) || {});

  const confirmed = await askLinkScanSetConfirm({
    patientLabel,
    isNewPatient: createNew,
    files,
    completeness,
  });
  if (!confirmed) return;

  finishing = true;
  renderWizard();

  try {
    const group = {
      ...wizardGroup,
      suggestedName: wizardGroup.suggestedName,
      fileStem: wizardGroup.fileStem,
      slotAssignments,
      unassigned: files.filter((f) => {
        const link = fb.scanLinks?.get?.(f.path);
        return !link || link.patient_id !== (createNew ? null : selectedPatientId);
      }),
    };

    if (createNew) {
      const created = await fb.createPatientAndLinkFiles(group, files, { batchSet: true });
      if (!created) throw new Error("Hasta oluşturulamadı");
    } else {
      const patient = fb.patients.find((p) => p.id === selectedPatientId);
      if (!patient) throw new Error("Hasta seçin");
      const linked = await fb.linkFilesToPatientPublic(patient, files, { batchSet: true });
      const needsLink = files.some((f) => fb.scanLinks?.get?.(f.path)?.patient_id !== patient.id);
      if (linked === null && needsLink) {
        throw new Error("Bağlama tamamlanamadı. Onay penceresini kontrol edin veya iptal ettiyseniz tekrar deneyin.");
      }
    }

    await fb.refresh();
    closeScanImportWizard();
    onComplete?.();
  } finally {
    finishing = false;
    if ($("scan-import-wizard") && !$("scan-import-wizard").classList.contains("hidden")) {
      renderWizard();
    }
  }
}

/* ─── Drag & drop ─── */

async function setupDragDrop() {
  if (dragUnlisten) return;
  const win = getCurrentWindow();
  dragUnlisten = await win.onDragDropEvent((event) => {
    if ($("scan-import-wizard")?.classList.contains("hidden")) return;
    if (phase !== "slot") return;

    const fb = getFileBrowser?.();
    if (!fb?.getWatchFolder?.()) return;

    const dropzone = $("scan-wiz-dropzone");
    const { type } = event.payload;

    if (type === "over" || type === "enter") {
      dropzone?.classList.add("is-dragover");
    } else if (type === "leave") {
      dropzone?.classList.remove("is-dragover");
    } else if (type === "drop") {
      dropzone?.classList.remove("is-dragover");
      const paths = event.payload.paths || [];
      if (!paths.length) return;
      const forSecond = dropzone?.hasAttribute("data-drop-second");
      importPaths(paths.slice(0, 1), { targetSlot: targetSlotId({ forSecond }) }).catch((err) =>
        alert(err.message || String(err))
      );
    }
  });
}

function teardownDragDrop() {
  dragUnlisten?.();
  dragUnlisten = null;
}

/* ─── Public API ─── */

export function openScanImportWizard({ groupId = null, filePath = null, startManual = false } = {}) {
  const fb = getFileBrowser?.();
  setVisible(true);
  setupDragDrop().catch(() => {});

  if (groupId && fb) {
    const group = fb.findGroupById(groupId);
    if (group) {
      startWithGroup(group);
      return;
    }
  }

  if (filePath && fb) {
    const group = fb.findGroupForPath(filePath);
    if (group) {
      startWithGroup(group);
      return;
    }
  }

  wizardGroup = null;
  slotAssignments = emptySlotAssignments();
  selectedPatientId = null;
  createNew = false;
  patientFilter = "";

  if (startManual) {
    phase = "slot";
    slotIndex = 0;
  } else {
    phase = "source";
    slotIndex = 0;
  }
  renderWizard();
}

export function closeScanImportWizard() {
  setVisible(false);
  finishing = false;
  wizardGroup = null;
  disposePreview();
}

export function initScanImportWizard({ getFileBrowser: getFb, onComplete: onDone, getLastNewScanPath: getLastPath } = {}) {
  getFileBrowser = getFb;
  onComplete = onDone;
  getLastNewScanPath = getLastPath;

  $("btn-close-scan-wizard")?.addEventListener("click", closeScanImportWizard);
  $("scan-import-wizard")?.addEventListener("click", (e) => {
    if (e.target.id === "scan-import-wizard") closeScanImportWizard();
  });
}

export function disposeScanImportWizard() {
  teardownDragDrop();
  disposePreview();
}
