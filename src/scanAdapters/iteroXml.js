import { basename, dedupeByBasenamePreferPly, meshFiles, normalizePatientDisplay, parseXmlObjectTags, patientStemFromDisplay } from "./shared.js";

/** @param {string} jawId @param {string} subType */
function mapIteroJawRole(jawId, subType) {
  const jaw = jawId?.toLowerCase();
  const sub = subType?.toLowerCase() || "";
  if (sub.includes("pretreatment")) {
    return jaw === "upper" ? "pretreatment" : jaw === "lower" ? "pretreatment" : "pretreatment";
  }
  if (jaw === "upper") return "upper";
  if (jaw === "lower") return "lower";
  return "unknown";
}

function iteroOrderIdFromFilename(filename) {
  return filename.match(/#(\d+)/)?.[1] || "";
}

function iteroXmlVersion(filename) {
  const m = filename.match(/_v(\d+)\.xml$/i);
  return m ? parseInt(m[1], 10) : 0;
}

/** Aynı sipariş için yalnızca en yüksek sürüm XML */
function pickBestIteroXmls(xmlFiles) {
  /** @type {Map<string, typeof xmlFiles[0]>} */
  const byOrder = new Map();
  for (const f of xmlFiles) {
    const orderId = iteroOrderIdFromFilename(f.filename);
    const key = orderId || f.path;
    const prev = byOrder.get(key);
    if (!prev || iteroXmlVersion(f.filename) > iteroXmlVersion(prev.filename)) {
      byOrder.set(key, f);
    }
  }
  return [...byOrder.values()];
}

function isPreferredIteroSurface(subType) {
  const sub = (subType || "").toLowerCase();
  if (sub.includes("pretreatment")) return false;
  return sub === "jaw" || sub.includes("with_ditch") || sub === "";
}

/** @type {import('./types.js').ScanAdapter} */
export const iteroXmlAdapter = {
  id: "itero-export-xml",
  vendor: "iTero",
  label: "iTero Export (XML manifest)",

  detect(files) {
    const xmls = files.filter((f) => /^itero_export_#.*\.xml$/i.test(f.filename));
    if (!xmls.length) return { confidence: 0 };
    const meshes = meshFiles(files).filter((f) => /jaw/i.test(f.filename));
    const bonus = meshes.length ? 0.15 : 0;
    return {
      confidence: Math.min(0.98, 0.7 + Math.min(xmls.length, 3) * 0.05 + bonus),
      reason: `${xmls.length} itero_export XML`,
    };
  },

  async parse({ files, packageDir, readText, detection }) {
    const xmlFiles = pickBestIteroXmls(
      files.filter((f) => /^itero_export_#.*\.xml$/i.test(f.filename))
    );

    const meshByName = new Map(
      dedupeByBasenamePreferPly(meshFiles(files)).map((f) => [f.filename.toLowerCase(), f])
    );

    /** @type {import('./types.js').ScanPackage[]} */
    const packages = [];

    for (const xmlFile of xmlFiles) {
      const xml = readText ? await readText(xmlFile.path) : null;
      if (!xml) {
        packages.push({
          id: `itero:${xmlFile.filename}`,
          source: {
            adapterId: "itero-export-xml",
            vendor: "iTero",
            confidence: detection.confidence * 0.5,
            detectReason: "XML okunamadı",
          },
          patient: { displayName: "", stem: "" },
          caseRef: xmlFile.filename.replace(/\.xml$/i, ""),
          packageDir,
          assets: [],
          warnings: ["itero_export XML içeriği okunamadı — dosya adı fallback kullanın"],
        });
        continue;
      }

      const orderId = xml.match(/<OrderID>([^<]*)<\/OrderID>/i)?.[1]?.trim() || "";
      const patientRaw = xml.match(/<Patient>([^<]*)<\/Patient>/i)?.[1]?.trim() || "";
      const displayName = normalizePatientDisplay(patientRaw);
      const stem = patientStemFromDisplay(displayName) || (orderId ? `itero-${orderId}` : "");

      const objects = parseXmlObjectTags(xml).filter((o) => o.ObjectType === "Surface" && o.FileName);
      /** @type {Map<string, import('./types.js').ScanAsset>} */
      const assetByRole = new Map();

      for (const obj of objects) {
        const filename = obj.FileName;
        const mesh = meshByName.get(filename.toLowerCase());
        if (!mesh) continue;

        const role = mapIteroJawRole(obj.JawId, obj.SubType);
        const preferred = isPreferredIteroSurface(obj.SubType);
        const existing = assetByRole.get(role);

        if (!existing || (preferred && !existing.preferred)) {
          assetByRole.set(role, {
            path: mesh.path,
            filename: mesh.filename,
            role: role === "pretreatment" ? "pretreatment" : role,
            preferred,
            format: mesh.filename.match(/\.(\w+)$/i)?.[1]?.toLowerCase(),
          });
        }
      }

      // with_ditch üst/alt yoksa pretreatment'ı yedek al (düşük öncelik)
      for (const jaw of ["upper", "lower"]) {
        if (assetByRole.has(jaw)) continue;
        const pret = [...assetByRole.values()].find(
          (a) => a.role === "pretreatment" && new RegExp(`${jaw}_jaw`, "i").test(a.filename)
        );
        if (pret) {
          assetByRole.set(jaw, { ...pret, role: jaw, preferred: false });
        }
      }

      const assets = [...assetByRole.values()].filter((a) => a.role !== "pretreatment");

      packages.push({
        id: `itero:${orderId || basename(xmlFile.path)}`,
        source: {
          adapterId: "itero-export-xml",
          vendor: "iTero",
          confidence: detection.confidence,
          detectReason: detection.reason,
        },
        patient: {
          displayName,
          stem,
          externalIds: orderId ? { iteroOrderId: orderId } : {},
        },
        caseRef: orderId || stem,
        packageDir,
        assets,
        warnings: assets.length ? [] : ["XML bulundu ancak eşleşen mesh yok"],
      });
    }

    if (!packages.length) {
      return [
        {
          id: `itero:empty:${packageDir}`,
          source: {
            adapterId: "itero-export-xml",
            vendor: "iTero",
            confidence: detection.confidence,
          },
          patient: { displayName: "", stem: "" },
          caseRef: packageDir || "",
          packageDir,
          assets: [],
          warnings: ["iTero XML var ama paket üretilemedi"],
        },
      ];
    }

    return packages;
  },
};
