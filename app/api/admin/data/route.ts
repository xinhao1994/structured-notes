// GET /api/admin/data?token=<ADMIN_TOKEN>
//
// Returns everything the dashboard needs. Uses raw fetch to Supabase REST
// (not the JS SDK) with explicit cache busting on EVERY query — the earlier
// JS-SDK approach was returning stale data despite force-dynamic. Raw
// fetch + ?t=timestamp + no-store header guarantees a fresh read every
// single call.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const VISIT_COLS = [
  "id", "visitor_id", "session_id", "chat_name",
  "ip", "country", "city", "region",
  "device_type", "browser", "os",
  "path", "referrer", "created_at",
].join(",");

async function supaFetch(path: string): Promise<any> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("missing supabase env");
  const sep = path.includes("?") ? "&" : "?";
  const bust = `${sep}_t=${Date.now()}`; // defeat any URL-based cache
  const res = await fetch(`${url}/rest/v1/${path}${bust}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`supabase ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
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

  let visits: any[] = [];
  let messages: any[] = [];
  let visitsError: string | null = null;
  let messagesError: string | null = null;

  try {
    // Pull more than the previous 500 — we have cheap bandwidth and users
    // want full history. Order newest first so the client just takes the top.
    visits = await supaFetch(
      `page_visits?select=${encodeURIComponent(VISIT_COLS)}&order=created_at.desc&limit=5000`
    );
  } catch (e: any) {
    visitsError = String(e?.message || e);
    console.log(`[admin/data] visits fetch failed: ${visitsError}`);
  }

  try {
    messages = await supaFetch(
      `chat_messages?select=sender_name,created_at&order=created_at.asc&limit=50000`
    );
  } catch (e: any) {
    messagesError = String(e?.message || e);
    console.log(`[admin/data] chat_messages fetch failed: ${messagesError}`);
  }

  return NextResponse.json(
    {
      visits,
      messages,
      generatedAt: new Date().toISOString(),
      _debug: {
        visits_count: visits.length,
        messages_count: messages.length,
        visits_error: visitsError,
        messages_error: messagesError,
      },
    },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
        "pragma": "no-cache",
        "expires": "0",
      },
    }
  );
}
