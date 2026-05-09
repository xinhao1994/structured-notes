// Server route: /api/historical-close?items=US:WDC@2026-04-15,US:SNDK@2026-04-15
//
// Returns the close on (or last business day before) the given date for each
// requested symbol. Used to fix the "initial fixing" of tranches whose trade
// date is in the past — we need the actual close on that day, not today's price.

import { NextRequest, NextResponse } from "next/server";
import { fetchHistoricalClose, type HistoricalClose } from "@/lib/prices";
import type { MarketCode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ParsedItem {
  market: MarketCode;
  symbol: string;
  date: string;
}

function parseItems(s: string | null): ParsedItem[] {
  if (!s) return [];
  return s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      // Format: "MARKET:SYMBOL@YYYY-MM-DD"
      const [head, date] = p.split("@");
      const [m, sym] = head.split(":");
      return { market: (m as MarketCode) || "US", symbol: sym, date };
    })
    .filter((x) => x.symbol && /^\d{4}-\d{2}-\d{2}$/.test(x.date));
}

export async function GET(req: NextRequest) {
  const items = parseItems(req.nextUrl.searchParams.get("items"));
  if (!items.length) {
    return NextResponse.json({ closes: [] }, { status: 200 });
  }

  // Run in parallel — the underlying client de-duplicates and caches.
  const results = await Promise.all(
    items.map(async (it) => {
      const r = await fetchHistoricalClose(it.symbol, it.market, it.date);
      return r ?? {
        symbol: it.symbol,
        market: it.market,
        requestedDate: it.date,
        effectiveDate: null as string | null,
        close: null as number | null,
        source: null as string | null,
      } as Partial<HistoricalClose> & { close: number | null };
    })
  );

  return new NextResponse(JSON.stringify({ closes: results }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      // Historical closes don't change — cache hard at the edge.
      "cache-control": "public, s-maxage=86400, stale-while-revalidate=2592000, immutable",
    },
  });
}
