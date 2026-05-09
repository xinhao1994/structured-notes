// Server route: /api/prices?items=US:TSM,US:AVGO,HK:0700
//
// Returns: { quotes: PriceQuote[] }
//
// Server-side only — keeps API keys out of the browser. Cache headers ensure
// CDNs and the service worker don't over-cache during open hours.

import { NextRequest, NextResponse } from "next/server";
import { fetchQuotes } from "@/lib/prices";
import { isMarketOpen } from "@/lib/markets";
import type { MarketCode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseItems(s: string | null): { symbol: string; market: MarketCode }[] {
  if (!s) return [];
  return s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [m, sym] = p.split(":");
      return { symbol: sym, market: (m as MarketCode) || "US" };
    })
    .filter((x) => x.symbol);
}

export async function GET(req: NextRequest) {
  const items = parseItems(req.nextUrl.searchParams.get("items"));
  if (!items.length) {
    return NextResponse.json({ quotes: [] }, { status: 200 });
  }
  const quotes = await fetchQuotes(items);

  // Pick the shortest TTL across the requested markets so the freshest
  // open-market dictates cache lifetime.
  const anyOpen = items.some((i) => isMarketOpen(i.market).open);
  const sMaxAge = anyOpen ? 10 : 60;

  return new NextResponse(JSON.stringify({ quotes }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": `public, s-maxage=${sMaxAge}, stale-while-revalidate=60`,
    },
  });
}
