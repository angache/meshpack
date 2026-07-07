import { getSupabase } from "./supabaseClient.js";
import { getActiveOrganization } from "./auth.js";

const BUCKET = "case-packages";

function normalizeStorageObjectKey(input) {
  let p = String(input || "").trim();
  if (!p) return "";

  // Full URL geldiyse pathname parçasını al.
  if (/^https?:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname || "";
    } catch {
      /* ignore */
    }
  }

  p = p.replace(/^\/+/, "");

  // Supabase storage URL prefixlerini temizle:
  // storage/v1/object/<bucket>/<key>
  // storage/v1/object/public/<bucket>/<key>
  // storage/v1/object/sign/<bucket>/<key>
  // storage/v1/object/authenticated/<bucket>/<key>
  p = p.replace(/^storage\/v1\/object\/(?:(?:public|sign|authenticated)\/)?[^/]+\//, "");

  // Bucket adı path içinde geldiyse düş.
  const bucketPrefix = `${BUCKET}/`;
  if (p.startsWith(bucketPrefix)) p = p.slice(bucketPrefix.length);

  return p;
}

const CASE_COLUMNS = `
  id, case_number, session_day, status,
  patient_display_name, patient_surname, patient_first_name,
  lab_notes, tooth_shade, dental_plan, annotations, manifest,
  package_storage_path, package_size_bytes,
  sent_at, received_at, completed_at, created_at, updated_at,
  clinic_org_id
`;

export async function listLabCases({ statusFilter = null } = {}) {
  const supabase = getSupabase();
  const org = await getActiveOrganization();
  if (!supabase || !org) throw new Error("Oturum gerekli");
  if (org.org_type !== "lab") throw new Error("Lab hesabı gerekli");

  let query = supabase
    .from("cloud_cases")
    .select(CASE_COLUMNS)
    .eq("lab_org_id", org.id)
    .order("sent_at", { ascending: false, nullsFirst: false });

  if (statusFilter && statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getLabCase(caseId) {
  const supabase = getSupabase();
  const org = await getActiveOrganization();
  if (!supabase || !org) throw new Error("Oturum gerekli");

  const { data, error } = await supabase
    .from("cloud_cases")
    .select(CASE_COLUMNS)
    .eq("id", caseId)
    .eq("lab_org_id", org.id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function updateCaseStatus(caseId, status) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Cloud yapılandırılmamış");

  const patch = { status, updated_at: new Date().toISOString() };
  if (status === "received") patch.received_at = patch.updated_at;
  if (status === "completed") patch.completed_at = patch.updated_at;

  const { error } = await supabase.from("cloud_cases").update(patch).eq("id", caseId);
  if (error) throw error;
}

export async function downloadCasePackage(storagePath, fallbacks = []) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Cloud yapılandırılmamış");
  if (!storagePath) throw new Error("Paket yolu yok");

  const candidates = [storagePath, ...fallbacks]
    .filter(Boolean)
    .map((p) => normalizeStorageObjectKey(p))
    .filter((p) => p.includes("/"));
  const traces = [];
  let lastError = null;
  for (const path of candidates) {
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (!error && data) return data;
    lastError = error || new Error("Paket indirilemedi");
    traces.push(`download ${path} -> ${error?.message || "failed"}`);
  }

  // Kurtarma: obje adı yanlışsa klasörü listeleyip zip dosyasını yakala.
  const probeDirs = [...new Set(candidates.map((p) => p.split("/").slice(0, -1).join("/")).filter(Boolean))];
  for (const dir of probeDirs) {
    const { data: files, error: listErr } = await supabase.storage.from(BUCKET).list(dir, {
      limit: 100,
      sortBy: { column: "name", order: "desc" },
    });
    if (listErr || !Array.isArray(files) || files.length === 0) {
      lastError = listErr || lastError;
      traces.push(`list ${dir} -> ${listErr?.message || "empty"}`);
      continue;
    }

    const zip = files.find((f) => typeof f?.name === "string" && /\.zip$/i.test(f.name));
    if (!zip?.name) continue;

    const recoveredPath = `${dir}/${zip.name}`.replace(/^\/+/, "");
    const { data, error } = await supabase.storage.from(BUCKET).download(recoveredPath);
    if (!error && data) return data;
    lastError = error || lastError;
    traces.push(`recover ${recoveredPath} -> ${error?.message || "failed"}`);
  }
  const detail = traces.length ? ` | ${traces.join(" ; ")}` : "";
  throw new Error(`Paket indirilemedi: ${lastError?.message || "unknown"}${detail}`);
}

export function subscribeLabQueue(labOrgId, onChange) {
  const supabase = getSupabase();
  if (!supabase || !labOrgId) return () => {};

  const channel = supabase
    .channel(`lab-queue:${labOrgId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "cloud_cases",
        filter: `lab_org_id=eq.${labOrgId}`,
      },
      (payload) => onChange?.(payload)
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function getClinicName(clinicOrgId) {
  const supabase = getSupabase();
  if (!supabase || !clinicOrgId) return null;

  const { data } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", clinicOrgId)
    .maybeSingle();

  return data?.name || null;
}
