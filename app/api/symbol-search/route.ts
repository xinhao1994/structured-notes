// Server route: /api/symbol-search?q=Western+Digital&market=US
//
// Resolves a free-form company name to its trading ticker via Finnhub's
// /api/v1/search endpoint. Used as a fallback when the parser couldn't
// confidently map a name to a ticker.
//
// Returns { symbol: string } on success or { symbol: null, candidates: [...] }
// when no confident match exists.

import { NextRequest, NextResponse } from "next/server";
import { MARKETS } from "@/lib/markets";
import type { MarketCode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface FinnhubSearchHit {
  symbol: string;
  description: string;
  displaySymbol?: string;
  type?: string;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const market = (req.nextUrl.searchParams.get("market") || "US") as MarketCode;
  if (!q) return NextResponse.json({ symbol: null, candidates: [] }, { status: 200 });

  const key = process.env.FINNHUB_API_KEY;
  if (!key) {
    return NextResponse.json({ symbol: null, candidates: [], error: "no_api_key" }, { status: 200 });
  }

  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${key}`,
      { next: { revalidate: 0 } }
    );
    if (!r.ok) {
      return NextResponse.json({ symbol: null, candidates: [], error: "upstream" }, { status: 200 });
    }
    const j = (await r.json()) as { result?: FinnhubSearchHit[] };
    const all = j.result ?? [];
    const suffix = MARKETS[market]?.finnhubSuffix ?? "";

    // Keep only common stock results in the requested market.
    const candidates = all.filter((h) => {
      if (h.type && !/common stock|adr|gdr/i.test(h.type)) return false;
      return market === "US"
        ? !h.symbol.includes(".") || /^[A-Z.]{1,8}$/.test(h.symbol)
        : h.symbol.endsWith(suffix);
    });

    if (!candidates.length) {
      return NextResponse.json({ symbol: null, candidates: [] }, { status: 200 });
    }

    // Heuristic: prefer the candidate whose description starts with the query.
    const lowered = q.toLowerCase();
    const ranked = candidates.sort((a, b) => {
      const aMatch = a.description?.toLowerCase().startsWith(lowered) ? 0 : 1;
      const bMatch = b.description?.toLowerCase().startsWith(lowered) ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      // Then by shorter ticker (avoid OTC ".PK" / ".OB" stuff)
      return a.symbol.length - b.symbol.length;
    });

    const best = ranked[0];
    // Strip the market suffix so we return the bare symbol the rest of the
    // app expects (e.g. "0700.HK" → "0700", "WDC" → "WDC").
    const bare = market === "US"
      ? best.symbol.split(".")[0]
      : best.symbol.replace(suffix, "");

    return new NextResponse(JSON.stringify({
      symbol: bare,
      description: best.description,
      candidates: ranked.slice(0, 5).map((c) => ({
        symbol: market === "US" ? c.symbol.split(".")[0] : c.symbol.replace(suffix, ""),
        description: c.description,
      })),
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, s-maxage=600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return NextResponse.json({ symbol: null, candidates: [], error: "exception" }, { status: 200 });
  }
}
