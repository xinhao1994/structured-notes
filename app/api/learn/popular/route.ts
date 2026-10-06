// GET /api/learn/popular?limit=10&days=30
// Returns the stocks that have appeared in the most tranches across all
// users' recent parses. Powers the "Trending underlyings" display on the
// Wayne tab empty state and the "Also parsed in N tranches" badge on
// Analyze.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supa = getSupabaseAdmin();
  if (!supa) return NextResponse.json({ popular: [] });

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(50, Math.max(1, Number(sp.get("limit")) || 10));

  try {
    // Read the view; order by parse_count DESC, then unique_visitors DESC.
    const { data, error } = await supa
      .from("tracked_stocks_v")
      .select("symbol, market, parse_count, unique_visitors, last_parsed_at, raw_name_variants")
      .order("parse_count", { ascending: false })
      .order("unique_visitors", { ascending: false })
      .limit(limit);
    if (error) {
      console.log(`[learn/popular] view read error: ${error.message}`);
      return NextResponse.json({ popular: [], error: error.message });
    }
    return NextResponse.json(
      { popular: data ?? [] },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e: any) {
    console.log(`[learn/popular] threw: ${String(e?.message || e)}`);
    return NextResponse.json({ popular: [], error: String(e?.message || e) });
  }
}
