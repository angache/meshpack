/**
 * Platform-agnostik ölçü paketi modeli.
 * Tüm tarayıcı adapter'ları bu yapıya üretir.
 */

/** @typedef {'upper'|'lower'|'bite'|'bite2'|'abutment'|'pretreatment'|'occlusion'|'other'|'unknown'} ScanAssetRole */

/**
 * @typedef {Object} ScanAsset
 * @property {string} path
 * @property {string} filename
 * @property {ScanAssetRole} role
 * @property {boolean} [preferred] — set içinde öncelikli mesh (ör. iTero with_ditch)
 * @property {string} [format] — stl | ply | obj
 */

/**
 * @typedef {Object} ScanPatientRef
 * @property {string} [displayName]
 * @property {string} [stem] — gruplama anahtarı
 * @property {Record<string, string>} [externalIds]
 */

/**
 * @typedef {Object} ScanPackageSource
 * @property {string} adapterId
 * @property {string} [vendor]
 * @property {number} confidence — 0..1
 * @property {string} [detectReason]
 */

/**
 * @typedef {Object} ScanPackage
 * @property {string} id
 * @property {ScanPackageSource} source
 * @property {ScanPatientRef} patient
 * @property {string} caseRef — sipariş no, stem veya klasör kimliği
 * @property {string} [packageDir]
 * @property {ScanAsset[]} assets
 * @property {string[]} [warnings]
 */

/**
 * @typedef {Object} ScanFileInput
 * @property {string} path
 * @property {string} filename
 * @property {number} [modified_at]
 * @property {number} [size_bytes]
 */

/**
 * @typedef {Object} AdapterParseContext
 * @property {ScanFileInput[]} files
 * @property {string} [packageDir]
 * @property {(path: string) => Promise<string|null>} [readText]
 * @property {{ adapterId: string, confidence: number, reason?: string }} detection
 */

/**
 * @typedef {Object} ScanAdapter
 * @property {string} id
 * @property {string} vendor
 * @property {string} label
 * @property {(files: ScanFileInput[], packageDir?: string) => { confidence: number, reason?: string }}
 *   detect
 * @property {(ctx: AdapterParseContext) => Promise<ScanPackage[]>} parse
 */

export const MESH_EXT = /\.(stl|ply|obj|dcm)$/i;

export const FORMAT_PRIORITY = { ply: 3, stl: 2, obj: 1, dcm: 0 };

/** @param {ScanAssetRole} role */
export function roleToLegacyScanType(role) {
  if (role === "upper" || role === "lower" || role === "bite" || role === "bite2") return role === "bite2" ? "bite" : role;
  return "unknown";
}
