// Server route: /api/trade-close?items=US:WDC@2026-05-08,US:AAPL@2026-05-08
// Returns the close on (or last business day before) the given date.

import { NextRequest, NextResponse } from "next/server";
import { fetchHistoricalClose } from "@/lib/prices";
import type { MarketCode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseItems(s: string | null) {
  if (!s) return [];
  return s.split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
    const [head, date] = p.split("@");
    const [m, sym] = (head || "").split(":");
    return { market: (m as MarketCode) || "US", symbol: sym, date };
  }).filter((x) => x.symbol && /^\d{4}-\d{2}-\d{2}$/.test(x.date));
}

export async function GET(req: NextRequest) {
  const items = parseItems(req.nextUrl.searchParams.get("items"));
  if (!items.length) return NextResponse.json({ closes: [] }, { status: 200 });
  const results = await Promise.all(items.map(async (it) => {
    const r = await fetchHistoricalClose(it.symbol, it.market, it.date);
    return r ?? {
      symbol: it.symbol, market: it.market, requestedDate: it.date,
      effectiveDate: null, close: null, source: null,
    };
  }));
  // Only cache long-term when every result's effectiveDate exactly matches the
  // requested date. If any result returned the previous business day's close
  // (because the requested date's market hadn't closed yet when first fetched),
  // use a very short cache so the correct close can be picked up once available.
  const allExact = results.every(
    (r) => r.effectiveDate != null && r.effectiveDate === r.requestedDate
  );
  return new NextResponse(JSON.stringify({ closes: results }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": allExact
        ? "public, s-maxage=86400, stale-while-revalidate=2592000, immutable"
        : "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
