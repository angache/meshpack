export const ANNOTATION_VERSION = 1;

export function emptyAnnotations() {
  return { version: ANNOTATION_VERSION, markers: [] };
}

export function parseAnnotations(raw) {
  if (!raw || raw === "{}") return emptyAnnotations();
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!data || typeof data !== "object") return emptyAnnotations();
    const markers = Array.isArray(data.markers)
      ? data.markers
          .filter((m) => m && typeof m === "object" && m.scanType && Array.isArray(m.position))
          .map((m) => ({
            id: String(m.id || crypto.randomUUID()),
            scanType: m.scanType,
            position: m.position.map(Number),
            normal: Array.isArray(m.normal) ? m.normal.map(Number) : [0, 1, 0],
            text: String(m.text || "").trim(),
            createdAt: Number(m.createdAt) || Date.now(),
          }))
      : [];
    return { version: ANNOTATION_VERSION, markers };
  } catch {
    return emptyAnnotations();
  }
}
