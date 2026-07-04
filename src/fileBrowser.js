import { invoke } from "@tauri-apps/api/core";
import {
  classifyScanType,
  formatFileSize,
  groupFilesByPatient,
  getPatientScanCount,
  parsePatientName,
  SCAN_LABELS,
} from "./utils.js";

const DATE_FILTERS = [
  { id: "all", label: "Tüm tarihler" },
  { id: "today", label: "Bugün" },
  { id: "week", label: "Bu hafta" },
  { id: "month", label: "Bu ay" },
];

const SET_FILTERS = [
  { id: "all", label: "Tümü" },
  { id: "complete", label: "Tam set (3/3)" },
  { id: "incomplete", label: "Eksik" },
];

const SCAN_TYPES = ["upper", "lower", "bite"];

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

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime() / 1000;
}

function matchesDateFilter(modifiedAt, filterId) {
  if (filterId === "all") return true;
  const now = Date.now() / 1000;
  const todayStart = startOfDay(new Date());
  if (filterId === "today") return modifiedAt >= todayStart;
  if (filterId === "week") return modifiedAt >= now - 7 * 86400;
  if (filterId === "month") return modifiedAt >= now - 30 * 86400;
  return true;
}

function typeBadgeClass(type) {
  return {
    upper: "bg-medical-accent/20 text-medical-accent",
    lower: "bg-medical-green/20 text-medical-green",
    bite: "bg-orange-400/20 text-orange-400",
  }[type];
}

function scanDots(group) {
  return SCAN_TYPES.map((type) => {
    const has = !!group.scans[type];
    const colors = {
      upper: has ? "bg-medical-accent" : "bg-anthracite-600",
      lower: has ? "bg-medical-green" : "bg-anthracite-600",
      bite: has ? "bg-orange-400" : "bg-anthracite-600",
    };
    return `<span class="w-2 h-2 rounded-full ${colors[type]}" title="${SCAN_LABELS[type]}"></span>`;
  }).join("");
}

export class FileBrowser {
  constructor(options) {
    this.container = options.container;
    this.onPatientSelect = options.onPatientSelect;
    this.onToggleScan = options.onToggleScan;
    this.getSessionPaths = options.getSessionPaths;
    this.getSessionPatientKey = options.getSessionPatientKey;
    this.isScanVisible = options.isScanVisible;
    this.getNewPatientKeys = options.getNewPatientKeys;
    this.getNewFilePaths = options.getNewFilePaths;

    this.allFiles = [];
    this.patients = [];
    this.view = "patients"; // 'patients' | 'detail'
    this.selectedPatient = null;
    this.searchQuery = "";
    this.dateFilter = "all";
    this.setFilter = "all";
    this.watchFolder = null;

    this._renderShell();
    this._bindEvents();
  }

  _renderShell() {
    this.container.innerHTML = `
      <div class="file-browser flex flex-col h-full min-h-0">
        <div class="flex items-center justify-between mb-2 shrink-0">
          <label id="browser-title" class="text-sm font-semibold mp-text-title">Hastalar</label>
          <button id="btn-refresh-files" type="button"
            class="mp-btn-ghost text-[10px] px-2 py-0.5 rounded"
            title="Listeyi yenile">↻ Yenile</button>
        </div>

        <div id="browser-back-row" class="hidden mb-2">
          <button id="btn-browser-back" type="button"
            class="text-xs text-medical-accent hover:text-white flex items-center gap-1 transition-colors">
            ← Hastalar
          </button>
        </div>

        <div id="browser-search-row" class="relative mb-2">
          <input id="file-search" type="search" placeholder="Hasta ara..."
            class="mp-input w-full pl-8 pr-3 py-2 rounded-lg text-xs" />
          <span class="absolute left-2.5 top-1/2 -translate-y-1/2 mp-text-faint text-xs">🔍</span>
        </div>

        <div id="patient-filters" class="flex flex-wrap gap-1 mb-1.5"></div>
        <div id="date-filters" class="flex flex-wrap gap-1 mb-2"></div>

        <div id="file-list-meta" class="text-[10px] mp-text-faint mb-1"></div>

        <div id="file-list" class="flex-1 min-h-0 overflow-y-auto rounded-lg">
          <div class="p-4 text-center text-xs text-gray-500">Klasör seçilmedi</div>
        </div>
      </div>
    `;

    this.titleEl = this.container.querySelector("#browser-title");
    this.backRow = this.container.querySelector("#browser-back-row");
    this.searchRow = this.container.querySelector("#browser-search-row");
    this.searchInput = this.container.querySelector("#file-search");
    this.fileListEl = this.container.querySelector("#file-list");
    this.metaEl = this.container.querySelector("#file-list-meta");
    this.patientFiltersEl = this.container.querySelector("#patient-filters");
    this.dateFiltersEl = this.container.querySelector("#date-filters");

    this._renderFilterButtons();
  }

