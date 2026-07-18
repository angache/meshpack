import { FORMAT_PRIORITY, MESH_EXT } from "./types.js";

/** @param {import('./types.js').ScanFileInput[]} files */
export function meshFiles(files) {
  return files.filter((f) => MESH_EXT.test(f.filename));
}

export function meshFormat(filename) {
  const m = filename.match(/\.(stl|ply|obj|dcm)$/i);
  return m ? m[1].toLowerCase() : "";
}

/** Aynı kök ad için en iyi formatı seç (ply > stl > obj) */
export function dedupeByBasenamePreferPly(files) {
  const byBase = new Map();
  for (const f of files) {
    const base = f.filename.replace(MESH_EXT, "").toLowerCase();
    const fmt = meshFormat(f.filename);
    const score = FORMAT_PRIORITY[fmt] ?? -1;
    const prev = byBase.get(base);
    if (!prev || score > prev.score) {
      byBase.set(base, { file: f, score });
    }
  }
  return [...byBase.values()].map((v) => v.file);
}

/** @param {import('./types.js').ScanFileInput[]} files */
export function groupFilesByParentDir(files) {
  /** @type {Map<string, import('./types.js').ScanFileInput[]>} */
  const map = new Map();
  for (const f of files) {
    const idx = Math.max(f.path.lastIndexOf("/"), f.path.lastIndexOf("\\"));
    const dir = idx >= 0 ? f.path.slice(0, idx) : "";
    if (!map.has(dir)) map.set(dir, []);
    map.get(dir).push(f);
  }
  return map;
}

export function basename(path) {
  const n = path.replace(/\\/g, "/");
  return n.slice(n.lastIndexOf("/") + 1);
}

export function parseXmlAttributes(tag) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const m of tag.matchAll(/(\w+)="([^"]*)"/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

export function parseXmlObjectTags(xml) {
  const objects = [];
  for (const m of xml.matchAll(/<Object\b([^>]*)\/?>/g)) {
    objects.push(parseXmlAttributes(m[1]));
  }
  return objects;
}

export function normalizePatientDisplay(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "";
  // iTero: "Soyad, Ad"
  if (trimmed.includes(",")) {
    const [surname, first] = trimmed.split(",").map((s) => s.trim());
    if (surname && first) return `${surname} ${first}`;
  }
  return trimmed;
}

export function patientStemFromDisplay(displayName) {
  if (!displayName) return "";
  return displayName
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-");
}
