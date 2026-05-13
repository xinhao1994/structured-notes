// POST /api/push/unsubscribe   Body: { endpoint }
// Removes the row. Called when the user turns alerts off or uninstalls the
// PWA (browser auto-revokes the subscription).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supa = getSupabaseAdmin();
  if (!supa) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  let body: { endpoint?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  const { error } = await supa.from("push_subscriptions").delete().eq("endpoint", body.endpoint);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
