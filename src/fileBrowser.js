import { invoke } from "@tauri-apps/api/core";
import {
  buildLinkableGroups,
  classifyScanType,
  extractFileStem,
  formatFileSize,
  getPatientScanCount,
  groupFilesIntoSessions,
  needsNamingHint,
  parseSuggestedName,
  SCAN_LABELS,
} from "./utils.js";
import {
  createPatient,
  createPatientFromGroup,
  deletePatient,
  listPatients,
  listScanLinks,
  patientDisplayName,
  patientListLabel,
  updatePatient,
} from "./patients.js";
import {
  createCase,
  findCaseForDay,
  detachScan,
  linkScansToCase,
  listCaseScans,
  listPatientCases,
  reassignScan,
} from "./cases.js";
import { askDetachReason, askReassignReason, askSameDayCase } from "./caseModals.js";
import { topPatientSuggestion } from "./patientSuggestion.js";
import { buildStemAliasMap, listStemAliases } from "./patientStemAliases.js";
import {
  buildStemRejectionSet,
  listStemRejections,
  rejectStemSuggestion,
} from "./patientStemRejections.js";
import { renderCaseStatusSteps } from "./caseStatusSteps.js";
import {
  displayCaseStatus,
  hasPlanningContent,
  planningActionLabel,
} from "./casePlanning.js";
import {
  comparePatientsByActivity,
  comparePatientsBySurname,
  summarizePatientCases,
} from "./patientListSummary.js";

const SCAN_TYPES = ["upper", "lower", "bite"];

const GROUP_FILTERS = [
  { id: "pending", label: "Bekleyen" },
  { id: "all", label: "Tümü" },
];

