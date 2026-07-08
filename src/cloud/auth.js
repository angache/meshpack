import { clearSecureCloudSessions } from "./secureStorage.js";
import { getSupabase, getSupabaseAsync, resetSupabaseClient } from "./supabaseClient.js";
import { fromSupabaseAuthError, fromSupabaseRpcError } from "./authErrors.js";

const AUTH_CACHE_TTL = 30000;
let _profileCache = null;
let _orgCache = null;

/** Profil/organizasyon belleğini temizler (giriş/çıkış/org değişimi sonrası). */
export function clearAuthCache() {
  _profileCache = null;
  _orgCache = null;
}

export async function getSession() {
  const supabase = await getSupabaseAsync();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signIn(email, password) {
  const supabase = await getSupabaseAsync();
  if (!supabase) throw new Error("MeshPack Cloud yapılandırılmamış (.env)");

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw fromSupabaseAuthError(error, "auth_signin", "Giriş başarısız");

  clearAuthCache();

  if (data.session) {
    await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  }

  return data;
}

export async function signUp(email, password, metadata = {}) {
  const supabase = await getSupabaseAsync();
  if (!supabase) throw new Error("MeshPack Cloud yapılandırılmamış (.env)");

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: Object.keys(metadata).length ? { data: metadata } : undefined,
  });
  if (error) {
    console.error("[signUp]", error);
    throw fromSupabaseAuthError(error, "auth_signup", "Kayıt başarısız");
  }
  return data;
}

export async function registerOrganization(orgName, orgType) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("MeshPack Cloud yapılandırılmamış");

  const { data, error } = await supabase.rpc("register_meshpack_organization", {
    p_org_name: orgName.trim(),
    p_org_type: orgType,
  });
  if (error) {
    console.error("[registerOrganization]", error);
    throw fromSupabaseRpcError(error, "register_org", "Organizasyon oluşturulamadı");
  }
  clearAuthCache();
  return data;
}

export async function linkClinicToLab(labPairingCode) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("MeshPack Cloud yapılandırılmamış");

  const { data, error } = await supabase.rpc("link_clinic_to_lab", {
    p_lab_pairing_code: labPairingCode.trim(),
  });
  if (error) throw fromSupabaseRpcError(error, "link_lab", "Eşleştirme başarısız");
  return data;
}

export async function signUpWithOrganization({ email, password, orgName, orgType }) {
  const supabase = await getSupabaseAsync();
  const data = await signUp(email, password, {
    org_name: orgName.trim(),
    org_type: orgType,
  });

  if (data.session && supabase) {
    // Kasa yazımı gecikse bile RPC için oturumu belleğe al
    await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    await registerOrganization(orgName, orgType);
  }

  return { needsEmailConfirm: !data.session };
}

/** E-posta onayı sonrası ilk girişte metadata'dan org kurar */
export async function ensureOrganizationFromMetadata(hintSession = null) {
  const supabase = getSupabase();
  const session = hintSession || (await getSession());
  if (!supabase || !session) return false;

  const profile = await getProfile();
  if (profile?.active_organization_id) return false;

  const orgName = session.user.user_metadata?.org_name;
  const orgType = session.user.user_metadata?.org_type;
  if (!orgName || !orgType) return false;

  await registerOrganization(orgName, orgType);
  return true;
}

export async function signOut() {
  const supabase = getSupabase();
  if (supabase) {
    await supabase.auth.signOut();
  }
  await clearSecureCloudSessions();
  resetSupabaseClient();
  clearAuthCache();
}

export async function getProfile({ force = false } = {}) {
  const now = Date.now();
  if (!force && _profileCache) {
    if (_profileCache.promise) return _profileCache.promise;
    if (now - _profileCache.at < AUTH_CACHE_TTL) return _profileCache.value;
  }

  const promise = (async () => {
    const supabase = getSupabase();
    const session = await getSession();
    if (!supabase || !session) return null;

    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, active_organization_id")
      .eq("id", session.user.id)
      .maybeSingle();

    if (error) throw error;
    return data;
  })();

  _profileCache = { at: now, value: null, promise };
  try {
    const value = await promise;
    _profileCache = { at: Date.now(), value, promise: null };
    return value;
  } catch (err) {
    _profileCache = null;
    throw err;
  }
}

export async function getActiveOrganization({ force = false } = {}) {
  const now = Date.now();
  if (!force && _orgCache) {
    if (_orgCache.promise) return _orgCache.promise;
    if (now - _orgCache.at < AUTH_CACHE_TTL) return _orgCache.value;
  }

  const promise = (async () => {
    const profile = await getProfile({ force });
    if (!profile?.active_organization_id) return null;

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("organizations")
      .select("id, name, org_type, pairing_code")
      .eq("id", profile.active_organization_id)
      .maybeSingle();

    if (error) throw error;
    return data;
  })();

  _orgCache = { at: now, value: null, promise };
  try {
    const value = await promise;
    _orgCache = { at: Date.now(), value, promise: null };
    return value;
  } catch (err) {
    _orgCache = null;
    throw err;
  }
}

/** Klinik org için bağlı lab org id */
export async function getLinkedLabOrgId(clinicOrgId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("clinic_lab_links")
    .select("lab_org_id")
    .eq("clinic_org_id", clinicOrgId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.lab_org_id || null;
}

/** Klinik, MeshPack Lab ile eşleşmiş ve oturum açık mı? */
export async function canSendViaMeshPackLab() {
  if (!getSupabase()) return false;

  const session = await getSession();
  if (!session) return false;

  const org = await getActiveOrganization();
  if (!org || org.org_type !== "clinic") return false;

  const linkedLab = await getLinkedLabOrgId(org.id);
  return !!linkedLab;
}

export function onAuthStateChange(callback) {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => data.subscription.unsubscribe();
}
