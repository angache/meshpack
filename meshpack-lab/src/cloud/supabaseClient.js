import { createClient } from "@supabase/supabase-js";

let client = null;

export function isCloudConfigured() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return !!(url && key && !url.includes("YOUR_PROJECT"));
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
        },
      }
    );
  }
  return client;
}

export function resetSupabaseClient() {
  client = null;
}