function formatDate(timestamp) {
  if (!timestamp) return "—";
  return new Date(timestamp * 1000).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortDate(timestamp) {
  if (!timestamp) return "—";
  return new Date(timestamp * 1000).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function dayKey(timestamp) {
  const d = new Date(timestamp * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function typeBadgeClass(type) {
  return {
    upper: "bg-medical-accent/20 text-medical-accent",
    lower: "bg-medical-green/20 text-medical-green",
    bite: "bg-orange-400/20 text-orange-400",
  }[type] || "bg-anthracite-700 text-gray-400";
}

function scanDots(group) {
  return SCAN_TYPES.map((type) => {
    const has = !!group.scans?.[type];
    const colors = {
      upper: has ? "bg-medical-accent" : "bg-anthracite-600",
      lower: has ? "bg-medical-green" : "bg-anthracite-600",
      bite: has ? "bg-orange-400" : "bg-anthracite-600",
    };
    return `<span class="w-2 h-2 rounded-full ${colors[type]}" title="${SCAN_LABELS[type]}"></span>`;
  }).join("");
}

function setStatusLabel(count) {
  if (count >= 3) return { text: "Tam set", cls: "text-medical-green" };
  if (count > 0) return { text: `${count}/3`, cls: "text-orange-400" };
  return { text: "Boş", cls: "mp-text-faint" };
}

function sidexisField(label, value, { html = false } = {}) {
  const inner = html ? value : value || "—";
  const valueCls = html ? "mp-field-value mp-field-value-rich" : "mp-field-value";
  return `
    <div class="mp-field mp-field-readonly">
      <div class="mp-field-label">${label}</div>
      <div class="${valueCls}">${inner}</div>
      <div class="mp-field-line"></div>
    </div>`;
}

function mergeLinkWithFile(link, fileMap) {
  const file = fileMap.get(link.file_path);
  if (!file) return null;
  return {
    path: link.file_path,
    filename: link.filename || file.filename,
    fileStem: link.file_stem || file.fileStem,
    size_bytes: file.size_bytes,
    modified_at: file.modified_at,
    scanType: link.scan_type || file.scanType,
  };
}

export class FileBrowser {
  constructor(options) {
    this.listContainer = options.listContainer;
    this.detailContainer = options.detailContainer;
    this.casePreviewMetaEl = options.casePreviewMetaEl || document.getElementById("case-preview-meta");
    this.casePreviewFilesEl = options.casePreviewFilesEl || document.getElementById("case-preview-files");
    this.previewPanelEl = options.previewPanelEl || document.getElementById("preview-panel");
    this.onPatientSelect = options.onPatientSelect;
    this.onSessionSelect = options.onSessionSelect;
    this.onPatientUpdated = options.onPatientUpdated;
    this.onOpenPlanning = options.onOpenPlanning;
    this.onCaseLinked = options.onCaseLinked;
    this.onToggleScan = options.onToggleScan;
    this.getSessionPaths = options.getSessionPaths;
    this.getSessionPatientKey = options.getSessionPatientKey;
    this.isScanVisible = options.isScanVisible;
    this.getNewFilePaths = options.getNewFilePaths;

    this.patients = [];
    this.scanLinks = new Map();
    this.stemAliases = new Map();
    this.stemRejections = new Set();
    this.folderFiles = [];
    this.folderFileMap = new Map();
    this.groupFilter = "pending";
    this.expandedGroupIds = new Set();
    this.searchQuery = "";
    this.patientSort = "surname";
    this.selectedPatient = null;
    this.selectedSessionId = null;
    this.sessionsByPatient = new Map();
    this.watchFolder = null;

    this._renderListShell();
    this._renderDetailShell();
    this._bindEvents();
  }

  _renderListShell() {
    this.listContainer.innerHTML = `
      <div class="file-browser flex flex-col h-full min-h-0 gap-2">
        <div id="pending-section" class="flex flex-col shrink-0 max-h-[42%] min-h-0">
          <div class="flex items-center justify-between mb-1.5 shrink-0">
            <span class="text-sm font-semibold mp-text-title">Ölçü grupları</span>
            <div id="group-filters" class="flex gap-1"></div>
          </div>
          <p class="text-[10px] mp-text-faint mb-1.5 shrink-0 leading-relaxed">
            Üst + alt + kapanış aynı isimle gruplanır. Seti tek tıkla hastaya bağlayın.
          </p>
          <div id="pending-meta" class="text-[10px] mp-text-faint mb-1 shrink-0"></div>
          <div id="pending-groups" class="flex-1 min-h-0 overflow-y-auto rounded-lg patient-list-scroll"></div>
        </div>

        <div class="mp-border-t pt-2 flex flex-col flex-1 min-h-0">
          <div class="flex items-center justify-between gap-2 mb-2 shrink-0">
            <span class="text-sm font-semibold mp-text-title">Hastalar</span>
            <div class="flex items-center gap-1">
              <div class="patient-sort-toggle" role="group" aria-label="Sıralama">
                <button type="button" data-patient-sort="surname" class="patient-sort-btn is-active" title="Soyada göre">A–Z</button>
                <button type="button" data-patient-sort="activity" class="patient-sort-btn" title="Son aktiviteye göre">Son</button>
              </div>
              <button id="btn-new-patient" type="button" class="mp-btn-ghost text-[10px] px-2 py-0.5 rounded">+ Yeni</button>
            </div>
          </div>
          <div class="relative mb-2 shrink-0">
            <input id="patient-search" type="search" placeholder="Hasta ara..."
              class="mp-input w-full pl-8 pr-3 py-2 rounded-lg text-xs" />
            <span class="absolute left-2.5 top-1/2 -translate-y-1/2 mp-text-faint text-xs">🔍</span>
          </div>
          <div id="patient-list-meta" class="text-[10px] mp-text-faint mb-1 shrink-0"></div>
          <div id="patient-list" class="flex-1 min-h-0 overflow-y-auto rounded-lg patient-list-scroll"></div>
        </div>
      </div>
    `;

    this.patientSearchInput = this.listContainer.querySelector("#patient-search");
    this.patientListEl = this.listContainer.querySelector("#patient-list");
    this.patientMetaEl = this.listContainer.querySelector("#patient-list-meta");
    this.pendingGroupsEl = this.listContainer.querySelector("#pending-groups");
    this.pendingMetaEl = this.listContainer.querySelector("#pending-meta");
    this.groupFiltersEl = this.listContainer.querySelector("#group-filters");

    this._renderGroupFilters();
  }

  _renderGroupFilters() {
    this.groupFiltersEl.innerHTML = GROUP_FILTERS.map(
      (f) => `
      <button type="button" data-group-filter="${f.id}"
        class="filter-chip px-2 py-0.5 rounded text-[10px] font-medium transition-colors
        ${f.id === this.groupFilter ? "filter-chip-active" : ""}">
        ${f.label}
      </button>`
    ).join("");
  }

  _renderDetailShell() {
    if (!this.detailContainer) return;
    this.detailContainer.innerHTML = `
      <div id="patient-detail-inner" class="flex flex-col h-full min-h-0">
        <div id="patient-detail-empty" class="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div class="w-16 h-16 rounded-full bg-anthracite-800 flex items-center justify-center text-2xl mb-3 opacity-60">👤</div>
          <p class="text-sm mp-text-muted">Hasta seçin veya yeni kayıt oluşturun</p>
          <p class="text-[10px] mp-text-faint mt-1 max-w-xs">Üstteki gruptan ölçüyü hastaya bağlayın veya yeni hasta oluşturun.</p>
          <button id="btn-empty-new-patient" type="button" class="mt-3 mp-btn-secondary text-xs px-3 py-1.5 rounded-lg">+ Yeni hasta</button>
        </div>
        <div id="patient-detail-content" class="hidden flex-1 min-h-0 flex flex-col overflow-hidden"></div>
      </div>
    `;
    this.detailEmptyEl = this.detailContainer.querySelector("#patient-detail-empty");
    this.detailContentEl = this.detailContainer.querySelector("#patient-detail-content");
  }

  _bindEvents() {
    this.patientSearchInput.addEventListener("input", () => {
      this.searchQuery = this.patientSearchInput.value.trim().toLowerCase();
      this.render();
    });

    this.listContainer.querySelectorAll("[data-patient-sort]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.patientSort = btn.dataset.patientSort;
        this.listContainer.querySelectorAll("[data-patient-sort]").forEach((b) => {
          b.classList.toggle("is-active", b.dataset.patientSort === this.patientSort);
        });
        this.render();
      });
    });

    this.listContainer.querySelector("#btn-new-patient").addEventListener("click", () => this._createPatient());
    this.detailContainer?.querySelector("#btn-empty-new-patient")?.addEventListener("click", () => this._createPatient());

    this.groupFiltersEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-group-filter]");
      if (!btn) return;
      this.groupFilter = btn.dataset.groupFilter;
      this._renderGroupFilters();
      this.render();
    });

    this.patientListEl.addEventListener("click", (e) => {
      const row = e.target.closest("[data-patient-id]");
      if (!row) return;
      const patient = this.patients.find((p) => p.id === row.dataset.patientId);
      if (patient) this.openPatient(patient);
    });

    this.pendingGroupsEl.addEventListener("click", async (e) => {
      const createBtn = e.target.closest("[data-action='create-link']");
      if (createBtn) {
        const group = this._findGroup(createBtn.dataset.groupId);
        if (group) await this._createAndLinkGroup(group);
        return;
      }

      const linkBtn = e.target.closest("[data-action='link-selected']");
      if (linkBtn) {
        const group = this._findGroup(linkBtn.dataset.groupId);
        if (group) await this._linkGroup(group, this.selectedPatient);
        return;
      }

      const suggestBtn = e.target.closest("[data-action='link-suggested']");
      if (suggestBtn) {
        const group = this._findGroup(suggestBtn.dataset.groupId);
        const patient = this.patients.find((p) => p.id === suggestBtn.dataset.patientId);
        if (group && patient) await this._linkGroup(group, patient);
        return;
      }

      const rejectBtn = e.target.closest("[data-action='reject-suggested']");
      if (rejectBtn) {
        const group = this._findGroup(rejectBtn.dataset.groupId);
        const patientId = rejectBtn.dataset.patientId;
        if (group && patientId) {
          await rejectStemSuggestion(group.fileStem, patientId);
          await this.refresh();
        }
        return;
      }

      const toggleBtn = e.target.closest("[data-action='toggle-expand']");
      if (toggleBtn) {
        const id = toggleBtn.dataset.groupId;
        if (this.expandedGroupIds.has(id)) this.expandedGroupIds.delete(id);
        else this.expandedGroupIds.add(id);
        this.render();
        return;
      }

      const linkFileBtn = e.target.closest("[data-action='link-file']");
      if (linkFileBtn) {
        await this._linkFileToPatient(linkFileBtn.dataset.path, this.selectedPatient);
        return;
      }

      const reassignBtn = e.target.closest("[data-action='reassign-file']");
      if (reassignBtn) {
        await this._reassignFileToPatient(reassignBtn.dataset.path, this.selectedPatient);
        return;
      }

      const detachBtn = e.target.closest("[data-action='detach-file']");
      if (detachBtn) {
        await this._detachFile(detachBtn.dataset.path);
        return;
      }
    });

    this.previewPanelEl?.addEventListener("click", async (e) => {
      const detachBtn = e.target.closest("[data-action='detach-file']");
      if (detachBtn) {
        await this._detachFile(detachBtn.dataset.path);
        return;
      }

      const planBtn = e.target.closest("[data-action='open-planning']");
      if (planBtn && this.selectedPatient) {
        const sessions = this.getPatientSessions(this.selectedPatient.id);
        const session =
          sessions.find((s) => s.id === planBtn.dataset.sessionId) || this.getActiveScanSession();
        if (session?.caseId) {
          this.onOpenPlanning?.(this.selectedPatient, session);
        }
      }
    });

    this.detailContentEl?.addEventListener("click", async (e) => {
      if (e.target.closest("#btn-save-patient")) {
        await this._savePatientForm();
        return;
      }
      if (e.target.closest("#btn-delete-patient")) {
        await this._deleteSelectedPatient();
        return;
      }

      const sessionBtn = e.target.closest("[data-session-id]");
      if (sessionBtn && this.selectedPatient && !e.target.closest("[data-action='open-planning']")) {
        this.selectedSessionId = sessionBtn.dataset.sessionId;
        const session = this.getActiveScanSession();
        this.onSessionSelect?.(this.selectedPatient, session);
        this.render();
        return;
      }

      const planBtn = e.target.closest("[data-action='open-planning']");
      if (planBtn && this.selectedPatient) {
        const sessions = this.getPatientSessions(this.selectedPatient.id);
        const session =
          sessions.find((s) => s.id === planBtn.dataset.sessionId) || this.getActiveScanSession();
        if (session?.caseId) {
          this.onOpenPlanning?.(this.selectedPatient, session);
        }
        return;
      }

      const detachBtn = e.target.closest("[data-action='detach-file']");
      if (detachBtn) {
        await this._detachFile(detachBtn.dataset.path);
        return;
      }
    });
  }

  async _createPatient() {
    try {
      const patient = await createPatient("", "", "");
      await this._loadPatients();
      this.openPatient(this.patients.find((p) => p.id === patient.id) || patient);
    } catch (err) {
      alert(`Hasta oluşturulamadı: ${err}`);
    }
  }

  async _savePatientForm() {
    if (!this.selectedPatient || !this.detailContentEl) return;
    const surname = this.detailContentEl.querySelector("#edit-surname")?.value ?? "";
    const firstName = this.detailContentEl.querySelector("#edit-first-name")?.value ?? "";
    const notes = this.detailContentEl.querySelector("#edit-notes")?.value ?? "";
    try {
      const updated = await updatePatient(this.selectedPatient.id, surname, firstName, notes);
      await this._loadPatients();
      this.selectedPatient = this.patients.find((p) => p.id === updated.id) || updated;
      this.onPatientUpdated?.(this.selectedPatient);
      this.render();
    } catch (err) {
      alert(`Kaydedilemedi: ${err}`);
    }
  }

  async _deleteSelectedPatient() {
    if (!this.selectedPatient) return;
    const name = patientDisplayName(this.selectedPatient);
    if (!confirm(`"${name}" kaydını silmek istediğinize emin misiniz? Bağlı ölçü eşleşmeleri de silinir.`)) return;
    try {
      await deletePatient(this.selectedPatient.id);
      this.selectedPatient = null;
      this.selectedSessionId = null;
      await this._loadPatients();
      await this._loadScanLinks();
      await this._loadCasesCache();
      this.render();
      this.onPatientSelect?.(null, null);
    } catch (err) {
      alert(`Silinemedi: ${err}`);
    }
  }

  async _resolveCaseForPatient(patientId, sessionDay) {
    const existing = await findCaseForDay(patientId, sessionDay);
    if (existing) {
      const choice = await askSameDayCase(existing);
      if (choice === "cancel") return null;
      if (choice === "add") return { caseId: existing.id, case: existing };
      const created = await createCase(patientId, sessionDay);
      return { caseId: created.id, case: created };
    }
    const created = await createCase(patientId, sessionDay);
    return { caseId: created.id, case: created };
  }

  async _linkFilesToPatient(patient, files) {
    if (!patient || !files.length) return null;

    const pending = [];
    for (const file of files) {
      const link = this.scanLinks.get(file.path);
      if (!link) {
        pending.push(file);
        continue;
      }
      if (link.patient_id === patient.id) continue;

      const fromPatient = this.patients.find((p) => p.id === link.patient_id);
      const reason = await askReassignReason(
        patientListLabel(fromPatient || { surname: "?", first_name: "" }),
        patientListLabel(patient)
      );
      if (!reason) return null;

      const sessionDay = dayKey(file.modified_at);
      const resolved = await this._resolveCaseForPatient(patient.id, sessionDay);
      if (!resolved) return null;

      await reassignScan(file.path, patient.id, resolved.caseId, reason);
    }

    if (pending.length === 0) {
      await this._afterLink(patient);
      return { caseId: this.selectedSessionId };
    }

    const sessionDay = dayKey(pending[0].modified_at);
    const resolved = await this._resolveCaseForPatient(patient.id, sessionDay);
    if (!resolved) return null;

    await linkScansToCase(patient.id, resolved.caseId, pending);
    await this._afterLink(patient, resolved.caseId);
    return resolved;
  }

  async _reassignFileToPatient(filePath, patient) {
    if (!patient) {
      alert("Önce alttan bir hasta seçin.");
      return;
    }
    const file = this.folderFileMap.get(filePath);
    if (!file) return;

    const link = this.scanLinks.get(filePath);
    if (!link) {
      await this._linkFilesToPatient(patient, [file]);
      return;
    }
    if (link.patient_id === patient.id) {
      alert("Bu ölçü zaten seçili hastaya bağlı.");
      return;
    }

    const fromPatient = this.patients.find((p) => p.id === link.patient_id);
    const reason = await askReassignReason(
      patientListLabel(fromPatient || { surname: "?", first_name: "" }),
      patientListLabel(patient)
    );
    if (!reason) return;

    const sessionDay = dayKey(file.modified_at);
    const resolved = await this._resolveCaseForPatient(patient.id, sessionDay);
    if (!resolved) return;

    await reassignScan(filePath, patient.id, resolved.caseId, reason);
    await this._afterLink(patient, resolved.caseId);
  }

  async _detachFile(filePath) {
    const link = this.scanLinks.get(filePath);
    const file = this.folderFileMap.get(filePath);
    if (!link) return;

    const patient = this.patients.find((p) => p.id === link.patient_id);
    const filename = file?.filename || link.filename;
    const reason = await askDetachReason(filename, patientListLabel(patient || { surname: "?", first_name: "" }));
    if (!reason) return;

    try {
      await detachScan(filePath, reason);
      await this._loadPatients();
      await this._loadScanLinks();
      await this._loadCasesCache();
      this.render();
      if (this.selectedPatient) {
        const session = this.getActiveScanSession();
        this.onSessionSelect?.(this.selectedPatient, session);
      }
    } catch (err) {
      alert(`Kaldırılamadı: ${err}`);
    }
  }

  async _linkGroup(group, patient) {
    if (!patient || !group.unassigned.length) return;
    try {
      await this._linkFilesToPatient(patient, group.unassigned);
    } catch (err) {
      alert(`Bağlanamadı: ${err}`);
    }
  }

  async _createAndLinkGroup(group) {
    if (!group.unassigned.length) return;
    try {
      const created = await createPatientFromGroup(group);
      await this._linkFilesToPatient(created, group.unassigned);
    } catch (err) {
      alert(`Hasta oluşturulamadı: ${err}`);
    }
  }

  async _linkFileToPatient(filePath, patient) {
    if (!patient) {
      alert("Önce alttan bir hasta seçin.");
      return;
    }
    const file = this.folderFileMap.get(filePath);
    if (!file) return;
    try {
      await this._linkFilesToPatient(patient, [file]);
    } catch (err) {
      alert(`Bağlanamadı: ${err}`);
    }
  }

  async _afterLink(patient, caseId = null) {
    await this._loadPatients();
    await this._loadScanLinks();
    await this._loadStemAliases();
    await this._loadCasesCache();
    this.selectedPatient = this.patients.find((p) => p.id === patient.id) || patient;
    if (caseId) this.selectedSessionId = caseId;
    this.openPatient(this.selectedPatient, caseId || undefined);

    const session = this.getActiveScanSession();
    if (session?.caseId) {
      this.onCaseLinked?.(this.selectedPatient, session);
    }
  }

  _sessionFromCase(caseRow, links) {
    const files = links
      .map((link) => mergeLinkWithFile(link, this.folderFileMap))
      .filter(Boolean);
    const scans = { upper: null, lower: null, bite: null };
    let modifiedAt = caseRow.updated_at || 0;

    for (const file of files) {
      modifiedAt = Math.max(modifiedAt, file.modified_at);
      const type = file.scanType;
      if (type === "upper" || type === "lower" || type === "bite") {
        const existing = scans[type];
        if (!existing || file.modified_at > existing.modified_at) {
          scans[type] = file;
        }
      }
    }

    return {
      id: caseRow.id,
      caseId: caseRow.id,
      caseNumber: caseRow.case_number,
      status: caseRow.status,
      sentAt: caseRow.sent_at ?? null,
      sessionDay: caseRow.session_day,
      modifiedAt,
      scans,
      files,
      case: caseRow,
    };
  }

  async _loadCasesCache() {
    const patientIds = new Set([...this.scanLinks.values()].map((l) => l.patient_id));
    this.sessionsByPatient = new Map();

    await Promise.all(
      [...patientIds].map(async (patientId) => {
        const cases = await listPatientCases(patientId);
        const sessions = await Promise.all(
          cases.map(async (c) => {
            const links = await listCaseScans(c.id);
            return this._sessionFromCase(c, links);
          })
        );
        sessions.sort((a, b) => b.modifiedAt - a.modifiedAt);
        this.sessionsByPatient.set(patientId, sessions);
      })
    );
  }

  _getLinkableGroups() {
    return buildLinkableGroups(this.folderFiles, (path) => this.scanLinks.has(path));
  }

  _findGroup(groupId) {
    return this._getLinkableGroups().find((g) => g.id === groupId);
  }

  highlightGroupForPath(filePath) {
    const groups = this._getLinkableGroups();
    const group = groups.find((g) => g.files.some((f) => f.path === filePath));
    if (group) {
      this.expandedGroupIds.add(group.id);
      this.groupFilter = "all";
      this._renderGroupFilters();
    }
  }

  getSuggestionForPath(filePath) {
    const groups = this._getLinkableGroups();
    const group = groups.find((g) => g.files.some((f) => f.path === filePath));
    if (!group?.pendingCount) return null;
    return topPatientSuggestion(group, this.patients, this.scanLinks, this.stemAliases, this.stemRejections);
  }

  _suggestedPatientIds() {
    const ids = new Set();
    for (const group of this._getLinkableGroups()) {
      if (!group.pendingCount) continue;
      const top = topPatientSuggestion(
        group,
        this.patients,
        this.scanLinks,
        this.stemAliases,
        this.stemRejections
      );
      if (top) ids.add(top.patient.id);
    }
    return ids;
  }

  getPatientLinks(patientId) {
    return Array.from(this.scanLinks.values()).filter((l) => l.patient_id === patientId);
  }

  getPatientSessions(patientId) {
    const cached = this.sessionsByPatient.get(patientId);
    if (cached) return cached;

    const links = this.getPatientLinks(patientId);
    const files = links
      .map((link) => mergeLinkWithFile(link, this.folderFileMap))
      .filter(Boolean);
    return groupFilesIntoSessions(files);
  }

  getActiveScanSession() {
    const sessions = this.selectedPatient ? this.getPatientSessions(this.selectedPatient.id) : [];
    if (!sessions.length) return null;
    return sessions.find((s) => s.id === this.selectedSessionId) || sessions[0];
  }

  openPatient(patient, sessionId = null) {
    this.selectedPatient = patient;
    const sessions = this.getPatientSessions(patient.id);
    this.selectedSessionId = sessionId || sessions[0]?.id || null;
    const scanSession = this.getActiveScanSession();
    this.onPatientSelect?.(patient, scanSession);
    this.render();
  }

  /** Eski API uyumluluğu */
  get patients_legacy() {
    return this.patients;
  }

  setWatchFolder(folder) {
    this.watchFolder = folder;
  }

  async _loadPatients() {
    this.patients = await listPatients();
  }

  async _loadScanLinks() {
    const links = await listScanLinks();
    this.scanLinks = new Map(links.map((l) => [l.file_path, l]));
  }

  async _loadStemAliases() {
    const rows = await listStemAliases();
    this.stemAliases = buildStemAliasMap(rows);
  }

  async _loadStemRejections() {
    const rows = await listStemRejections();
    this.stemRejections = buildStemRejectionSet(rows);
  }

  async _loadFolderFiles() {
    if (!this.watchFolder) {
      this.folderFiles = [];
      this.folderFileMap = new Map();
      return;
    }
    const files = await invoke("list_folder_scans", { folder: this.watchFolder });
    this.folderFiles = files.map((f) => {
      const fileStem = extractFileStem(f.filename);
      return {
        ...f,
        fileStem,
        scanType: classifyScanType(f.filename),
        suggestedName: parseSuggestedName(fileStem),
      };
    });
    this.folderFileMap = new Map(this.folderFiles.map((f) => [f.path, f]));
  }

  async refresh() {
    try {
      await Promise.all([
        this._loadPatients(),
        this._loadScanLinks(),
        this._loadStemAliases(),
        this._loadStemRejections(),
        this._loadFolderFiles(),
      ]);
      await this._loadCasesCache();

      if (this.selectedPatient) {
        this.selectedPatient = this.patients.find((p) => p.id === this.selectedPatient.id) || null;
        if (!this.selectedPatient) this.selectedSessionId = null;
      }
      this.render();
    } catch (err) {
      this.pendingGroupsEl.innerHTML = `<div class="p-4 text-center text-xs text-red-400">${err}</div>`;
    }
  }

  _renderPatientList() {
    const q = this.searchQuery;
    let filtered = this.patients.filter((p) => {
      if (!q) return true;
      const label = patientListLabel(p).toLowerCase();
      const display = patientDisplayName(p).toLowerCase();
      return label.includes(q) || display.includes(q) || (p.notes || "").toLowerCase().includes(q);
    });

    if (this.patientSort === "activity") {
      filtered = [...filtered].sort((a, b) =>
        comparePatientsByActivity(a, b, this.sessionsByPatient)
      );
    } else {
      filtered = [...filtered].sort(comparePatientsBySurname);
    }

    const actionCount = filtered.filter((p) => {
      const sessions = this.sessionsByPatient.get(p.id) || [];
      return summarizePatientCases(sessions).needsAction;
    }).length;

    this.patientMetaEl.textContent =
      filtered.length === this.patients.length
        ? `${filtered.length} hasta${actionCount ? ` · ${actionCount} işlem bekliyor` : ""}`
        : `${filtered.length} / ${this.patients.length} hasta`;

    if (filtered.length === 0) {
      this.patientListEl.innerHTML = `<div class="p-4 text-center text-xs mp-text-faint">Kayıtlı hasta yok — + Yeni ile ekleyin</div>`;
      return;
    }

    const activeId = this.selectedPatient?.id;
    const sessionKey = this.getSessionPatientKey?.();
    const suggestedIds = this._suggestedPatientIds();

    this.patientListEl.innerHTML = `
      <table class="patient-table w-full">
        <thead>
          <tr>
            <th>Soyad</th>
            <th>Ad</th>
            <th>Durum</th>
            <th class="patient-th-case">Vaka</th>
          </tr>
        </thead>
        <tbody>
          ${filtered
            .map((p) => {
              const selected = activeId === p.id || sessionKey === p.id;
              const sessions = this.sessionsByPatient.get(p.id) || [];
              const summary = summarizePatientCases(sessions);
              const statusHtml = summary.displayStatus
                ? `<span class="case-status-pill patient-row-status ${summary.displayStatus.cls}">${summary.displayStatus.label}</span>`
                : `<span class="patient-row-status-empty">—</span>`;
              const caseHtml = summary.caseNumber
                ? `<span class="patient-row-case font-mono">${summary.caseNumber}</span>`
                : `<span class="patient-row-status-empty">—</span>`;
              const actionDot = summary.needsAction
                ? `<span class="patient-action-dot" title="${summary.actionHint || ""}"></span>`
                : "";
              return `
              <tr data-patient-id="${p.id}" class="patient-row ${selected ? "patient-row-selected" : ""} ${summary.needsAction ? "patient-row-needs-action" : ""}">
                <td class="patient-cell-name truncate">
                  ${actionDot}${p.surname || "—"}${suggestedIds.has(p.id) ? '<span class="patient-suggest-badge">öneri</span>' : ""}
                </td>
                <td class="truncate">${p.first_name || "—"}</td>
                <td class="patient-cell-status">${statusHtml}</td>
                <td class="patient-cell-case">${caseHtml}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`;
  }

  _renderPendingGroups() {
    if (!this.watchFolder) {
      this.pendingGroupsEl.innerHTML = `<div class="p-3 text-center text-xs mp-text-faint">Ayarlardan izleme klasörü seçin</div>`;
      this.pendingMetaEl.textContent = "";
      return;
    }

    let groups = this._getLinkableGroups();
    const pendingTotal = groups.filter((g) => g.pendingCount > 0).length;

    if (this.groupFilter === "pending") {
      groups = groups.filter((g) => g.pendingCount > 0);
    }

    this.pendingMetaEl.textContent =
      this.groupFilter === "pending"
        ? `${pendingTotal} bekleyen set`
        : `${groups.length} set · ${pendingTotal} bekleyen`;

    if (groups.length === 0) {
      this.pendingGroupsEl.innerHTML = `<div class="p-3 text-center text-xs mp-text-faint">${
        this.groupFilter === "pending" ? "Tüm ölçüler bağlı ✓" : "Klasörde ölçü yok"
      }</div>`;
      return;
    }

    const selectedId = this.selectedPatient?.id;
    const selectedLabel = this.selectedPatient ? patientListLabel(this.selectedPatient) : null;

    this.pendingGroupsEl.innerHTML = groups
      .map((group) => {
        const count = getPatientScanCount(group.session);
        const status = setStatusLabel(count);
        const isToday = dayKey(group.modifiedAt) === dayKey(Date.now() / 1000);
        const dateLabel = isToday ? "Bugün" : formatShortDate(group.modifiedAt);
        const expanded = this.expandedGroupIds.has(group.id);
        const canLink = group.pendingCount > 0 && !!this.selectedPatient;
        const pendingLabel =
          group.pendingCount === group.files.length
            ? `${group.pendingCount} dosya bekliyor`
            : `${group.pendingCount} dosya eşleşmemiş`;

        const suggestion =
          group.pendingCount > 0
            ? topPatientSuggestion(
                group,
                this.patients,
                this.scanLinks,
                this.stemAliases,
                this.stemRejections
              )
            : null;
        const suggestionHtml = suggestion
          ? `<div class="measure-group-suggestion">
              <div class="measure-group-suggestion-text">
                <span class="measure-group-suggestion-label">Bu hasta olabilir</span>
                <strong>${suggestion.label}</strong>
                <span class="measure-group-suggestion-score">${suggestion.score}%</span>
                ${
                  suggestion.reasons.length
                    ? `<span class="measure-group-suggestion-reason">${suggestion.reasons.slice(0, 2).join(" · ")}</span>`
                    : ""
                }
              </div>
              <div class="measure-group-suggestion-actions">
                <button type="button" data-action="link-suggested"
                  data-group-id="${group.id}" data-patient-id="${suggestion.patient.id}"
                  class="mp-btn-primary text-[10px] px-2 py-1 rounded shrink-0">
                  → Bağla
                </button>
                <button type="button" data-action="reject-suggested"
                  data-group-id="${group.id}" data-patient-id="${suggestion.patient.id}"
                  class="mp-btn-ghost text-[10px] px-2 py-1 rounded shrink-0 measure-suggest-reject"
                  title="Bu hasta değil — bir daha önerme">
                  Bu değil
                </button>
              </div>
            </div>`
          : "";

        const fileRows = group.files
          .map((f) => {
            const link = this.scanLinks.get(f.path);
            const linkedPatient = link ? this.patients.find((p) => p.id === link.patient_id) : null;
            const isLinked = !!link;
            const wrongPatient = isLinked && selectedId && link.patient_id !== selectedId;
            const samePatient = isLinked && selectedId && link.patient_id === selectedId;
            return `
            <div class="measure-file-row">
              <span class="text-xs px-1 py-0.5 rounded font-medium shrink-0 ${typeBadgeClass(f.scanType)}">
                ${SCAN_LABELS[f.scanType] || "?"}
              </span>
              <span class="text-[10px] mp-text-muted truncate flex-1" title="${f.filename}">${f.filename}</span>
              ${
                isLinked
                  ? `<span class="text-[10px] text-medical-green shrink-0">${patientListLabel(linkedPatient || { surname: "?", first_name: "" })}</span>
                     ${
                       samePatient
                         ? `<button type="button" data-action="detach-file" data-path="${f.path}"
                              class="mp-btn-ghost text-[10px] px-1.5 py-0.5 rounded shrink-0 text-red-400" title="Vakadan kaldır">Kaldır</button>`
                         : wrongPatient
                           ? `<button type="button" data-action="reassign-file" data-path="${f.path}"
                                class="mp-btn-ghost text-[10px] px-1.5 py-0.5 rounded shrink-0 text-orange-400" title="Eşleştirmeyi düzelt">Düzelt</button>`
                           : ""
                     }`
                  : `<button type="button" data-action="link-file" data-path="${f.path}"
                       class="mp-btn-ghost text-[10px] px-1.5 py-0.5 rounded shrink-0 ${selectedId ? "" : "opacity-40"}"
                       ${selectedId ? "" : "disabled"} title="Seçili hastaya bağla">Bağla</button>`
              }
            </div>`;
          })
          .join("");

        return `
        <div class="measure-group-card ${group.pendingCount > 0 ? "measure-group-pending" : ""}">
          <div class="measure-group-header">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium mp-text-title truncate">${group.suggestedName}</div>
              <div class="text-[10px] mp-text-faint truncate">${group.fileStem} · ${dateLabel}</div>
            </div>
            <div class="text-right shrink-0">
              <div class="flex gap-1 justify-end mb-0.5">${scanDots(group.session)}</div>
              <div class="text-[10px] ${status.cls}">${status.text}</div>
            </div>
          </div>
          ${
            group.pendingCount > 0
              ? `${suggestionHtml}<div class="text-[10px] mp-text-muted mt-1">${pendingLabel}</div>
          <div class="flex flex-wrap gap-1.5 mt-2">
            <button type="button" data-action="create-link" data-group-id="${group.id}"
              class="mp-btn-primary text-[10px] px-2 py-1 rounded">+ Hasta oluştur</button>
            <button type="button" data-action="link-selected" data-group-id="${group.id}"
              class="mp-btn-secondary text-[10px] px-2 py-1 rounded disabled:opacity-40"
              ${canLink ? "" : "disabled"}
              title="${selectedLabel ? `${selectedLabel} hastasına bağla` : "Önce hasta seçin"}">
              ${selectedLabel ? `→ ${selectedLabel.split(",")[0]}` : "Hastaya bağla"}
            </button>
          </div>`
              : `<div class="text-[10px] text-medical-green mt-1">Bağlı</div>`
          }
          <button type="button" data-action="toggle-expand" data-group-id="${group.id}"
            class="measure-group-expand text-[10px] mp-text-faint mt-2">
            ${expanded ? "▾" : "▸"} ${group.files.length} dosya
          </button>
          ${expanded ? `<div class="measure-group-files mt-1">${fileRows}</div>` : ""}
        </div>`;
      })
      .join("");
  }

  _renderPatientDetail() {
    if (!this.detailContentEl) return;

    const patient = this.selectedPatient;
    if (!patient) {
      this.detailEmptyEl?.classList.remove("hidden");
      this.detailContentEl.classList.add("hidden");
      this._renderCasePreview();
      return;
    }

    this.detailEmptyEl?.classList.add("hidden");
    this.detailContentEl.classList.remove("hidden");

    const activeSession = this.getActiveScanSession();
    const sessions = this.getPatientSessions(patient.id);
    const summary = summarizePatientCases(sessions);
    const count = getPatientScanCount(activeSession || { scans: {} });
    const status = setStatusLabel(count);
    const links = this.getPatientLinks(patient.id);
    const showHint = links.some((l) => needsNamingHint(l.file_stem));

    const summaryStrip =
      sessions.length > 0
        ? `<div class="patient-summary-strip">
            ${
              summary.displayStatus
                ? `<span class="case-status-pill ${summary.displayStatus.cls}">${summary.displayStatus.label}</span>`
                : ""
            }
            ${summary.caseNumber ? `<span class="patient-summary-case font-mono">${summary.caseNumber}</span>` : ""}
            ${
              summary.actionHint
                ? `<span class="patient-summary-hint">${summary.actionHint}</span>`
                : ""
            }
            ${
              summary.sentCount > 0
                ? `<span class="patient-summary-meta">${summary.sentCount} gönderildi · ${summary.openCount} açık</span>`
                : `<span class="patient-summary-meta">${sessions.length} vaka</span>`
            }
          </div>`
        : "";

    const infoForm = `
      ${summaryStrip}
      ${showHint ? `
      <div class="filename-hint mb-4 px-3 py-2 rounded-lg border text-[10px] leading-relaxed mp-text-muted">
        💡 Dosya adında <strong class="mp-text-secondary">soyad-ad arasına tire (-)</strong> koyarsanız öneri daha doğru olur.
        Örn: <code class="text-medical-accent">Yilmaz-Ahmet</code>UpperJawScan.ply
      </div>` : ""}
      <div class="patient-form-editable space-y-3 mb-4">
        <div class="mp-field">
          <label class="mp-field-label" for="edit-surname">Soyad</label>
          <input id="edit-surname" class="mp-field-input" value="${patient.surname || ""}" />
          <div class="mp-field-line"></div>
        </div>
        <div class="mp-field">
          <label class="mp-field-label" for="edit-first-name">Ad</label>
          <input id="edit-first-name" class="mp-field-input" value="${patient.first_name || ""}" />
          <div class="mp-field-line"></div>
        </div>
        <div class="mp-field">
          <label class="mp-field-label" for="edit-notes">Not</label>
          <input id="edit-notes" class="mp-field-input" value="${patient.notes || ""}" />
          <div class="mp-field-line"></div>
        </div>
        <div class="flex gap-2">
          <button id="btn-save-patient" type="button" class="mp-btn-primary text-xs px-3 py-1.5 rounded-lg flex-1">Kaydet</button>
          <button id="btn-delete-patient" type="button" class="mp-btn-secondary text-xs px-3 py-1.5 rounded-lg text-red-400">Sil</button>
        </div>
      </div>
      <div class="patient-form-stack">
        ${sidexisField("Bağlı ölçü", `${links.length} dosya`)}
        ${sidexisField(
          "Aktif set",
          `<span class="inline-flex items-center gap-2"><span class="flex gap-1">${scanDots(activeSession || { scans: {} })}</span><span class="${status.cls}">${status.text}</span></span>`,
          { html: true }
        )}
        ${sidexisField("Son ölçü", formatDate(activeSession?.modifiedAt || patient.updated_at))}
      </div>`;

    const historyHtml =
      sessions.length > 0
        ? `
        <div class="px-4 pb-3">
          <h3 class="text-xs font-semibold mp-text-muted uppercase tracking-wide mb-2">
            Geçmiş ölçüler <span class="normal-case font-normal">(${sessions.length})</span>
          </h3>
          <div class="scan-history-list">
            ${sessions
              .map((s, index) => {
                const sCount = getPatientScanCount(s);
                const sStatus = setStatusLabel(sCount);
                const isActive = s.id === (activeSession?.id || this.selectedSessionId);
                const isToday = dayKey(s.modifiedAt) === dayKey(Date.now() / 1000);
                const caseLabel = s.caseNumber ? `<span class="scan-history-case">${s.caseNumber}</span>` : "";
                const caseStatus = s.case ? displayCaseStatus(s.case) : s.status ? displayCaseStatus({ status: s.status }) : null;
                const statusPill = caseStatus
                  ? `<span class="case-status-pill ${caseStatus.cls}">${caseStatus.label}</span>`
                  : "";
                const planBadge =
                  s.case && hasPlanningContent(s.case) && s.status !== "sent"
                    ? `<span class="case-planned-badge">✓ plan</span>`
                    : "";
                const planLabel = s.case ? planningActionLabel(s.case) : "Planla";
                const sentInfo =
                  s.sentAt && s.status === "sent"
                    ? `<span class="text-[10px] text-medical-green">Gönderildi ${formatShortDate(s.sentAt)}</span>`
                    : "";
                return `
                <button type="button" data-session-id="${s.id}"
                  class="scan-history-item ${isActive ? "scan-history-item-active" : ""}">
                  <div class="scan-history-item-main">
                    <span class="scan-history-date">${isToday ? "Bugün" : formatShortDate(s.modifiedAt)}</span>
                    ${caseLabel}
                    <span class="text-[10px] mp-text-faint">${formatDate(s.modifiedAt)}</span>
                  </div>
                  <div class="scan-history-item-meta">
                    <span class="flex gap-1">${scanDots(s)}</span>
                    <span class="text-[10px] ${sStatus.cls}">${sStatus.text}</span>
                    ${statusPill}
                    ${planBadge}
                    ${sentInfo}
                    ${
                      s.caseId
                        ? `<button type="button" data-action="open-planning" data-session-id="${s.id}"
                            class="text-[10px] text-medical-accent hover:underline shrink-0">${planLabel}</button>`
                        : ""
                    }
                    ${index === 0 ? '<span class="scan-history-badge">Son</span>' : ""}
                  </div>
                </button>`;
              })
              .join("")}
          </div>
        </div>`
        : `<div class="px-4 pb-3 text-xs mp-text-faint">Henüz bağlı ölçü yok — üstteki gruptan seti bağlayın.</div>`;

    this.detailContentEl.innerHTML = `
      <div class="patient-detail-header shrink-0 px-4 py-3 mp-border-b">
        <h2 class="text-base font-semibold mp-text-title">${patientListLabel(patient)}</h2>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="px-4 py-4">${infoForm}</div>
        ${historyHtml}
      </div>`;
  }

  _renderCasePreview() {
    const metaEl = this.casePreviewMetaEl;
    const filesEl = this.casePreviewFilesEl;
    if (!metaEl || !filesEl) return;

    const patient = this.selectedPatient;
    const activeSession = patient ? this.getActiveScanSession() : null;

    if (!patient || !activeSession) {
      metaEl.innerHTML = `<span class="text-[10px] mp-text-faint">Hasta ve vaka seçin</span>`;
      filesEl.innerHTML = "";
      return;
    }

    const caseMeta = activeSession.case ? displayCaseStatus(activeSession.case) : null;
    const planBtnLabel = activeSession.case ? planningActionLabel(activeSession.case) : "Planla";

    if (activeSession.caseNumber && caseMeta) {
      metaEl.innerHTML = `
        <div class="case-status-bar">
          <span class="case-status-number">${activeSession.caseNumber}</span>
          <span class="case-status-pill ${caseMeta.cls}">${caseMeta.label}</span>
          ${
            activeSession.case && hasPlanningContent(activeSession.case) && activeSession.status !== "sent"
              ? `<span class="case-planned-badge">✓ plan</span>`
              : ""
          }
          ${
            activeSession.caseId
              ? `<button type="button" data-action="open-planning" data-session-id="${activeSession.id}"
                  class="mp-btn-primary text-[10px] px-2 py-0.5 rounded ml-auto shrink-0">${planBtnLabel} →</button>`
              : ""
          }
        </div>
        ${renderCaseStatusSteps(activeSession.status)}
        ${
          activeSession.status === "sent" && activeSession.sentAt
            ? `<p class="text-[10px] text-medical-green mt-1">Gönderildi: ${formatDate(activeSession.sentAt)}</p>`
            : ""
        }`;
    } else if (activeSession.caseId) {
      metaEl.innerHTML = `
        <button type="button" data-action="open-planning" data-session-id="${activeSession.id}"
          class="mp-btn-primary text-[10px] px-2 py-0.5 rounded">${planBtnLabel} →</button>`;
    } else {
      metaEl.innerHTML = `<span class="text-[10px] mp-text-faint">${patientListLabel(patient)}</span>`;
    }

    const files = activeSession.files || [];
    if (files.length === 0) {
      filesEl.innerHTML = `<p class="text-[10px] mp-text-faint py-2">Bu vakada bağlı dosya yok</p>`;
      return;
    }

    filesEl.innerHTML = `
      <h3 class="text-[10px] font-semibold mp-text-muted uppercase tracking-wide mb-1.5 sticky top-0 py-0.5 case-preview-files-title">Vaka dosyaları</h3>
      <div class="space-y-1">
        ${files
          .map((f) => {
            const type = f.scanType;
            const label = SCAN_LABELS[type] || "?";
            return `
            <div class="measure-file-row">
              <span class="text-xs px-1 py-0.5 rounded font-medium shrink-0 ${typeBadgeClass(type)}">${label}</span>
              <span class="text-[10px] mp-text-muted truncate flex-1" title="${f.filename}">${f.filename}</span>
              <button type="button" data-action="detach-file" data-path="${f.path}"
                class="mp-btn-ghost text-[10px] px-1.5 py-0.5 rounded shrink-0 text-red-400">Kaldır</button>
            </div>`;
          })
          .join("")}
      </div>`;
  }

  render() {
    this._renderPendingGroups();
    this._renderPatientList();
    this._renderPatientDetail();
    this._renderCasePreview();
  }
}
