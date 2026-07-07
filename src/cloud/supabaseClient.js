import { createClient } from "@supabase/supabase-js";
import { migrateLegacyCloudSessions, secureCloudStorage } from "./secureStorage.js";

let client = null;
let initPromise = null;

export function isCloudConfigured() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return !!(url && key && !url.includes("YOUR_PROJECT"));
}

async function ensureCloudStorageReady() {
  if (!initPromise) {
    initPromise = migrateLegacyCloudSessions().catch(() => {});
  }
  await initPromise;
}

export async function getSupabaseAsync() {
  if (!isCloudConfigured()) return null;
  await ensureCloudStorageReady();
  return getSupabase();
}

export function getSupabase() {
  if (!isCloudConfigured()) return null;
  if (!client) {
    client = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storage: secureCloudStorage,
          storageKey: `sb-${new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split(".")[0]}-auth-token`,
        },
      }
    );
  }
  return client;
}

export function resetSupabaseClient() {
  client = null;
}
