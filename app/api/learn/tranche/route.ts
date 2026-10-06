// POST /api/learn/tranche
// Records a parsed tranche into Supabase so SN Desk can learn from every
// paste. Called fire-and-forget by both the Desk tab and the Wayne tab.
//
// What we store:
//   - The full tranche structure (code, coupon, strike, KO, EKI, stepdown…)
//   - Every underlying symbol + market
//   - Which visitor pasted it (from snd_vid cookie)
//   - Which tab triggered the parse (desk / wayne)
//
// Downstream endpoints (/api/learn/popular) read tracked_stocks_v to show
// which stocks are trending across all users' parses. A weekly cron can
// refresh Wayne snapshots for the top N stocks via /api/cron/learn-refresh.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supa = getSupabaseAdmin();
  if (!supa) return NextResponse.json({ ok: false, reason: "no-supabase" });

  let body: any = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, reason: "bad-json" }); }

  const t = body?.tranche;
  if (!t || !Array.isArray(t.underlyings)) {
    return NextResponse.json({ ok: false, reason: "missing-tranche" });
  }

  const vid = req.cookies.get("snd_vid")?.value || null;
  const chatName = req.cookies.get("snd_name")?.value
    ? decodeURIComponent(req.cookies.get("snd_name")!.value)
    : null;

  const row = {
    tranche_code: t.trancheCode || null,
    visitor_id: vid,
    chat_name: chatName,
    issuer: t.issuer || null,
    currency: t.currency || null,
    coupon_pa: t.couponPa ?? null,
    tenor_months: t.tenorMonths ?? null,
    strike_pct: t.strikePct ?? null,
    ko_start_pct: t.koStartPct ?? null,
    ko_stepdown_pct: t.koStepdownPct ?? null,
    eki_pct: t.ekiPct ?? null,
    obs_freq_months: t.koObsFreqMonths ?? null,
    trade_date: t.tradeDate || null,
    settlement_date: t.settlementDate || null,
    underlyings: t.underlyings.map((u: any) => ({
      symbol: u.symbol,
      market: u.market,
      rawName: u.rawName || null,
    })),
    parse_source: body?.source === "wayne" ? "wayne" : "desk",
    raw_text: typeof body?.rawText === "string" ? body.rawText.slice(0, 10000) : null,
  };

  try {
    const { error } = await supa.from("parsed_tranches").insert(row);
    if (error) {
      // table missing / RLS problem → log + swallow (don't break the user flow)
      console.log(`[learn/tranche] insert error: ${error.message}`);
      return NextResponse.json({ ok: false, error: error.message });
    }
  } catch (e: any) {
    console.log(`[learn/tranche] insert threw: ${String(e?.message || e)}`);
    return NextResponse.json({ ok: false, error: String(e?.message || e) });
  }

  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
