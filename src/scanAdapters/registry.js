import { benqAdapter } from "./benq.js";
import { genericFilenameAdapter } from "./genericFilename.js";
import { iteroXmlAdapter } from "./iteroXml.js";
import { meditAdapter } from "./medit.js";
import { shapeTriosAdapter } from "./shapeTrios.js";
import { teethDetailJsonAdapter } from "./teethDetailJson.js";

/** Öncelik: yüksekten düşüğe — detect skoru eşitse listede önce olan kazanır */
export const SCAN_ADAPTERS = [
  iteroXmlAdapter,
  teethDetailJsonAdapter,
  shapeTriosAdapter,
  meditAdapter,
  benqAdapter,
  genericFilenameAdapter,
];

/** @param {string} id */
export function getScanAdapter(id) {
  return SCAN_ADAPTERS.find((a) => a.id === id) || genericFilenameAdapter;
}

/**
 * @param {import('./types.js').ScanFileInput[]} files
 * @param {string} [packageDir]
 */
export function detectScanAdapter(files, packageDir = "") {
  let best = { adapterId: genericFilenameAdapter.id, confidence: 0, reason: "none" };

  for (const adapter of SCAN_ADAPTERS) {
    if (adapter.id === genericFilenameAdapter.id) continue;
    const result = adapter.detect(files, packageDir);
    if (result.confidence > best.confidence) {
      best = {
        adapterId: adapter.id,
        confidence: result.confidence,
        reason: result.reason,
      };
    }
  }

  if (best.confidence < 0.35) {
    const fallback = genericFilenameAdapter.detect(files, packageDir);
    return {
      adapterId: genericFilenameAdapter.id,
      confidence: Math.max(best.confidence, fallback.confidence),
      reason: best.confidence > 0 ? `${best.reason} → fallback` : "generic-filename",
    };
  }

  return best;
}
