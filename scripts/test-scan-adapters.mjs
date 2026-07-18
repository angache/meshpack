#!/usr/bin/env node
/**
 * Örnek tarama klasöründe adapter taslaklarını dener.
 * Kullanım: node scripts/test-scan-adapters.mjs
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";
import { ingestScanFiles } from "../src/scanAdapters/ingest.js";
import { MESH_EXT } from "../src/scanAdapters/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "farklı marka taramalar");

/** @param {string} dir @param {string} [base] */
function walk(dir, base = dir) {
  /** @type {import('../src/scanAdapters/types.js').ScanFileInput[]} */
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      files.push(...walk(path, base));
    } else {
      files.push({
        path,
        filename: name,
        modified_at: Math.floor(st.mtimeMs / 1000),
        size_bytes: st.size,
      });
    }
  }
  return files;
}

async function readText(path) {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

const allFiles = walk(ROOT);
const meshCount = allFiles.filter((f) => MESH_EXT.test(f.filename)).length;

console.log(`Kök: ${ROOT}`);
console.log(`Toplam dosya: ${allFiles.length}, mesh: ${meshCount}\n`);

const packages = await ingestScanFiles(allFiles, { readText });

for (const pkg of packages) {
  const relDir = pkg.packageDir ? relative(ROOT, pkg.packageDir) : ".";
  console.log("─".repeat(60));
  console.log(`Adapter : ${pkg.source.adapterId} (${pkg.source.vendor}) conf=${pkg.source.confidence.toFixed(2)}`);
  console.log(`Klasör  : ${relDir}`);
  console.log(`Hasta   : ${pkg.patient.displayName || "—"}  [stem: ${pkg.patient.stem || "—"}]`);
  console.log(`Vaka ref: ${pkg.caseRef}`);
  if (pkg.patient.externalIds && Object.keys(pkg.patient.externalIds).length) {
    console.log(`IDs     : ${JSON.stringify(pkg.patient.externalIds)}`);
  }
  for (const a of pkg.assets) {
    const pref = a.preferred ? "★" : " ";
    console.log(`  ${pref} ${a.role.padEnd(12)} ${a.filename}`);
  }
  for (const w of pkg.warnings || []) {
    console.log(`  ⚠ ${w}`);
  }
}

console.log("\n" + "─".repeat(60));
console.log(`Toplam paket: ${packages.length}`);

const byAdapter = {};
for (const p of packages) {
  byAdapter[p.source.adapterId] = (byAdapter[p.source.adapterId] || 0) + 1;
}
console.log("Adapter dağılımı:", byAdapter);
