// Multi-provider price client with cache + failover.
//   Polygon.io (primary) → Finnhub (secondary) → Alpha Vantage (backup)
// Server-side only.

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
  if (hit.until < Date.now()) { cache.delete(k); return null; }
  return { ...hit.q, cached: true, source: "cache" as Source };
}
function writeCache(q: PriceQuote): void {
  cache.set(cacheKey(q.symbol, q.market), { q, until: Date.now() + ttlMs(q.market) });
}

// ─── provider symbol mapping ────────────────────────────────────────────────
function polygonSymbol(symbol: string, market: MarketCode): string | null {
  if (market !== "US") return null;
  return symbol.toUpperCase();
}
function finnhubSymbol(symbol: string, market: MarketCode): string {
  const def = MARKETS[market];
  if (market === "US") return symbol.toUpperCase();
  return `${symbol.toUpperCase()}${def.finnhubSuffix ?? ""}`;
}
function alphaSymbol(symbol: string, market: MarketCode): string {
  const def = MARKETS[market];
  if (market === "US") return symbol.toUpperCase();
  return `${symbol.toUpperCase()}${def.alphaVantageSuffix ?? ""}`;
}

// ─── live quote providers ───────────────────────────────────────────────────
async function fromPolygon(symbol: string, market: MarketCode): Promise<PriceQuote | null> {
  const key = process.env.POLYGON_API_KEY;
  if (!key) return null;
  const sym = polygonSymbol(symbol, market);
  if (!sym) return null;
  try {
    const [snap, hilo] = await Promise.all([
      fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${sym}?apiKey=${key}`,
        { next: { revalidate: 0 } }).then((r) => (r.ok ? r.json() : null)),
      fetch(`https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${oneYearAgo()}/${today()}?adjusted=true&sort=desc&limit=260&apiKey=${key}`,
        { next: { revalidate: 0 } }).then((r) => (r.ok ? r.json() : null)),
    ]);
    const last = snap?.ticker?.day?.c || snap?.ticker?.lastTrade?.p || snap?.ticker?.prevDay?.c;
    const prev = snap?.ticker?.prevDay?.c;
    if (!last) return null;
    const bars = hilo?.results || [];
    const high52 = bars.length ? Math.max(...bars.map((b: any) => b.h)) : undefined;
    const low52 = bars.length ? Math.min(...bars.map((b: any) => b.l)) : undefined;
    return {
      symbol, market, price: last, prevClose: prev, high52, low52,
      currency: MARKETS[market].currency,
      asOf: new Date().toISOString(),
      marketOpen: isMarketOpen(market).open,
      source: "polygon",
    };
  } catch { return null; }
}

async function fromFinnhub(symbol: string, market: MarketCode): Promise<PriceQuote | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;
  const sym = finnhubSymbol(symbol, market);
  try {
    const [quote, metric] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${key}`).then((r) => r.ok ? r.json() : null),
      fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(sym)}&metric=all&token=${key}`).then((r) => r.ok ? r.json() : null),
    ]);
    const last = quote?.c;
    if (!last || last === 0) return null;
    return {
      symbol, market, price: last, prevClose: quote?.pc,
      high52: metric?.metric?.["52WeekHigh"],
      low52: metric?.metric?.["52WeekLow"],
      currency: MARKETS[market].currency,
      asOf: new Date(((quote?.t ?? 0) * 1000) || Date.now()).toISOString(),
      marketOpen: isMarketOpen(market).open,
      source: "finnhub",
    };
  } catch { return null; }
}

async function fromAlpha(symbol: string, market: MarketCode): Promise<PriceQuote | null> {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return null;
  const sym = alphaSymbol(symbol, market);
  try {
    const r = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(sym)}&apikey=${key}`);
    if (!r.ok) return null;
    const j = await r.json();
    const g = j?.["Global Quote"];
    const last = parseFloat(g?.["05. price"] ?? "");
    const prev = parseFloat(g?.["08. previous close"] ?? "");
    if (!isFinite(last) || last === 0) return null;
    return {
      symbol, market, price: last,
      prevClose: isFinite(prev) ? prev : undefined,
      currency: MARKETS[market].currency,
      asOf: new Date().toISOString(),
      marketOpen: isMarketOpen(market).open,
      source: "alphavantage",
    };
  } catch { return null; }
}

