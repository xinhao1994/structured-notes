// POST /api/push/subscribe
//
// Body: { subscription: PushSubscriptionJSON, pocket: PocketEntry[], deviceLabel?, timezone? }
//
// Upserts the row in push_subscriptions keyed by endpoint URL. Idempotent —
// the client can call this every time pocket changes (`/api/push/sync`
// does that more cheaply, but subscribe is also acceptable).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SubscribeBody {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  pocket?: any[];
  deviceLabel?: string;
  timezone?: string;
}

export async function POST(req: NextRequest) {
  const supa = getSupabaseAdmin();
  if (!supa) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  let body: SubscribeBody;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const sub = body.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json({ error: "subscription must have endpoint and keys" }, { status: 400 });
  }

  const row = {
    endpoint: sub.endpoint,
    keys_p256dh: sub.keys.p256dh,
    keys_auth: sub.keys.auth,
    pocket_tranches: Array.isArray(body.pocket) ? body.pocket : [],
    timezone: body.timezone || "Asia/Kuala_Lumpur",
    device_label: body.deviceLabel ?? null,
  };

  const { error } = await supa
    .from("push_subscriptions")
    .upsert(row, { onConflict: "endpoint" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
