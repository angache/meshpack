/**
 * Ortak yardımcılar — ölçü dosyası ayrıştırma: ./scanFilename.js
 */
import {
  classifyScanType,
  extractFileStem,
  extractCaseOrderRef,
  isScanFile,
  parseScanFilename,
  SCAN_LABELS,
} from "./scanFilename.js";

export { classifyScanType, extractFileStem, isScanFile, parseScanFilename, SCAN_LABELS, extractCaseOrderRef };

function capitalizePart(part) {
  if (!part) return "";
  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
}

function formatPatientName(stem) {
  let name = stem.replace(/_+$/, "").replace(/^_+/, "").replace(/__+/g, "_").trim();
  if (!name) return "Bilinmeyen Hasta";

  if (name.includes("_")) {
    return name
      .split("_")
      .filter(Boolean)
      .map(capitalizePart)
      .join(" ");
  }

  const spaced = name.replace(/([a-zğüşıöç])([A-ZİĞÜŞÖÇ])/g, "$1 $2");
  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map(capitalizePart)
    .join(" ");
}

/** Dosya önekinden önerilen görünen ad — tire (-) varsa soyad-ad ayrımı */
export function parseSuggestedName(stem) {
  if (!stem) return "Bilinmeyen Hasta";

  const orderId = extractCaseOrderRef(stem) || stem.match(/^itero-(\d+)$/i)?.[1];
  if (orderId) return `iTero #${orderId}`;

  if (stem.includes("-")) {
    return stem
      .split("-")
      .filter(Boolean)
      .map(capitalizePart)
      .join(" ");
  }

  return formatPatientName(stem);
}

export function parsePatientName(filename) {
  return parseSuggestedName(extractFileStem(filename));
}

/** Gruplama anahtarı — dosya önekinden, görünen addan bağımsız */
export function patientKeyFromStem(stem) {
  return (stem || "bilinmeyen")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_.-]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function patientKeyFromFilename(filename) {
  return patientKeyFromStem(extractFileStem(filename));
}

