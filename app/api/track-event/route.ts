// POST /api/track-event — logs a single button click.
// Tries button_events first; if the table doesn't exist yet (42P01),
// falls back to page_visits with path = "__btn:<buttonName>" so tracking
// works even before the DDL migration has been run.

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
    // Table not created yet — fall back to page_visits so tracking still works
    if (error.code === "42P01" || error.message?.includes("button_events")) {
      const ua = req.headers.get("user-agent") ?? "";
      const fallbackRow = {
        visitor_id: row.visitor_id,
        session_id: row.session_id,
        chat_name:  row.chat_name,
        path:       `__btn:${buttonName}`,
        ip:         req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        country:    req.headers.get("x-vercel-ip-country") ?? null,
        city:       req.headers.get("x-vercel-ip-city") ?? null,
        region:     req.headers.get("x-vercel-ip-country-region") ?? null,
        user_agent: ua.slice(0, 300) || null,
        referrer:   s(body.page, 200),
      };
      const { error: fbErr } = await supa.from("page_visits").insert(fallbackRow);
      if (fbErr) console.log(`[track-event] fallback insert error: ${fbErr.message}`);
      return NextResponse.json({ ok: !fbErr, fallback: true }, { status: 200 });
    }
    console.log(`[track-event] insert error: ${error.message}`);
  }

  return NextResponse.json({ ok: !error }, { status: 200 });
}
