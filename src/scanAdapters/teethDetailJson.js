import { dedupeByBasenamePreferPly, meshFiles } from "./shared.js";

/** @param {string} catalog */
function catalogToRole(catalog) {
  const c = (catalog || "").toLowerCase();
  if (c === "upper") return "upper";
  if (c === "lower") return "lower";
  if (c.startsWith("bite")) return c === "bite1" ? "bite" : c === "bite2" ? "bite2" : "bite";
  return "unknown";
}

/** @type {import('./types.js').ScanAdapter} */
export const teethDetailJsonAdapter = {
  id: "teeth-detail-json",
  vendor: "lab-cad",
  label: "Lab export (teeth_detail.json manifest)",

  detect(files) {
    const manifest = files.find((f) => f.filename.toLowerCase() === "teeth_detail.json");
    if (!manifest) return { confidence: 0 };
    const meshes = meshFiles(files);
    return {
      confidence: meshes.length ? 0.88 : 0.6,
      reason: "teeth_detail.json manifest",
    };
  },

  async parse({ files, packageDir, readText, detection }) {
    const manifestFile = files.find((f) => f.filename.toLowerCase() === "teeth_detail.json");
    const meshes = dedupeByBasenamePreferPly(meshFiles(files));
    const meshByName = new Map(meshes.map((f) => [f.filename.toLowerCase(), f]));

    const folderStem = (packageDir || "").split(/[/\\]/).pop() || "lab-export";
    const warnings = [];

    if (!manifestFile || !readText) {
      return [
        {
          id: `teeth-detail:${packageDir}`,
          source: {
            adapterId: "teeth-detail-json",
            vendor: "lab-cad",
            confidence: detection.confidence * 0.4,
          },
          patient: { displayName: folderStem, stem: folderStem },
          caseRef: folderStem,
          packageDir,
          assets: [],
          warnings: ["teeth_detail.json okunamadı"],
        },
      ];
    }

    let manifest;
    try {
      manifest = JSON.parse(await readText(manifestFile.path));
    } catch {
      return [
        {
          id: `teeth-detail:${packageDir}`,
          source: {
            adapterId: "teeth-detail-json",
            vendor: "lab-cad",
            confidence: detection.confidence * 0.3,
          },
          patient: { displayName: folderStem, stem: folderStem },
          caseRef: folderStem,
          packageDir,
          assets: [],
          warnings: ["teeth_detail.json parse hatası"],
        },
      ];
    }

    /** @type {Map<string, import('./types.js').ScanAsset>} */
    const byRole = new Map();
    const entries = Array.isArray(manifest.files) ? manifest.files : [];

    for (const entry of entries) {
      const filename = entry.filename;
      const mesh = meshByName.get(String(filename).toLowerCase());
      if (!mesh) continue;

      const role = catalogToRole(entry.catalog);
      const fmt = filename.match(/\.(\w+)$/i)?.[1]?.toLowerCase() || "";
      const fmtScore = { ply: 3, stl: 2, obj: 1 }[fmt] || 0;
      const existing = byRole.get(role);
      const existingScore = existing
        ? { ply: 3, stl: 2, obj: 1 }[existing.format || ""] || 0
        : -1;

      if (!existing || fmtScore > existingScore) {
        byRole.set(role, {
          path: mesh.path,
          filename: mesh.filename,
          role,
          preferred: true,
          format: fmt,
        });
      }
    }

    const assets = [...byRole.values()];
    if (!assets.length) warnings.push("Manifest var ama mesh eşleşmesi yok");

    const pdfName = files.find((f) => /ordersheet\.pdf$/i.test(f.filename))?.filename;
    if (pdfName) {
      const patientGuess = pdfName.replace(/_ordersheet\.pdf$/i, "").replace(/^\d+_/, "");
      return [
        {
          id: `teeth-detail:${packageDir}`,
          source: {
            adapterId: "teeth-detail-json",
            vendor: "lab-cad",
            confidence: detection.confidence,
            detectReason: detection.reason,
          },
          patient: {
            displayName: patientGuess.replace(/_/g, " "),
            stem: patientGuess.replace(/\s+/g, "-"),
          },
          caseRef: patientGuess,
          packageDir,
          assets,
          warnings,
        },
      ];
    }

    return [
      {
        id: `teeth-detail:${packageDir}`,
        source: {
          adapterId: "teeth-detail-json",
          vendor: "lab-cad",
          confidence: detection.confidence,
          detectReason: detection.reason,
        },
        patient: { displayName: folderStem, stem: folderStem },
        caseRef: folderStem,
        packageDir,
        assets,
        warnings,
      },
    ];
  },
};
