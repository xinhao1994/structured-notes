// POST /api/migrate/button-events
// Checks if button_events table exists.
// If it does → returns {ok: true, exists: true}.
// If not → returns {ok: false, exists: false, sql: "<DDL to run>"} with the exact SQL Aiden needs to paste into Supabase SQL Editor.
// Protected by CRON_SECRET.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { readFileSync } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DDL = `
CREATE TABLE IF NOT EXISTS button_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_id TEXT,
  session_id TEXT,
  chat_name TEXT,
  button_name TEXT NOT NULL,
  page TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_button_events_created_at ON button_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_button_events_button_name ON button_events (button_name);
ALTER TABLE button_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon insert button events" ON button_events FOR INSERT WITH CHECK (true);
`.trim();

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const supplied =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    "";

  if (!secret || supplied !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supa = getSupabaseAdmin();
  if (!supa) {
    return NextResponse.json({ error: "no supabase admin client" }, { status: 500 });
  }

  // Check if table exists
  const { data, error } = await supa.from("button_events").select("id").limit(1);

  if (!error) {
    // Table exists and is readable
    return NextResponse.json({ ok: true, exists: true, message: "button_events table is ready" });
  }

  if (error.code === "42P01" || error.message?.includes("button_events")) {
    // Table does not exist
    return NextResponse.json({
      ok: false,
      exists: false,
      message: "button_events table not found. Tracking is using page_visits fallback. Run the SQL below in Supabase SQL Editor to enable full tracking.",
      sql: DDL,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "unknown",
      steps: [
        "1. Open https://supabase.com/dashboard",
        "2. Select your project",
        "3. Click SQL Editor",
        "4. Paste the 'sql' field above and click Run",
        "5. Call this endpoint again to verify",
      ],
    });
  }

  return NextResponse.json({
    ok: false,
    exists: "unknown",
    error: error.message,
  });
}
