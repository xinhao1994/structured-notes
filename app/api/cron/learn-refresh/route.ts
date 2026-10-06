// GET /api/cron/learn-refresh?token=<CRON_TOKEN>
// Weekly refresh job: pre-computes Wayne analysis + stock-profile snapshots
// for the top-N most-parsed stocks and caches them in tracked_stocks_cache.
//
// Set up on Vercel either as a Vercel Cron (vercel.json) or by hitting the
// URL from any scheduler. The token guard prevents random hits.
//
//   Schedule example (vercel.json):
//   { "crons": [{ "path": "/api/cron/learn-refresh?token=<CRON_TOKEN>", "schedule": "0 2 * * 1" }] }
//                                                                        └ Monday 02:00 UTC

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // give it headroom for the sequential fetches

const TOP_N_DEFAULT = 25;

export async function GET(req: NextRequest) {
  // Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when
  // CRON_SECRET env is set. Also accept ?token= (handy for manual trigger).
  const cronSecret = process.env.CRON_SECRET;
  const adminToken = process.env.CRON_TOKEN || process.env.ADMIN_TOKEN;
  const authHeader = req.headers.get("authorization") || "";
  const bearerOk = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const tokenParam = req.nextUrl.searchParams.get("token") || req.headers.get("x-cron-token") || "";
  const tokenOk = adminToken && tokenParam === adminToken;
  if (!bearerOk && !tokenOk) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supa = getSupabaseAdmin();
  if (!supa) return NextResponse.json({ error: "no supabase" }, { status: 500 });

  const limit = Math.min(100, Number(req.nextUrl.searchParams.get("limit")) || TOP_N_DEFAULT);
  const origin = req.nextUrl.origin;

  // 1. Pull top-N stocks from the aggregated view
  const { data: top, error: topErr } = await supa
    .from("tracked_stocks_v")
    .select("symbol, market, parse_count")
    .order("parse_count", { ascending: false })
    .limit(limit);
  if (topErr) {
    return NextResponse.json({ error: `view read: ${topErr.message}` }, { status: 500 });
  }
  if (!top || top.length === 0) {
    return NextResponse.json({ refreshed: 0, note: "no tracked stocks yet" });
  }

  // 2. For each, fetch Wayne + stock-profile in sequence (gentle on providers)
  const results: Array<{ symbol: string; market: string; status: "ok" | "fail"; reason?: string }> = [];
  for (const row of top) {
    try {
      const [profileRes, wayneRes] = await Promise.all([
        fetch(`${origin}/api/stock-profile?symbol=${encodeURIComponent(row.symbol)}&market=${row.market}`, { cache: "no-store" }),
        fetch(`${origin}/api/wayne/analyze?symbol=${encodeURIComponent(row.symbol)}&market=${row.market}`, { cache: "no-store" }),
      ]);
      const stock_profile_snapshot = profileRes.ok ? await profileRes.json() : null;
      const wayne_snapshot = wayneRes.ok ? await wayneRes.json() : null;

      if (!stock_profile_snapshot && !wayne_snapshot) {
        results.push({ symbol: row.symbol, market: row.market, status: "fail", reason: "both-fetches-failed" });
        continue;
      }

      const { error: upErr } = await supa.from("tracked_stocks_cache").upsert({
        symbol: row.symbol,
        market: row.market,
        wayne_snapshot,
        stock_profile_snapshot,
        refreshed_at: new Date().toISOString(),
      }, { onConflict: "symbol,market" });
      if (upErr) {
        results.push({ symbol: row.symbol, market: row.market, status: "fail", reason: upErr.message });
      } else {
        results.push({ symbol: row.symbol, market: row.market, status: "ok" });
      }
    } catch (e: any) {
      results.push({ symbol: row.symbol, market: row.market, status: "fail", reason: String(e?.message || e) });
    }
  }

  const refreshed = results.filter((r) => r.status === "ok").length;
  return NextResponse.json({
    refreshed,
    total: top.length,
    at: new Date().toISOString(),
    detail: results,
  }, { headers: { "cache-control": "no-store" } });
}
