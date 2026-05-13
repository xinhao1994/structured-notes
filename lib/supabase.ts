// Supabase admin client — server-only.
//
// Uses the service-role key, so this MUST NEVER be imported into a client
// component or page. Only API routes (server runtime) may use it.
//
// Required env vars:
//   NEXT_PUBLIC_SUPABASE_URL   — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY  — service-role key (DO NOT prefix NEXT_PUBLIC_)

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Returned shape of a row in push_subscriptions. */
export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  keys_p256dh: string;
  keys_auth: string;
  pocket_tranches: any[]; // PocketEntry[] — kept loosely typed to avoid coupling
  timezone: string;
  device_label: string | null;
  created_at: string;
  updated_at: string;
}
