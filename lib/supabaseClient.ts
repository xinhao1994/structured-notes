"use client";
// Browser-side Supabase client — uses the ANON KEY (safe to expose).
// Different from lib/supabase.ts, which uses the service_role key and is
// SERVER-ONLY. Never import this from a route handler; never import
// lib/supabase.ts from a client component.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  cached = createClient(url, anon, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return cached;
}
