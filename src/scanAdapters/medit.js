import { parseScanFilename } from "../scanFilename.js";
import { dedupeByBasenamePreferPly, meshFiles } from "./shared.js";

/** @type {import('./types.js').ScanAdapter} */
export const meditAdapter = {
  id: "medit-export",
  vendor: "Medit",
  label: "Medit Link / export (Maxilla / Mandible)",

  detect(files) {
    const meshes = meshFiles(files);
    const hits = meshes.filter((f) =>
      /maxilla|mandible|occlusion/i.test(f.filename)
    ).length;
    if (!hits) return { confidence: 0 };
    return {
      confidence: Math.min(0.92, 0.5 + (hits / Math.max(meshes.length, 1)) * 0.42),
      reason: `${hits} Medit anatomik ad`,
    };
  },

  async parse({ files, packageDir, detection }) {
    const meshes = dedupeByBasenamePreferPly(meshFiles(files));
    const folderStem = (packageDir || "").split(/[/\\]/).pop() || "medit";

    /** @type {import('./types.js').ScanAsset[]} */
    const assets = [];

    for (const f of meshes) {
      const name = f.filename;
      let role = /** @type {import('./types.js').ScanAssetRole} */ ("unknown");
      if (/maxilla/i.test(name)) role = "upper";
      else if (/mandible/i.test(name)) role = "lower";
      else if (/occlusion/i.test(name)) role = "occlusion";
      else {
        const parsed = parseScanFilename(name);
        if (parsed.scanType !== "unknown") role = parsed.scanType;
      }

      assets.push({
        path: f.path,
        filename: f.filename,
        role: role === "occlusion" ? "bite" : role,
        preferred: true,
        format: name.match(/\.(\w+)$/i)?.[1]?.toLowerCase(),
      });
    }

    return [
      {
        id: `medit:${packageDir || "root"}`,
        source: {
          adapterId: "medit-export",
          vendor: "Medit",
          confidence: detection.confidence,
          detectReason: detection.reason,
        },
        patient: {
          displayName: folderStem,
          stem: folderStem.replace(/\s+/g, "-"),
        },
        caseRef: folderStem,
        packageDir,
        assets,
        warnings: assets.some((a) => a.role === "unknown")
          ? ["Bazı Medit dosyaları otomatik sınıflandırılamadı"]
          : [],
      },
    ];
  },
};
