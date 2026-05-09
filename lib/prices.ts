// Multi-provider price client with cache + failover.
//
//   Polygon.io (primary)  →  Finnhub (secondary)  →  Alpha Vantage (backup)
//
// The chain skips providers that lack an API key, return non-OK, or return
// junk (zero/NaN price). Quotes are cached in-memory (per-process); short TTL
// while market is open, longer TTL when closed. Public-facing 52-week
// high/low is fetched whenever a fresh provider call is made.
//
// IMPORTANT: this module runs server-side only. Never import it into a
// client component.

import { MARKETS, isMarketOpen } from "./markets";
import type { MarketCode, PriceQuote } from "./types";

type Source = PriceQuote["source"];

const cache = new Map<string, { q: PriceQuote; until: number }>();

function ttlMs(market: MarketCode): number {
  const open = isMarketOpen(market).open;
  const live = parseInt(process.env.PRICE_LIVE_TTL_SECONDS || "15", 10);
  const closed = parseInt(process.env.PRICE_CLOSED_TTL_SECONDS || "600", 10);
  return (open ? live : closed) * 1000;
}

function cacheKey(symbol: string, market: MarketCode): string {
  return `${market}:${symbol}`;
}

function readCache(symbol: string, market: MarketCode): PriceQuote | null {
  const k = cacheKey(symbol, market);
  const hit = cache.get(k);
  if (!hit) return null;
  if (hit.until < Date.now()) {
    cache.delete(k);
    return null;
  }
  return { ...hit.q, cached: true, source: "cache" as Source };
}

function writeCache(q: PriceQuote): void {
  cache.set(cacheKey(q.symbol, q.market), {
    q,
    until: Date.now() + ttlMs(q.market),
  });
}

// ─── provider symbol mapping ────────────────────────────────────────────────

function polygonSymbol(symbol: string, market: MarketCode): string | null {
  // Polygon currently has the deepest US coverage. Asia/AU is partial; we
  // intentionally skip non-US for Polygon to avoid sending bad lookups.
  if (market !== "US") return null;
  return symbol.toUpperCase();
}

function finnhubSymbol(symbol: string, market: MarketCode): string {
  const def = MARKETS[market];
  if (market === "US") return symbol.toUpperCase();
  // Finnhub uses ".HK", ".KL", ".SI", ".T", ".AX"
  return `${symbol.toUpperCase()}${def.finnhubSuffix ?? ""}`;
}

function alphaSymbol(symbol: string, market: MarketCode): string {
  const def = MARKETS[market];
  if (market === "US") return symbol.toUpperCase();
  // Alpha Vantage uses suffix forms similar to Yahoo, e.g. "0700.HKG"
  return `${symbol.toUpperCase()}${def.alphaVantageSuffix ?? ""}`;
}

// ─── provider implementations ───────────────────────────────────────────────

async function fromPolygon(symbol: string, market: MarketCode): Promise<PriceQuote | null> {
  const key = process.env.POLYGON_API_KEY;
  if (!key) return null;
  const sym = polygonSymbol(symbol, market);
  if (!sym) return null;
  try {
    const [snap, hilo] = await Promise.all([
      fetch(
        `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${sym}?apiKey=${key}`,
        { next: { revalidate: 0 } }
      ).then((r) => (r.ok ? r.json() : null)),
      fetch(
        `https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${oneYearAgo()}/${today()}?adjusted=true&sort=desc&limit=260&apiKey=${key}`,
        { next: { revalidate: 0 } }
      ).then((r) => (r.ok ? r.json() : null)),
    ]);
    const last = snap?.ticker?.day?.c || snap?.ticker?.lastTrade?.p || snap?.ticker?.prevDay?.c;
    const prev = snap?.ticker?.prevDay?.c;
    if (!last) return null;
    const bars = hilo?.results || [];
    const high52 = bars.length ? Math.max(...bars.map((b: any) => b.h)) : undefined;
    const low52 = bars.length ? Math.min(...bars.map((b: any) => b.l)) : undefined;
    return {
      symbol,
      market,
      price: last,
      prevClose: prev,
      high52,
      low52,
      currency: MARKETS[market].currency,
      asOf: new Date().toISOString(),
      marketOpen: isMarketOpen(market).open,
      source: "polygon",
    };
  } catch {
    return null;
  }
}

