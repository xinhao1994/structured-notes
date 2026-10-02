// GET /api/admin/data?token=<ADMIN_TOKEN>
//
// Returns everything the live dashboard needs in one JSON payload:
//   - Latest 500 visits (full rows)
//   - Chat messages (sender_name + created_at, up to 50k)
// Called every few seconds by the client-side dashboard poller.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function GET(req: NextRequest) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "disabled" }, { status: 503 });
  }
  const supplied =
    req.nextUrl.searchParams.get("token") ??
    req.headers.get("x-admin-token") ??
    "";
  if (!constantTimeEqual(supplied, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supa = getSupabaseAdmin();
  if (!supa) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 503 });
  }

  // Explicit column list (never "*") — a corrupt UA string in one row was
  // silently truncating the entire SELECT response when "*" expanded to
  // include every text column. By listing columns and omitting user_agent
  // (not needed for the dashboard anyway), the response always returns all
  // rows.
  const VISIT_COLS = [
    "id", "visitor_id", "session_id", "chat_name",
    "ip", "country", "city", "region",
    "device_type", "browser", "os",
    "path", "referrer", "created_at",
    "last_heartbeat_at", "offline_at",
  ].join(", ");

  const [visitsRes, msgsRes, countRes] = await Promise.all([
    supa.from("page_visits").select(VISIT_COLS).order("created_at", { ascending: false }).limit(500),
    supa.from("chat_messages").select("sender_name, created_at").order("created_at", { ascending: true }).limit(50_000),
    supa.from("page_visits").select("id", { count: "exact", head: true }),
  ]);

  // Debug: expose which Supabase this route is reading from, and the true
  // table row count — compare against /api/track's inserted row to prove
  // whether we're hitting the same database.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const projectRef = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] || "unknown";

  return NextResponse.json(
    {
      visits: visitsRes.data ?? [],
      messages: msgsRes.data ?? [],
      generatedAt: new Date().toISOString(),
      _debug: {
        supabase_project: projectRef,
        page_visits_total: countRes.count ?? null,
        visits_error: visitsRes.error?.message ?? null,
        count_error: countRes.error?.message ?? null,
        returned_rows: visitsRes.data?.length ?? null,
      },
    },
    { headers: { "cache-control": "no-store, no-cache, must-revalidate" } }
  );
}
