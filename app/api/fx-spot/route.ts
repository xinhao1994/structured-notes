// GET /api/fx-spot
// Returns live spot rates vs MYR for all currencies used by the Wealth
// Financing tool. Uses Yahoo Finance's unauthenticated chart v8 endpoint
// (ticker format `${CCY}MYR=X`, e.g. CHFMYR=X). Results are cached in
// the serverless function's memory for 5 minutes so repeat polls don't
// hammer Yahoo.
//
// Response shape:
//   { rates: { USD: 4.22, AUD: 2.81, ... }, fetchedAt: "2026-10-18T...",
//     fresh: true|false, source: "yahoo"|"fallback", errors?: {...} }

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CURRENCIES = ["USD", "AUD", "NZD", "GBP", "EUR", "CHF", "CAD", "JPY", "SGD", "HKD"] as const;

// Hardcoded fallback (approx mid-market 16 Oct 2026). If Yahoo refuses or
// a specific pair fails, the fallback keeps the WF tool working.
const FALLBACK: Record<string, number> = {
  USD: 4.200, AUD: 2.800, NZD: 2.500, GBP: 5.600, EUR: 4.700,
  CHF: 5.000, CAD: 3.100, JPY: 0.028, SGD: 3.200, HKD: 0.540,
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

interface CacheEntry { rates: Record<string, number>; fetchedAt: string; }
let MEM_CACHE: CacheEntry | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

async function fetchYahooFx(ccy: string): Promise<number | null> {
  const sym = `${ccy}MYR=X`;
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  for (const host of hosts) {
    try {
      const r = await fetch(
        `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`,
        { headers: { "User-Agent": UA, Accept: "application/json" }, next: { revalidate: 0 } },
      );
      if (!r.ok) continue;
      const j = await r.json();
      const meta = j?.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice;
      if (typeof price === "number" && Number.isFinite(price) && price > 0) {
        return price;
      }
    } catch { /* try next host */ }
  }
  return null;
}

export async function GET(_req: NextRequest) {
  // Serve from memory cache if fresh
  if (MEM_CACHE && Date.now() - Date.parse(MEM_CACHE.fetchedAt) < CACHE_TTL_MS) {
    return NextResponse.json({
      rates: MEM_CACHE.rates,
      fetchedAt: MEM_CACHE.fetchedAt,
      fresh: true, source: "cache",
    }, { headers: { "cache-control": "no-store" } });
  }

  // Fetch all currencies in parallel
  const settled = await Promise.allSettled(CURRENCIES.map((c) => fetchYahooFx(c)));
  const rates: Record<string, number> = {};
  const errors: Record<string, string> = {};
  CURRENCIES.forEach((c, i) => {
    const res = settled[i];
    if (res.status === "fulfilled" && typeof res.value === "number") {
      rates[c] = Number(res.value.toFixed(5));
    } else {
      rates[c] = FALLBACK[c];
      errors[c] = "yahoo-missed-using-fallback";
    }
  });

  const fetchedAt = new Date().toISOString();
  MEM_CACHE = { rates, fetchedAt };

  return NextResponse.json({
    rates, fetchedAt, fresh: true,
    source: Object.keys(errors).length === CURRENCIES.length ? "fallback" : "yahoo",
    ...(Object.keys(errors).length ? { errors } : {}),
  }, { headers: { "cache-control": "no-store" } });
}