function fromMock(symbol: string, market: MarketCode): PriceQuote {
  const seed = Array.from(symbol).reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = 50 + (seed % 350);
  const drift = ((Date.now() / 60000) % 360) / 360 - 0.5;
  const price = +(base * (1 + drift * 0.04)).toFixed(2);
  return {
    symbol, market, price,
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

// ─── public API: live quotes ────────────────────────────────────────────────
export async function fetchQuote(symbol: string, market: MarketCode): Promise<PriceQuote> {
  const cached = readCache(symbol, market);
  if (cached) return cached;
  for (const f of [fromPolygon, fromFinnhub, fromAlpha]) {
    const q = await f(symbol, market);
    if (q && isFinite(q.price) && q.price > 0) {
      const out = { ...q, delayed: !q.marketOpen };
      writeCache(out);
      return out;
    }
  }
  const mock = fromMock(symbol, market);
  writeCache(mock);
  return mock;
}
export async function fetchQuotes(items: { symbol: string; market: MarketCode }[]): Promise<PriceQuote[]> {
  return Promise.all(items.map((i) => fetchQuote(i.symbol, i.market)));
}

// ─── historical close (for the trade-date initial fixing) ───────────────────
export interface HistoricalClose {
  symbol: string;
  market: MarketCode;
  requestedDate: string;
  effectiveDate: string;
  close: number;
  source: "polygon" | "finnhub" | "alphavantage";
}
const histCache = new Map<string, HistoricalClose>();
function histKey(symbol: string, market: MarketCode, date: string) {
  return `${market}:${symbol}:${date}`;
}

export async function fetchHistoricalClose(
  symbol: string, market: MarketCode, date: string
): Promise<HistoricalClose | null> {
  const k = histKey(symbol, market, date);
  const hit = histCache.get(k);
  if (hit) return hit;
  for (const f of [polygonHist, finnhubHist, alphaHist]) {
    const r = await f(symbol, market, date);
    if (r && isFinite(r.close) && r.close > 0) {
      histCache.set(k, r);
      return r;
    }
  }
  return null;
}

async function polygonHist(symbol: string, market: MarketCode, date: string): Promise<HistoricalClose | null> {
  const key = process.env.POLYGON_API_KEY;
  if (!key) return null;
  const sym = polygonSymbol(symbol, market);
  if (!sym) return null;
  const start = isoMinusDays(date, 10);
  try {
    const r = await fetch(`https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${start}/${date}?adjusted=true&sort=desc&limit=10&apiKey=${key}`);
    if (!r.ok) return null;
    const j = await r.json();
    const bars = j?.results || [];
    for (const b of bars) {
      const eff = new Date(b.t).toISOString().slice(0, 10);
      if (eff <= date) return { symbol, market, requestedDate: date, effectiveDate: eff, close: b.c, source: "polygon" };
    }
    return null;
  } catch { return null; }
}

async function finnhubHist(symbol: string, market: MarketCode, date: string): Promise<HistoricalClose | null> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return null;
  const sym = finnhubSymbol(symbol, market);
  const target = new Date(date + "T00:00:00Z").getTime();
  const from = Math.floor((target - 10 * 86_400_000) / 1000);
  const to = Math.floor((target + 86_400_000) / 1000);
  try {
    const r = await fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(sym)}&resolution=D&from=${from}&to=${to}&token=${key}`);
    if (!r.ok) return null;
    const j = await r.json();
    if (j?.s !== "ok" || !Array.isArray(j.c) || !j.c.length) return null;
    for (let i = j.t.length - 1; i >= 0; i--) {
      const eff = new Date(j.t[i] * 1000).toISOString().slice(0, 10);
      if (eff <= date) return { symbol, market, requestedDate: date, effectiveDate: eff, close: j.c[i], source: "finnhub" };
    }
    return null;
  } catch { return null; }
}

async function alphaHist(symbol: string, market: MarketCode, date: string): Promise<HistoricalClose | null> {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return null;
  const sym = alphaSymbol(symbol, market);
  const monthsAgo = (Date.now() - new Date(date + "T00:00:00Z").getTime()) / (30 * 86_400_000);
  const size = monthsAgo > 3 ? "full" : "compact";
  try {
    const r = await fetch(`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(sym)}&outputsize=${size}&apikey=${key}`);
    if (!r.ok) return null;
    const j = await r.json();
    const series = j?.["Time Series (Daily)"];
    if (!series) return null;
    const dates = Object.keys(series).sort().reverse();
    for (const d of dates) {
      if (d <= date) {
        const close = parseFloat(series[d]["4. close"]);
        if (isFinite(close) && close > 0) return { symbol, market, requestedDate: date, effectiveDate: d, close, source: "alphavantage" };
      }
    }
    return null;
  } catch { return null; }
}

function isoMinusDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function today(): string { return new Date().toISOString().slice(0, 10); }
function oneYearAgo(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}