/** @deprecated Görünen ad yerine patientKeyFromStem kullanın */
export function patientKey(name) {
  return patientKeyFromStem(name);
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dayKey(timestamp) {
  const d = new Date(timestamp * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Aynı hastanın dosyalarını günlük oturumlara ayırır */
export function groupFilesIntoSessions(files) {
  const byDay = new Map();

  for (const file of files) {
    const dk = dayKey(file.modified_at);
    if (!byDay.has(dk)) {
      byDay.set(dk, {
        id: dk,
        dayKey: dk,
        modifiedAt: 0,
        scans: { upper: null, lower: null, bite: null, bite2: null },
        files: [],
      });
    }

    const session = byDay.get(dk);
    session.files.push(file);
    session.modifiedAt = Math.max(session.modifiedAt, file.modified_at);

    const type = file.scanType;
    if (type === "upper" || type === "lower") {
      const existing = session.scans[type];
      if (!existing || file.modified_at > existing.modified_at) {
        session.scans[type] = file;
      }
    } else if (type === "bite") {
      const bites = session.files
        .filter((f) => f.scanType === "bite")
        .sort((a, b) => (b.modified_at || 0) - (a.modified_at || 0))
        .slice(0, 2);
      session.scans.bite = bites[0] || null;
      session.scans.bite2 = bites[1] || null;
    }
  }

  return Array.from(byDay.values()).sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export function groupFilesByPatient(files) {
  const groups = new Map();

  for (const file of files) {
    const orderRef =
      file.caseRef ||
      extractCaseOrderRef(file.filename) ||
      extractCaseOrderRef(file.fileStem) ||
      (file.packageId && String(file.packageId).match(/(\d{5,})/)?.[1]) ||
      "";
    const stem = file.fileStem || extractFileStem(file.filename);
    const key = orderRef
      ? patientKeyFromStem(`itero-${orderRef}`)
      : patientKeyFromStem(stem);
    const fileStem = orderRef ? `itero-${orderRef}` : stem;
    const suggestedName =
      file.suggestedName ||
      (orderRef ? `iTero #${orderRef}` : parseSuggestedName(stem));

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        fileStem,
        suggestedName,
        allFiles: [],
        orderRef: orderRef || null,
      });
    }

    const group = groups.get(key);
    group.allFiles.push(file);
    group.latestModified = Math.max(group.latestModified || 0, file.modified_at);
    group.fileCount = group.allFiles.length;
    if (file.suggestedName && !orderRef) group.suggestedName = file.suggestedName;
    else if (file.suggestedName && orderRef && !/^iTero #/i.test(file.suggestedName)) {
      group.suggestedName = file.suggestedName;
    }
  }

  return Array.from(groups.values())
    .map((group) => {
      const sessions = groupFilesIntoSessions(group.allFiles);
      const latest = sessions[0] || { scans: {}, modifiedAt: 0 };
      return {
        key: group.key,
        fileStem: group.fileStem,
        suggestedName: group.suggestedName,
        sessions,
        scans: latest.scans,
        latestModified: latest.modifiedAt || group.latestModified || 0,
        fileCount: group.fileCount,
        allFiles: group.allFiles,
        orderRef: group.orderRef,
      };
    })
    .sort((a, b) => b.latestModified - a.latestModified);
}

export function buildLinkableGroups(folderFiles, isLinked) {
  const stems = groupFilesByPatient(folderFiles);
  const groups = [];

  for (const stem of stems) {
    for (const session of stem.sessions) {
      const files = (session.files?.length ? session.files : Object.values(session.scans).filter(Boolean));
      if (!files.length) continue;

      const unassigned = files.filter((f) => !isLinked(f.path));
      const assigned = files.filter((f) => isLinked(f.path));

      groups.push({
        id: `${stem.key}_${session.id}`,
        stemKey: stem.key,
        fileStem: stem.fileStem,
        suggestedName: stem.suggestedName,
        session,
        files,
        unassigned,
        assigned,
        modifiedAt: session.modifiedAt,
        pendingCount: unassigned.length,
        isFullyLinked: unassigned.length === 0,
      });
    }
  }

  return groups.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export function getPatientScanCount(group) {
  return ["upper", "lower", "bite"].filter((t) => group.scans?.[t]).length;
}

/** Bağlama güvenliği — eksik set kontrolü */
export function analyzeLinkCompleteness(files) {
  const enriched = (files || []).map((f) => ({
    ...f,
    scanType: f.scanType || classifyScanType(f.filename),
  }));
  const hasUpper = enriched.some((f) => f.scanType === "upper");
  const hasLower = enriched.some((f) => f.scanType === "lower");
  const hasBite = enriched.some((f) => f.scanType === "bite");
  const missing = [];
  if (!hasUpper) missing.push("üst çene");
  if (!hasLower) missing.push("alt çene");
  if (!hasBite) missing.push("kapanış");

  return {
    hasUpper,
    hasLower,
    hasBite,
    missing,
    /** Üst+alt+kapanış — tek tıkla bağlama için zorunlu */
    isComplete: hasUpper && hasLower && hasBite,
    /** En az üst+alt */
    hasJaws: hasUpper && hasLower,
    files: enriched,
  };
}

/** Görünen ad veya dosya önekinden soyad/ad ayrımı */
export function splitPatientName(displayName, fileStem = null) {
  if (fileStem?.includes("-")) {
    const parts = fileStem.split("-").filter(Boolean);
    if (parts.length >= 2) {
      return {
        surname: capitalizePart(parts[0]),
        firstName: parts.slice(1).map(capitalizePart).join(" "),
      };
    }
  }

  const parts = (displayName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { surname: parts[0] || "—", firstName: "—" };
  }
  const firstName = parts.pop();
  return { surname: parts.join(" "), firstName };
}

export function needsNamingHint(fileStem) {
  if (!fileStem) return true;
  return !fileStem.includes("-") && !fileStem.includes("_");
}

