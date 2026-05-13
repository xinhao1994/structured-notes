// POST /api/push/sync
//
// Body: { endpoint: string, pocket: PocketEntry[] }
//
// Updates ONLY the pocket_tranches column for an existing subscription row.
// Cheaper than re-sending subscription keys when only the Pocket changed.
// Returns 404 if the endpoint doesn't exist (client should re-subscribe).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supa = getSupabaseAdmin();
  if (!supa) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  let body: { endpoint?: string; pocket?: any[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.endpoint || !Array.isArray(body.pocket)) {
    return NextResponse.json({ error: "endpoint + pocket required" }, { status: 400 });
  }

  // .select() returns the affected rows so we can verify the endpoint
  // existed before reporting success. Avoids supabase-js v2's typed
  // count+head overload, which TS resolves inconsistently across versions.
  const { error, data } = await supa
    .from("push_subscriptions")
    .update({ pocket_tranches: body.pocket })
    .eq("endpoint", body.endpoint)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "subscription not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, count: data.length });
}
