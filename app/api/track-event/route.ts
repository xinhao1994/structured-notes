// POST /api/track-event — logs a single button click into button_events.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const s = (v: unknown, max = 200) => {
  const str = String(v ?? "").slice(0, max);
  return str || null;
};

export async function POST(req: NextRequest) {
  const supa = getSupabaseAdmin();
  if (!supa) return NextResponse.json({ ok: false }, { status: 200 });

  let body: any = {};
  try { body = await req.json(); } catch {}

  const buttonName = s(body.buttonName, 100);
  if (!buttonName) return NextResponse.json({ ok: false, reason: "missing button_name" });

  const row = {
    visitor_id:  s(body.visitorId, 64),
    session_id:  s(body.sessionId, 64),
    chat_name:   s(body.chatName,  64),
    button_name: buttonName,
    page:        s(body.page, 200),
    meta:        body.meta && typeof body.meta === "object" ? body.meta : null,
  };

  const { error } = await supa.from("button_events").insert(row);
  if (error) {
    console.log(`[track-event] insert error: ${error.message}`);
  }

  return NextResponse.json({ ok: !error }, { status: 200 });
}
