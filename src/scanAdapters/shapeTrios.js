import { parseScanFilename } from "../scanFilename.js";
import { parseSuggestedName } from "../utils.js";
import { dedupeByBasenamePreferPly, meshFiles } from "./shared.js";

/** @type {import('./types.js').ScanAdapter} */
export const shapeTriosAdapter = {
  id: "3shape-trios",
  vendor: "3Shape",
  label: "3Shape TRIOS / CORE (dosya adı)",

  detect(files) {
    const meshes = meshFiles(files);
    if (!meshes.length) return { confidence: 0 };
    const hits = meshes.filter((f) =>
      /(Upper|Lower|Lowe)JawScan|BiteScan|AbutmentScan/i.test(f.filename)
    ).length;
    if (!hits) return { confidence: 0 };
    const ratio = hits / meshes.length;
    return {
      confidence: Math.min(0.95, 0.55 + ratio * 0.4),
      reason: `${hits}/${meshes.length} 3Shape dosya adı`,
    };
  },

  async parse({ files, packageDir, detection }) {
    const meshes = dedupeByBasenamePreferPly(meshFiles(files));
    /** @type {Map<string, import('./types.js').ScanPackage>} */
    const byStem = new Map();

    for (const f of meshes) {
      const parsed = parseScanFilename(f.filename);
      let role = /** @type {import('./types.js').ScanAssetRole} */ ("unknown");
      let preferred = true;

      if (/AbutmentScan/i.test(f.filename)) {
        role = "abutment";
      } else if (parsed.scanType === "upper" || parsed.scanType === "lower" || parsed.scanType === "bite") {
        role = parsed.scanType;
      }

      let stem = parsed.stem || "";
      if (role === "abutment") {
        stem = f.filename
          .replace(/\.(stl|ply|obj)$/i, "")
          .replace(/\s*_?UpperAbutmentScan\d*$/i, "")
          .trim();
      }
      const key = stem || `_shape_${f.filename}`;

      if (!byStem.has(key)) {
        byStem.set(key, {
          id: `3shape:${packageDir || "root"}:${key}`,
          source: {
            adapterId: "3shape-trios",
            vendor: "3Shape",
            confidence: detection.confidence,
            detectReason: detection.reason,
          },
          patient: {
            displayName: parseSuggestedName(stem) || stem,
            stem,
          },
          caseRef: stem,
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
        preferred,
        format: f.filename.match(/\.(\w+)$/i)?.[1]?.toLowerCase(),
      });

      if (role === "abutment") {
        pkg.warnings.push(`Abutment taraması ayrı rol: ${f.filename}`);
      }
      if (role === "unknown") {
        pkg.warnings.push(`3Shape: tanınmayan dosya: ${f.filename}`);
      }
    }

    return [...byStem.values()];
  },
};
