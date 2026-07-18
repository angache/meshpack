import { extractFileStem, parseScanFilename } from "../scanFilename.js";
import { parseSuggestedName } from "../utils.js";
import { dedupeByBasenamePreferPly, meshFiles } from "./shared.js";

/** @type {import('./types.js').ScanAdapter} */
export const genericFilenameAdapter = {
  id: "generic-filename",
  vendor: "generic",
  label: "Genel dosya adı kuralları",

  detect(files) {
    const meshes = meshFiles(files);
    if (!meshes.length) return { confidence: 0 };
    return { confidence: 0.15, reason: "fallback" };
  },

  async parse({ files, packageDir, detection }) {
    const meshes = dedupeByBasenamePreferPly(meshFiles(files));
    /** @type {Map<string, import('./types.js').ScanPackage>} */
    const byStem = new Map();

    for (const f of meshes) {
      const { scanType, stem } = parseScanFilename(f.filename);
      const role =
        scanType === "upper" || scanType === "lower" || scanType === "bite" ? scanType : "unknown";
      const key = stem || `_unknown_${f.filename}`;
      if (!byStem.has(key)) {
        byStem.set(key, {
          id: `generic:${packageDir || "root"}:${key}`,
          source: {
            adapterId: "generic-filename",
            vendor: "generic",
            confidence: detection.confidence,
            detectReason: detection.reason,
          },
          patient: {
            displayName: parseSuggestedName(stem) || stem || "Bilinmeyen",
            stem: stem || "",
          },
          caseRef: stem || f.filename,
          packageDir,
          assets: [],
          warnings: [],
        });
      }
      const pkg = byStem.get(key);
      pkg.assets.push({
        path: f.path,
        filename: f.filename,
        role,
        preferred: role !== "unknown",
        format: f.filename.match(/\.(\w+)$/i)?.[1]?.toLowerCase(),
      });
      if (role === "unknown") {
        pkg.warnings.push(`Tanınmayan dosya tipi: ${f.filename}`);
      }
    }

    return [...byStem.values()];
  },
};

export function stemFromFilename(filename) {
  return extractFileStem(filename);
}
