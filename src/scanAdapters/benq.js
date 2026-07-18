import { parseScanFilename } from "../scanFilename.js";
import { parseSuggestedName } from "../utils.js";
import { basename, dedupeByBasenamePreferPly, meshFiles } from "./shared.js";

function extractBenqPatientStem(files) {
  const dated = files
    .map((f) => f.filename)
    .find((n) => /^\d{4}-\d{2}-\d{2}_\d+_/i.test(n));
  if (!dated) return "";

  const base = dated.replace(/\.(stl|ply|obj|beb|hasscan|inProject|png)$/i, "");
  const match = base.match(/^\d{4}-\d{2}-\d{2}_\d+_(.+?)(?:-TotalJaw\d+)?$/i);
  if (!match) return "";

  return match[1]
    .trim()
    .replace(/\s+/g, "-")
    .replace(/\.+/g, "-")
    .replace(/-+/g, "-")
    .replace(/-$/g, "");
}

function mapBenqRole(filename) {
  if (/TotalJaw0/i.test(filename)) return "bite";
  if (/TotalJaw1/i.test(filename)) return "bite2";
  const parsed = parseScanFilename(filename);
  if (parsed.scanType !== "unknown") return parsed.scanType;
  if (/^UpperJaw/i.test(filename)) return "upper";
  if (/^LowerJaw/i.test(filename)) return "lower";
  return "unknown";
}

/** @type {import('./types.js').ScanAdapter} */
export const benqAdapter = {
  id: "benq-scanner",
  vendor: "Benq",
  label: "Benq / Hasscan export",

  detect(files) {
    const names = files.map((f) => f.filename.toLowerCase()).join(" ");
    const hasscan = files.some((f) => f.filename.toLowerCase().endsWith(".hasscan"));
    const totalJaw = /totaljaw\d/.test(names);
    const upperLower = /upperjaw\.(stl|obj|ply)/.test(names) && /lowerjaw\.(stl|obj|ply)/.test(names);
    if (!hasscan && !totalJaw && !upperLower) return { confidence: 0 };
    let confidence = 0.45;
    if (hasscan) confidence += 0.25;
    if (totalJaw) confidence += 0.15;
    if (upperLower) confidence += 0.2;
    return { confidence: Math.min(0.9, confidence), reason: "Benq/Hasscan imzası" };
  },

  async parse({ files, packageDir, detection }) {
    const meshes = dedupeByBasenamePreferPly(meshFiles(files));
    const stem = extractBenqPatientStem(files) || basename(packageDir || "") || "benq";
    const displayName = parseSuggestedName(stem) || stem.replace(/-/g, " ");

    const assets = meshes.map((f) => {
      const role = mapBenqRole(f.filename);
      return {
        path: f.path,
        filename: f.filename,
        role,
        preferred: !/^TotalJaw/i.test(f.filename) || role.startsWith("bite"),
        format: f.filename.match(/\.(\w+)$/i)?.[1]?.toLowerCase(),
      };
    });

    const warnings = [];
    if (assets.some((a) => a.role === "unknown")) {
      warnings.push("Benq: TotalJaw veya tanınmayan dosya rolleri kontrol edilmeli");
    }

    return [
      {
        id: `benq:${packageDir || stem}`,
        source: {
          adapterId: "benq-scanner",
          vendor: "Benq",
          confidence: detection.confidence,
          detectReason: detection.reason,
        },
        patient: { displayName, stem },
        caseRef: stem,
        packageDir,
        assets,
        warnings,
      },
    ];
  },
};
