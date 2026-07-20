import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

import type { EncryptedCaseEnvelope } from "./types";

export function createSupabase(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey);
}

export function subscribeIncomingCases(
  supabase: SupabaseClient,
  receiverId: string,
  onCase: (payload: EncryptedCaseEnvelope) => void,
): RealtimeChannel {
  return supabase
    .channel(`incoming_cases_${receiverId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "cases",
        filter: `receiver_id=eq.${receiverId}`,
      },
      ({ new: row }) => onCase(row as EncryptedCaseEnvelope),
    )
    .subscribe();
}