  _renderFilterButtons() {
    if (this.view === "patients") {
      this.patientFiltersEl.classList.remove("hidden");
      this.patientFiltersEl.innerHTML = SET_FILTERS.map(
        (f) => `
        <button type="button" data-set-filter="${f.id}"
          class="filter-chip px-2 py-0.5 rounded text-[10px] font-medium transition-colors
          ${f.id === this.setFilter ? "filter-chip-active" : ""}">
          ${f.label}
        </button>`
      ).join("");
    } else {
      this.patientFiltersEl.classList.add("hidden");
      this.patientFiltersEl.innerHTML = "";
    }

    this.dateFiltersEl.innerHTML = DATE_FILTERS.map(
      (f) => `
      <button type="button" data-date-filter="${f.id}"
        class="filter-chip date-chip px-2 py-0.5 rounded text-[10px] font-medium transition-colors
        ${f.id === this.dateFilter ? "filter-chip-active" : ""}">
        ${f.label}
      </button>`
    ).join("");
  }

  _bindEvents() {
    this.searchInput.addEventListener("input", () => {
      this.searchQuery = this.searchInput.value.trim().toLowerCase();
      this.render();
    });

    this.container.querySelector("#btn-refresh-files").addEventListener("click", () => {
      this.refresh();
    });

    this.container.querySelector("#btn-browser-back").addEventListener("click", () => {
      this.view = "patients";
      this.selectedPatient = null;
      this.searchInput.placeholder = "Hasta ara...";
      this._renderFilterButtons();
      this.render();
    });

    this.patientFiltersEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-set-filter]");
      if (!btn) return;
      this.setFilter = btn.dataset.setFilter;
      this._renderFilterButtons();
      this.render();
    });

    this.dateFiltersEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-date-filter]");
      if (!btn) return;
      this.dateFilter = btn.dataset.dateFilter;
      this._renderFilterButtons();
      this.render();
    });

    this.fileListEl.addEventListener("click", (e) => {
      const patientBtn = e.target.closest("[data-patient-key]");
      if (patientBtn) {
        const patient = this.patients.find((p) => p.key === patientBtn.dataset.patientKey);
        if (patient) this.openPatient(patient);
        return;
      }

      const scanBtn = e.target.closest("[data-scan-type]");
      if (scanBtn && this.selectedPatient) {
        const type = scanBtn.dataset.scanType;
        if (this.selectedPatient.scans[type]) {
          this.onToggleScan?.(type);
          this.render();
        }
        return;
      }
    });
  }

  openPatient(patient) {
    this.view = "detail";
    this.selectedPatient = patient;
    this.searchQuery = "";
    this.searchInput.value = "";
    this.searchInput.placeholder = "Tarama ara...";
    this.onPatientSelect?.(patient);
    this._renderFilterButtons();
    this.render();
  }

  setWatchFolder(folder) {
    this.watchFolder = folder;
  }

  async refresh() {
    if (!this.watchFolder) {
      this.allFiles = [];
      this.patients = [];
      this.render();
      return;
    }

    try {
      const files = await invoke("list_folder_scans", { folder: this.watchFolder });
      this.allFiles = files.map((f) => ({
        ...f,
        scanType: classifyScanType(f.filename),
        patientName: parsePatientName(f.filename),
      }));
      this.patients = groupFilesByPatient(this.allFiles);

      if (this.selectedPatient) {
        this.selectedPatient =
          this.patients.find((p) => p.key === this.selectedPatient.key) || null;
        if (!this.selectedPatient) this.view = "patients";
      }

      this.render();
    } catch (err) {
      this.fileListEl.innerHTML = `<div class="p-4 text-center text-xs text-red-400">${err}</div>`;
      this.metaEl.textContent = "";
    }
  }

  getFilteredPatients() {
    const filtered = this.patients.filter((patient) => {
      const count = getPatientScanCount(patient);

      if (this.setFilter === "complete" && count < 3) return false;
      if (this.setFilter === "incomplete" && count >= 3) return false;
      if (!matchesDateFilter(patient.latestModified, this.dateFilter)) return false;

      if (this.searchQuery && !patient.patientName.toLowerCase().includes(this.searchQuery)) {
        return false;
      }

      return true;
    });

    const newKeys = this.getNewPatientKeys?.() || new Set();
    return filtered.sort((a, b) => {
      const aNew = newKeys.has(a.key) ? 1 : 0;
      const bNew = newKeys.has(b.key) ? 1 : 0;
      if (aNew !== bNew) return bNew - aNew;
      return b.latestModified - a.latestModified;
    });
  }

  _renderPatientList() {
    this.titleEl.textContent = "Hastalar";
    this.backRow.classList.add("hidden");
    this.searchRow.classList.remove("hidden");

    const filtered = this.getFilteredPatients();
    const sessionKey = this.getSessionPatientKey?.();
    const newKeys = this.getNewPatientKeys?.() || new Set();

    this.metaEl.textContent =
      filtered.length === this.patients.length
        ? `${filtered.length} hasta`
        : `${filtered.length} / ${this.patients.length} hasta`;

    if (filtered.length === 0) {
      this.fileListEl.innerHTML = `<div class="p-4 text-center text-xs mp-text-faint">Eşleşen hasta yok</div>`;
      return;
    }

    this.fileListEl.innerHTML = filtered
      .map((patient) => {
        const count = getPatientScanCount(patient);
        const isActive = sessionKey === patient.key;
        const isNew = newKeys.has(patient.key);
        return `
        <button type="button" data-patient-key="${patient.key}"
          class="file-row w-full text-left px-3 py-3
          ${isNew ? "patient-new" : ""}
          ${isActive && !isNew ? "file-row-active" : ""}">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium mp-text-title truncate">${patient.patientName}</span>
                ${isNew ? '<span class="new-badge shrink-0">Yeni</span>' : ""}
              </div>
              <div class="flex items-center gap-1.5 mt-1.5">
                <span class="flex gap-1">${scanDots(patient)}</span>
                <span class="text-[10px] mp-text-faint">${count}/3 tarama</span>
              </div>
            </div>
            <div class="text-right shrink-0">
              <div class="text-[10px] mp-text-faint">${formatShortDate(patient.latestModified)}</div>
              <div class="text-[10px] text-medical-accent mt-0.5">→</div>
            </div>
          </div>
        </button>`;
      })
      .join("");
  }

  _renderPatientDetail() {
    const patient = this.selectedPatient;
    if (!patient) {
      this.view = "patients";
      this._renderPatientList();
      return;
    }

    this.titleEl.textContent = patient.patientName;
    this.backRow.classList.remove("hidden");
    this.searchRow.classList.remove("hidden");

    const sessionPaths = new Set(this.getSessionPaths?.() || []);
    const newPaths = this.getNewFilePaths?.() || new Set();
    const isPatientNew = this.getNewPatientKeys?.()?.has(patient.key);
    const count = getPatientScanCount(patient);
    this.metaEl.textContent = `${count}/3 tarama mevcut`;

    const scanRows = SCAN_TYPES.map((type) => {
      const file = patient.scans[type];
      const label = SCAN_LABELS[type];
      const inSession = file && sessionPaths.has(file.path);
      const visible = inSession && this.isScanVisible?.(type);
      const isNewFile = file && newPaths.has(file.path);

      if (!file) {
        return `
        <div class="px-2.5 py-2 border-b opacity-50" style="border-color: rgb(var(--mp-border))">
          <div class="flex items-center justify-between">
            <span class="text-xs px-1.5 py-0.5 rounded font-medium ${typeBadgeClass(type)}">${label}</span>
            <span class="text-[10px] mp-text-faint">Dosya yok</span>
          </div>
        </div>`;
      }

      const showInSearch =
        !this.searchQuery ||
        file.filename.toLowerCase().includes(this.searchQuery) ||
        label.toLowerCase().includes(this.searchQuery);

      if (!showInSearch) return "";

      const visLabel = !inSession
        ? "Seçili değil"
        : visible
          ? "👁 Görünür"
          : "🚫 Gizli";

      return `
      <button type="button" data-scan-type="${type}"
        class="file-row w-full text-left px-2.5 py-2
        ${isNewFile ? "scan-row-new" : inSession ? (visible ? "file-row-active" : "opacity-60") : ""}">
        <div class="flex items-center justify-between gap-2 mb-1">
          <span class="text-xs px-1.5 py-0.5 rounded font-medium ${typeBadgeClass(type)}">${label}</span>
          <span class="flex items-center gap-1.5">
            ${isNewFile ? '<span class="new-badge">Yeni</span>' : ""}
            <span class="text-[10px] ${visible ? "text-medical-accent" : "mp-text-faint"}">${visLabel}</span>
          </span>
        </div>
        <div class="text-[10px] mp-text-muted truncate" title="${file.filename}">${file.filename}</div>
        <div class="flex justify-between mt-1 text-[10px] mp-text-faint">
          <span>${formatFileSize(file.size_bytes)}</span>
          <span>${formatDate(file.modified_at)}</span>
        </div>
      </button>`;
    }).join("");

    const header = isPatientNew
      ? `<div class="px-2.5 py-2 bg-medical-green/10 border-b border-medical-green/20 text-[10px] text-medical-green">🟢 Bu hastada yeni ölçü var</div>`
      : "";

    this.fileListEl.innerHTML = header + (scanRows || `<div class="p-4 text-center text-xs mp-text-faint">Eşleşen tarama yok</div>`);
  }

  render() {
    if (!this.watchFolder) {
      this.fileListEl.innerHTML = `<div class="p-4 text-center text-xs mp-text-faint">Ayarlardan izleme klasörü seçin</div>`;
      this.metaEl.textContent = "";
      return;
    }

    if (this.view === "detail") {
      this._renderPatientDetail();
    } else {
      this._renderPatientList();
    }
  }
}