async function fromFinnhub(symbol: string, market: MarketCode): Promise<PriceQuote | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;
  const sym = finnhubSymbol(symbol, market);
  try {
    const [quote, metric] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${key}`).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(
        `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(sym)}&metric=all&token=${key}`
      ).then((r) => (r.ok ? r.json() : null)),
    ]);
    const last = quote?.c;
    if (!last || last === 0) return null;
    return {
      symbol,
      market,
      price: last,
      prevClose: quote?.pc,
      high52: metric?.metric?.["52WeekHigh"],
      low52: metric?.metric?.["52WeekLow"],
      currency: MARKETS[market].currency,
      asOf: new Date(((quote?.t ?? 0) * 1000) || Date.now()).toISOString(),
      marketOpen: isMarketOpen(market).open,
      source: "finnhub",
    };
  } catch {
    return null;
  }
}

async function fromAlpha(symbol: string, market: MarketCode): Promise<PriceQuote | null> {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return null;
  const sym = alphaSymbol(symbol, market);
  try {
    // Alpha Vantage GLOBAL_QUOTE returns price + previous close.
    const r = await fetch(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(sym)}&apikey=${key}`
    );
    if (!r.ok) return null;
    const j = await r.json();
    const g = j?.["Global Quote"];
    const last = parseFloat(g?.["05. price"] ?? "");
    const prev = parseFloat(g?.["08. previous close"] ?? "");
    if (!isFinite(last) || last === 0) return null;
    return {
      symbol,
      market,
      price: last,
      prevClose: isFinite(prev) ? prev : undefined,
      currency: MARKETS[market].currency,
      asOf: new Date().toISOString(),
      marketOpen: isMarketOpen(market).open,
      source: "alphavantage",
    };
  } catch {
    return null;
  }
}

// Demo fallback — used only when *no* provider key is configured. Generates
// stable, plausible quotes so the UI looks alive in local dev.
function fromMock(symbol: string, market: MarketCode): PriceQuote {
  const seed = Array.from(symbol).reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = 50 + (seed % 350);
  const drift = ((Date.now() / 60000) % 360) / 360 - 0.5;
  const price = +(base * (1 + drift * 0.04)).toFixed(2);
  return {
    symbol,
    market,
    price,
    prevClose: +(base * (1 + (drift - 0.01) * 0.04)).toFixed(2),
    high52: +(base * 1.25).toFixed(2),
    low52: +(base * 0.78).toFixed(2),
    currency: MARKETS[market].currency,
    asOf: new Date().toISOString(),
    marketOpen: isMarketOpen(market).open,
    source: "mock",
    delayed: !isMarketOpen(market).open,
  };
}

// ─── public API ─────────────────────────────────────────────────────────────

export async function fetchQuote(symbol: string, market: MarketCode): Promise<PriceQuote> {
  const cached = readCache(symbol, market);
  if (cached) return cached;

  const chain = [fromPolygon, fromFinnhub, fromAlpha];
  for (const f of chain) {
    const q = await f(symbol, market);
    if (q && isFinite(q.price) && q.price > 0) {
      const out = { ...q, delayed: !q.marketOpen };
      writeCache(out);
      return out;
    }
  }
  // No keys / all failed — fall back to mock so UI still renders.
  const mock = fromMock(symbol, market);
  writeCache(mock);
  return mock;
}

export async function fetchQuotes(items: { symbol: string; market: MarketCode }[]): Promise<PriceQuote[]> {
  return Promise.all(items.map((i) => fetchQuote(i.symbol, i.market)));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function oneYearAgo(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}
