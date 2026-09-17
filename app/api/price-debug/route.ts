// Debug endpoint: shows what each price provider returns for a given symbol.
// Usage: /api/price-debug?symbol=WDC&market=US
// Remove this file once the price issue is diagnosed.

import { NextRequest, NextResponse } from "next/server";
import { MARKETS, isMarketOpen } from "@/lib/markets";
import type { MarketCode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function testYahoo(symbol: string, market: MarketCode) {
  const suffix: Record<string, string> = { US: "", HK: ".HK", SG: ".SI", JP: ".T", AU: ".AX", MY: ".KL" };
  const sym = market === "US" ? symbol : `${symbol}${suffix[market] ?? ""}`;
  const results: Record<string, unknown> = {};
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const r = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`, {
        headers: { "User-Agent": UA, "Accept": "application/json" },
        next: { revalidate: 0 },
      });
      if (!r.ok) { results[host] = `HTTP ${r.status}`; continue; }
      const j = await r.json();
      const meta = j?.chart?.result?.[0]?.meta;
      results[host] = { regularMarketPrice: meta?.regularMarketPrice, previousClose: meta?.previousClose, currency: meta?.currency };
    } catch (e: unknown) {
      results[host] = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return results;
}

async function testStooq(symbol: string, market: MarketCode) {
  const suffix: Record<string, string> = { US: ".us", HK: ".hk", JP: ".jp", AU: ".au", SG: ".sg", MY: ".kl" };
  const sym = `${symbol.toLowerCase()}${suffix[market] ?? ".us"}`;
  try {
    const r = await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=csv`, {
      headers: { "User-Agent": UA }, next: { revalidate: 0 },
    });
    if (!r.ok) return `HTTP ${r.status}`;
    const text = await r.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return `only header row: ${text.slice(0, 100)}`;
    const cols = lines[1].split(",");
    return { raw: lines[1], close: cols[6], parsed: parseFloat(cols[6]) };
  } catch (e: unknown) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function testFinnhub(symbol: string) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return "no key";
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${key}`);
    if (!r.ok) return `HTTP ${r.status}`;
    return await r.json();
  } catch (e: unknown) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function testPolygon(symbol: string) {
  const key = process.env.POLYGON_API_KEY;
  if (!key) return "no key";
  try {
    const r = await fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}?apiKey=${key}`, { next: { revalidate: 0 } });
    if (!r.ok) return `HTTP ${r.status}`;
    const j = await r.json();
    return { day_c: j?.ticker?.day?.c, prevDay_c: j?.ticker?.prevDay?.c, lastTrade: j?.ticker?.lastTrade?.p };
  } catch (e: unknown) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function testAlpha(symbol: string) {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return "no key";
  try {
    const r = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${key}`);
    if (!r.ok) return `HTTP ${r.status}`;
    const j = await r.json();
    return j?.["Global Quote"];
  } catch (e: unknown) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") || "WDC").toUpperCase();
  const market = (req.nextUrl.searchParams.get("market") || "US") as MarketCode;

  const [yahoo, stooq, finnhub, polygon, alpha] = await Promise.all([
    testYahoo(symbol, market),
    testStooq(symbol, market),
    testFinnhub(symbol),
    testPolygon(symbol),
    testAlpha(symbol),
  ]);

  return NextResponse.json({
    symbol, market,
    marketOpen: isMarketOpen(market).open,
    envKeys: {
      FINNHUB_API_KEY: !!process.env.FINNHUB_API_KEY,
      POLYGON_API_KEY: !!process.env.POLYGON_API_KEY,
      ALPHA_VANTAGE_API_KEY: !!process.env.ALPHA_VANTAGE_API_KEY,
    },
    providers: { yahoo, stooq, finnhub, polygon, alpha },
  }, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
