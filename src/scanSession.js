import { classifyScanType, parsePatientName, patientKeyFromFilename } from "./utils.js";
import { getSessionTimeoutMs } from "./settings.js";

/**
 * Aktif tarama oturumunu yönetir.
 * Üst çene + alt çene + kapanış taramalarını dosya önekine göre gruplar.
 */
export class ScanSession {
  constructor() {
    this.patientKey = null;
    this.patientName = "";
    this.scanSessionId = null;
    this.scans = { upper: null, lower: null, bite: null };
    this.lastActivity = Date.now();
    this.aligned = false;
    this.transforms = null;
  }

  reset() {
    this.patientKey = null;
    this.patientName = "";
    this.scanSessionId = null;
    this.scans = { upper: null, lower: null, bite: null };
    this.aligned = false;
    this.transforms = null;
    this.lastActivity = Date.now();
  }

  isExpired() {
    return Date.now() - this.lastActivity > getSessionTimeoutMs();
  }

  /**
   * @returns {'added' | 'replaced' | 'new_session'}
   */
  addScan({ path, filename, sizeBytes }) {
    if (this.isExpired() && this.patientKey) {
      this.reset();
    }

    const key = patientKeyFromFilename(filename);
    const scanType = classifyScanType(filename);

    if (this.patientKey && this.patientKey !== key) {
      this.reset();
    }

    this.patientKey = key;
    this.patientName = parsePatientName(filename);
    this.lastActivity = Date.now();

    const scan = { path, filename, sizeBytes, type: scanType };

    if (scanType === "unknown") {
      const emptySlot = ["upper", "lower", "bite"].find((s) => !this.scans[s]);
      if (emptySlot) {
        const replaced = !!this.scans[emptySlot];
        this.scans[emptySlot] = { ...scan, type: emptySlot };
        this.aligned = false;
        return replaced ? "replaced" : "added";
      }
      return "added";
    }

    const replaced = !!this.scans[scanType];
    this.scans[scanType] = scan;
    this.aligned = false;
    return replaced ? "replaced" : "added";
  }

  isComplete() {
    return !!(this.scans.upper && this.scans.lower && this.scans.bite);
  }

  getCompletedCount() {
    return ["upper", "lower", "bite"].filter((k) => this.scans[k]).length;
  }

  getAllScans() {
    return Object.values(this.scans).filter(Boolean);
  }

  getTotalSize() {
    return this.getAllScans().reduce((sum, s) => sum + s.sizeBytes, 0);
  }

  getStatusText() {
    const count = this.getCompletedCount();
    if (count === 0) return "Tarama bekleniyor";
    if (count < 3) return `${count}/3 tarama alındı`;
    if (this.aligned) return "✅ Tarayıcı hizası hazır";
    return "3/3 tarama — hazır";
  }
}
