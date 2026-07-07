import { invoke } from "@tauri-apps/api/core";
import { getSupabaseAsync } from "./supabaseClient.js";
import { getActiveOrganization, getLinkedLabOrgId, getSession } from "./auth.js";

const BUCKET = "case-packages";

function storagePath(clinicOrgId, caseId, caseNumber) {
  const safe = caseNumber.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${clinicOrgId}/${caseId}/${safe}.zip`;
}

/**
 * CasePackage ZIP + manifest'i MeshPack Cloud'a yükler.
 * @returns {Promise<{ caseId: string, storagePath: string }>}
 */
export async function uploadCaseToCloud({ caseRow, patient, manifest, zipPath }) {
  const supabase = await getSupabaseAsync();
  const session = await getSession();
  if (!supabase || !session) throw new Error("Oturum açın (Ayarlar → MeshPack Cloud)");

  const clinicOrg = await getActiveOrganization();
  if (!clinicOrg) throw new Error("Aktif organizasyon seçilmemiş");
  if (clinicOrg.org_type !== "clinic") throw new Error("Sadece klinik hesabı vaka gönderebilir");

  const labOrgId = await getLinkedLabOrgId(clinicOrg.id);
  if (!labOrgId) throw new Error("Bağlı laboratuvar yok — clinic_lab_links kaydı gerekli");

  const path = storagePath(clinicOrg.id, caseRow.id, caseRow.case_number);
  const bytes = await invoke("read_file_bytes", { path: zipPath });
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/zip" });

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, blob, {
    upsert: true,
    contentType: "application/zip",
  });
  if (uploadError) throw uploadError;

  const manifestObj = typeof manifest === "string" ? JSON.parse(manifest) : manifest;
  const now = new Date().toISOString();

  const row = {
    id: caseRow.id,
    clinic_org_id: clinicOrg.id,
    lab_org_id: labOrgId,
    case_number: caseRow.case_number,
    session_day: caseRow.session_day,
    status: "sent",
    patient_display_name: manifestObj.patient?.displayName || "",
    patient_surname: manifestObj.patient?.surname || patient?.surname || "",
    patient_first_name: manifestObj.patient?.firstName || patient?.first_name || "",
    lab_notes: manifestObj.case?.labNotes || "",
    tooth_shade: manifestObj.case?.toothShade || "",
    dental_plan: manifestObj.case?.dentalPlan || { teeth: {} },
    annotations: manifestObj.case?.annotations || { version: 1, markers: [] },
    manifest: manifestObj,
    package_storage_path: path,
    package_size_bytes: blob.size,
    sent_at: now,
    updated_at: now,
  };

  const { error: upsertError } = await supabase.from("cloud_cases").upsert(row, { onConflict: "id" });
  if (upsertError) throw upsertError;

  // Lab üyelerine bildirim (DB trigger mesajlar için; yeni vaka için manuel insert)
  const { data: labMembers } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", labOrgId);

  if (labMembers?.length) {
    const notifications = labMembers.map((m) => ({
      user_id: m.user_id,
      organization_id: labOrgId,
      case_id: caseRow.id,
      type: "new_case",
      title: `Yeni vaka: ${caseRow.case_number}`,
      body: row.patient_display_name || "Yeni CasePackage",
    }));
    await supabase.from("notifications").insert(notifications);
  }

  return { caseId: caseRow.id, storagePath: path };
}

export async function updateCloudCaseStatus(caseId, status) {
  const supabase = await getSupabaseAsync();
  if (!supabase) throw new Error("Cloud yapılandırılmamış");

  const patch = { status, updated_at: new Date().toISOString() };
  if (status === "received") patch.received_at = patch.updated_at;
  if (status === "completed") patch.completed_at = patch.updated_at;

  const { error } = await supabase.from("cloud_cases").update(patch).eq("id", caseId);
  if (error) throw error;
}
