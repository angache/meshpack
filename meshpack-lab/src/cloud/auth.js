import { getSupabase, resetSupabaseClient } from "./supabaseClient.js";

/** Tauri WebKit'te Error'a özellik eklenemez */
export class CloudAuthError extends Error {
  constructor(message, { step, status, code, details, hint } = {}) {
    super(message || "Kimlik doğrulama hatası");
    this.name = "CloudAuthError";
    this.step = step;
    this.status = status;
    this.code = code;
    this.details = details;
    this.hint = hint;
  }
}

function fromSupabaseAuthError(error, step, fallback) {
  return new CloudAuthError(error?.msg || error?.message || error?.code || fallback, {
    step,
    status: error?.status,
    code: error?.code || error?.error_code,
  });
}

function fromSupabaseRpcError(error, step, fallback) {
  return new CloudAuthError(error?.message || error?.code || fallback, {
    step,
    code: error?.code,
    details: error?.details,
    hint: error?.hint,
  });
}

export async function getSession() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signIn(email, password) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("MeshPack Cloud yapılandırılmamış (.env)");

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw fromSupabaseAuthError(error, "auth_signin", "Giriş başarısız");
  return data;
}

export async function signUp(email, password, metadata = {}) {
  const supabase = getSupabase();
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
  return data;
}

export async function signUpWithOrganization({ email, password, orgName, orgType }) {
  const supabase = getSupabase();
  const data = await signUp(email, password, {
    org_name: orgName.trim(),
    org_type: orgType,
  });

  if (data.session && supabase) {
    await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    await registerOrganization(orgName, orgType);
  }

  return { needsEmailConfirm: !data.session };
}

export async function ensureOrganizationFromMetadata() {
  const supabase = getSupabase();
  const session = await getSession();
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
  if (supabase) await supabase.auth.signOut();
  resetSupabaseClient();
}

export async function getProfile() {
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
}

export async function getActiveOrganization() {
  const profile = await getProfile();
  if (!profile?.active_organization_id) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, org_type, pairing_code")
    .eq("id", profile.active_organization_id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export function onAuthStateChange(callback) {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => data.subscription.unsubscribe();
}
