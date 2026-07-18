import { detectScanAdapter, getScanAdapter } from "./registry.js";
import { basename, groupFilesByParentDir, meshFiles } from "./shared.js";
import { roleToLegacyScanType } from "./types.js";

const MANIFEST_FILENAMES = new Set(["teeth_detail.json"]);
const MANIFEST_PATTERNS = [/^itero_export_#.*\.xml$/i];

/**
 * Alt klasördeki mesh'leri üst manifest ile birleştir (ör. model/ + teeth_detail.json).
 * @param {Map<string, import('./types.js').ScanFileInput[]>} byDir
 */
export function clusterPackageDirs(byDir) {
  /** @type {Map<string, import('./types.js').ScanFileInput[]>} */
  const clusters = new Map();
  const consumed = new Set();

  for (const [dir, files] of byDir) {
    if (consumed.has(dir)) continue;

    const parentDir = dir.replace(/[/\\][^/\\]+$/, "");
    const parentFiles = byDir.get(parentDir) || [];
    const dirBase = basename(dir).toLowerCase();

    const parentHasManifest =
      parentFiles.some((f) => MANIFEST_FILENAMES.has(f.filename.toLowerCase())) ||
      parentFiles.some((f) => MANIFEST_PATTERNS.some((p) => p.test(f.filename)));

    if (dirBase === "model" && parentHasManifest && parentDir !== dir) {
      const merged = [...parentFiles, ...files];
      clusters.set(parentDir, merged);
      consumed.add(dir);
      consumed.add(parentDir);
      continue;
    }

    if (!clusters.has(dir)) {
      clusters.set(dir, [...files]);
    }
  }

  // Birleştirilmemiş üst dizinler
  for (const [dir, files] of byDir) {
    if (consumed.has(dir)) continue;
    if (clusters.has(dir)) {
      const existing = clusters.get(dir);
      for (const f of files) {
        if (!existing.some((e) => e.path === f.path)) existing.push(f);
      }
    } else {
      clusters.set(dir, [...files]);
    }
  }

  return clusters;
}

/**
 * Klasör dosya listesini adapter pipeline'ından geçirir.
 * @param {import('./types.js').ScanFileInput[]} files
 * @param {{ readText?: (path: string) => Promise<string|null>, minConfidence?: number }} [options]
 * @returns {Promise<import('./types.js').ScanPackage[]>}
 */
export async function ingestScanFiles(files, options = {}) {
  const { readText, minConfidence = 0 } = options;
  const byDir = groupFilesByParentDir(files);
  const clusters = clusterPackageDirs(byDir);

  /** @type {import('./types.js').ScanPackage[]} */
  const packages = [];

  for (const [packageDir, dirFiles] of clusters) {
    if (!meshFiles(dirFiles).length && !dirFiles.some((f) => MANIFEST_FILENAMES.has(f.filename.toLowerCase()))) {
      continue;
    }

    const detection = detectScanAdapter(dirFiles, packageDir);
    if (detection.confidence < minConfidence) continue;

    const adapter = getScanAdapter(detection.adapterId);
    const parsed = await adapter.parse({
      files: dirFiles,
      packageDir,
      readText,
      detection,
    });
    packages.push(...parsed);
  }

  return packages.sort((a, b) => (a.caseRef || "").localeCompare(b.caseRef || ""));
}

/**
 * ScanPackage listesini mevcut fileBrowser alanlarına map'ler.
 * @param {import('./types.js').ScanPackage[]} packages
 */
export function packagesToFileOverrides(packages) {
  /** @type {Map<string, object>} */
  const byPath = new Map();

  for (const pkg of packages) {
    for (const asset of pkg.assets) {
      if (!asset.path) continue;
      const legacyType = roleToLegacyScanType(asset.role);
      byPath.set(asset.path, {
        scanType: legacyType,
        scanRole: asset.role,
        fileStem: pkg.patient?.stem || (pkg.caseRef ? `itero-${pkg.caseRef}` : "") || "",
        suggestedName: pkg.patient?.displayName || "",
        adapterId: pkg.source.adapterId,
        adapterConfidence: pkg.source.confidence,
        scanPreferred: asset.preferred !== false,
        packageId: pkg.id,
        caseRef: pkg.caseRef || "",
      });
    }
  }

  return byPath;
}

/**
 * Tauri / tarayıcı ortamında metin dosyası okuma yardımcısı.
 * @param {import('@tauri-apps/api/core').invoke} invokeFn
 */
export function createTauriReadText(invokeFn) {
  return async (path) => {
    try {
      const bytes = await invokeFn("read_file_bytes", { path });
      return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
    } catch {
      return null;
    }
  };
}
