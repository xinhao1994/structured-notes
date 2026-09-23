// Multi-provider price client with cache + failover.
//
// Order per market:
//   US:    Polygon → Finnhub → Yahoo → Alpha Vantage → mock
//   HK/SG/JP/AU/MY:  Yahoo (free, accurate) → Finnhub (paid HK) → Alpha Vantage → mock
//
// Yahoo Finance is critical for HK because Finnhub's free tier doesn't
// reliably return HKEX quotes. Yahoo is free, no key required, and accurate.
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
function cacheKey(symbol: string, market: MarketCode): string { return `${market}:${symbol}`; }
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

// ─── symbol formatters ──────────────────────────────────────────────────────
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
function stooqSymbol(symbol: string, market: MarketCode): string {
  const suffix: Record<MarketCode, string> = { US: ".us", HK: ".hk", JP: ".jp", AU: ".au", SG: ".sg", MY: ".kl" };
  return `${symbol.toLowerCase()}${suffix[market]}`;
}

/**
 * Stooq — free, no API key, CSV endpoint. Independent of Yahoo, so it
 * serves as a sanity-check / fallback when Yahoo is unreachable or quirky.
 * Endpoint: stooq.com/q/l/?s={symbol}&f=sd2t2ohlcv&h&e=csv
 */
async function fromStooq(symbol: string, market: MarketCode): Promise<PriceQuote | null> {
  const sym = stooqSymbol(symbol, market);
  try {
    const r = await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=csv`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" },
      next: { revalidate: 0 },
    });
    if (!r.ok) return null;
    const text = await r.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return null;
    const cols = lines[1].split(",");
    if (cols.length < 7) return null;
    const close = parseFloat(cols[6]);
    if (!isFinite(close) || close === 0) return null;
    return {
      symbol, market, price: close,
      currency: MARKETS[market].currency,
      asOf: new Date().toISOString(),
      marketOpen: isMarketOpen(market).open,
      source: "stooq",
    };
  } catch { return null; }
}

function yahooSymbol(symbol: string, market: MarketCode): string {
  if (market === "US") return symbol.toUpperCase();
  // Yahoo conventions: HK -> .HK, SG -> .SI, JP -> .T, AU -> .AX, MY -> .KL
  const suffix: Record<MarketCode, string> = { US: "", HK: ".HK", SG: ".SI", JP: ".T", AU: ".AX", MY: ".KL" };
  let base = symbol.toUpperCase();
  // HK 4-digit codes work as-is for Yahoo (e.g. 0700.HK, 9988.HK).
  return `${base}${suffix[market]}`;
}

// ─── provider implementations ───────────────────────────────────────────────
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

const YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/**
 * Yahoo Finance v7 quote API — queries the live quote system directly.
 * More reliable than the chart endpoint for recent corporate actions (reverse
 * splits, spin-offs) because it doesn't rely on historical chart metadata
 * which can lag by several days after an ex-date adjustment.
 */
async function fromYahooQuote(symbol: string, market: MarketCode): Promise<PriceQuote | null> {
  const sym = yahooSymbol(symbol, market);
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const r = await fetch(
        `https://${host}/v7/finance/quote?symbols=${encodeURIComponent(sym)}&fields=regularMarketPrice,regularMarketPreviousClose,fiftyTwoWeekHigh,fiftyTwoWeekLow,currency,regularMarketTime`,
        {
          headers: { "User-Agent": YAHOO_UA, "Accept": "application/json" },
          next: { revalidate: 0 },
        }
      );
      if (!r.ok) continue;
      const j = await r.json();
      const q = j?.quoteResponse?.result?.[0];
      if (!q) continue;
      const last = q.regularMarketPrice;
      if (!last || !isFinite(last)) continue;
      return {
        symbol, market, price: last,
        prevClose: isFinite(q.regularMarketPreviousClose) ? q.regularMarketPreviousClose : undefined,
        high52: isFinite(q.fiftyTwoWeekHigh) ? q.fiftyTwoWeekHigh : undefined,
        low52: isFinite(q.fiftyTwoWeekLow) ? q.fiftyTwoWeekLow : undefined,
        currency: q.currency ?? MARKETS[market].currency,
        asOf: new Date(((q.regularMarketTime ?? 0) * 1000) || Date.now()).toISOString(),
        marketOpen: isMarketOpen(market).open,
        source: "yahoo",
      };
    } catch { continue; }
  }
  return null;
}

/**
 * Yahoo Finance v10 quoteSummary — middle-ground between v7 (auth-gated) and
 * v8 chart (stale meta after spin-offs). Uses modules=price which returns the
 * live regularMarketPrice separate from the chart metadata.
 */
async function fromYahooSummary(symbol: string, market: MarketCode): Promise<PriceQuote | null> {
  const sym = yahooSymbol(symbol, market);
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const r = await fetch(
        `https://${host}/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=price&formatted=false`,
        { headers: { "User-Agent": YAHOO_UA, "Accept": "application/json" }, next: { revalidate: 0 } }
      );
      if (!r.ok) continue;
      const j = await r.json();
      const p = j?.quoteSummary?.result?.[0]?.price;
      if (!p) continue;
      const raw = (v: unknown) =>
        v != null && typeof v === "object" && "raw" in (v as object)
          ? (v as { raw: number }).raw
          : (v as number);
      const last = raw(p.regularMarketPrice);
      if (!last || !isFinite(last)) continue;
      const prev = raw(p.regularMarketPreviousClose);
      const high52 = raw(p.fiftyTwoWeekHigh);
      const low52 = raw(p.fiftyTwoWeekLow);
      const t = raw(p.regularMarketTime);
      return {
        symbol, market, price: last,
        prevClose: isFinite(prev) ? prev : undefined,
        high52: isFinite(high52) ? high52 : undefined,
        low52: isFinite(low52) ? low52 : undefined,
        currency: p.currency ?? MARKETS[market].currency,
        asOf: new Date(((t ?? 0) * 1000) || Date.now()).toISOString(),
        marketOpen: isMarketOpen(market).open,
        source: "yahoo",
      };
    } catch { continue; }
  }
  return null;
}

/**
 * Yahoo Finance v8 chart API — last resort. Uses the time-series close data
 * rather than meta.regularMarketPrice, which can be stale after corporate
 * actions (spin-offs, reverse splits). The actual daily close series reflects
 * real trading prices even when chart metadata lags.
 */
async function fromYahooChart(symbol: string, market: MarketCode): Promise<PriceQuote | null> {
  const sym = yahooSymbol(symbol, market);
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const r = await fetch(
        `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`,
        {
          headers: { "User-Agent": YAHOO_UA, "Accept": "application/json" },
          next: { revalidate: 0 },
        }
      );
      if (!r.ok) continue;
      const j = await r.json();
      const result = j?.chart?.result?.[0];
      if (!result) continue;
      const meta = result.meta;

      // Prefer the last actual close from the time-series over meta.regularMarketPrice.
      // meta can be stale after spin-offs / reverse splits (e.g. WDC shows $93 when
      // real price is $417 because chart metadata wasn't updated post-spin-off).
      const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
      const seriesLast = closes.slice().reverse().find((c): c is number => c != null && isFinite(c));
      const metaPrice: number | undefined = meta?.regularMarketPrice;

      // If meta and series diverge >20%, the meta is almost certainly stale — use series.
      const last = (() => {
        if (seriesLast && metaPrice && isFinite(metaPrice)) {
          const ratio = metaPrice / seriesLast;
          return ratio < 0.8 || ratio > 1.25 ? seriesLast : metaPrice;
        }
        return seriesLast ?? metaPrice;
      })();

      if (!last || !isFinite(last)) continue;
      const prev = meta?.previousClose ?? meta?.chartPreviousClose;
      const high52 = meta?.fiftyTwoWeekHigh;
      const low52 = meta?.fiftyTwoWeekLow;
      return {
        symbol, market, price: last,
        prevClose: isFinite(prev) ? prev : undefined,
        high52: isFinite(high52) ? high52 : undefined,
        low52: isFinite(low52) ? low52 : undefined,
        currency: meta?.currency ?? MARKETS[market].currency,
        asOf: new Date((meta?.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
        marketOpen: isMarketOpen(market).open,
        source: "yahoo",
      };
    } catch { continue; }
  }
  return null;
}

async function fromYahoo(symbol: string, market: MarketCode): Promise<PriceQuote | null> {
  // v7 quote API first — live quote system, most current after corporate actions.
  const q = await fromYahooQuote(symbol, market);
  if (q) return q;
  // v10 quoteSummary — separate from chart metadata, avoids stale spin-off prices.
  const s = await fromYahooSummary(symbol, market);
  if (s) return s;
  // v8 chart — last resort; reads time-series close instead of stale chart meta.
  return fromYahooChart(symbol, market);
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

// ─── public API ─────────────────────────────────────────────────────────────
function chainForMarket(market: MarketCode) {
  // For non-US markets we trust Yahoo first because Finnhub free tier doesn't
  // reliably cover HKEX/SGX/TSE/ASX/KLSE.
  // Yahoo Finance has the most reliable free coverage across ALL markets,
  // so it goes first. Polygon and Finnhub are layered on top for US (paid
  // tiers if available). Alpha Vantage is last because of its 25/day limit.
  // Yahoo is primary (most accurate, no key). Stooq is a free independent
  // cross-check. Polygon/Finnhub/AlphaVantage layer in if keys are present.
  // Stooq is last for US — it's free but can lag on corporate actions (splits,
  // spin-offs) and return stale prices. Paid providers (Polygon/Finnhub) and
  // Alpha Vantage are preferred before falling back to Stooq.
  return market === "US"
    ? [fromYahoo, fromPolygon, fromFinnhub, fromAlpha, fromStooq]
    : [fromYahoo, fromStooq, fromFinnhub, fromAlpha];
}

export async function fetchQuote(symbol: string, market: MarketCode): Promise<PriceQuote | null> {
  const cached = readCache(symbol, market);
  if (cached) return cached;
  for (const f of chainForMarket(market)) {
    const q = await f(symbol, market);
    if (q && isFinite(q.price) && q.price > 0) {
      const out = { ...q, delayed: !q.marketOpen };
      writeCache(out);
      return out;
    }
  }
  // Every real provider failed. We DO NOT fall back to mock data — that
  // would hide the problem behind a plausible-looking fake number. Return
  // null so the UI can show "Price unavailable" and the user knows to
  // verify the ticker (most common cause: misspelling like "NVDIA" → NVDA).
  return null;
}

export async function fetchQuotes(items: { symbol: string; market: MarketCode }[]): Promise<PriceQuote[]> {
  const all = await Promise.all(items.map((i) => fetchQuote(i.symbol, i.market)));
  return all.filter((q): q is PriceQuote => q !== null);
}

function today(): string { return new Date().toISOString().slice(0, 10); }
function oneYearAgo(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

// ─── historical close (for past trade-date initial fixing) ─────────────────
export interface HistoricalClose {
  symbol: string;
  market: MarketCode;
  requestedDate: string;
  effectiveDate: string;
  close: number;
  source: "yahoo" | "stooq" | "alphavantage";
}

const histCache = new Map<string, HistoricalClose>();
function histKey(s: string, m: MarketCode, d: string) { return `${m}:${s}:${d}`; }

/**
 * Yahoo chart endpoint with explicit period1/period2 — pulls daily closes
 * around the target date and returns the close on (or just before) it.
 */
async function yahooHist(symbol: string, market: MarketCode, date: string): Promise<HistoricalClose | null> {
  const sym = yahooSymbol(symbol, market);
  const target = new Date(date + "T00:00:00Z").getTime();
  // Pull 14 days before and 3 days after — covers weekend/holiday snap-back.
  const period1 = Math.floor((target - 14 * 86_400_000) / 1000);
  const period2 = Math.floor((target + 3 * 86_400_000) / 1000);
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

  // Track the best fallback across hosts (older bar with valid close). Only
  // use it if we can't find the exact-date bar via any host or via v7 quote.
  let fallback: HistoricalClose | null = null;

  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const r = await fetch(
        `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?period1=${period1}&period2=${period2}&interval=1d`,
        { headers: { "User-Agent": UA, "Accept": "application/json" }, next: { revalidate: 0 } }
      );
      if (!r.ok) continue;
      const j = await r.json();
      const result = j?.chart?.result?.[0];
      if (!result) continue;
      const timestamps: number[] = result.timestamp || [];
      const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
      // Walk newest → oldest. Prefer the exact-date bar. Remember the newest
      // valid older bar as fallback in case no exact match exists.
      for (let i = timestamps.length - 1; i >= 0; i--) {
        const eff = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
        if (eff <= date && closes[i] != null && isFinite(closes[i]!)) {
          if (eff === date) {
            return { symbol, market, requestedDate: date, effectiveDate: eff, close: closes[i]!, source: "yahoo" };
          }
          if (!fallback) {
            fallback = { symbol, market, requestedDate: date, effectiveDate: eff, close: closes[i]!, source: "yahoo" };
          }
        }
      }
    } catch { continue; }
  }

  // Chart endpoint didn't have the exact-date bar (or its close was null
  // during a market-transition glitch). Try Yahoo v7 quote — two useful
  // signals depending on where "now" sits relative to the requested date:
  //
  //   Scenario A (curDate === requestedDate, market currently CLOSED):
  //     The last completed session on Yahoo's clock is the requested date
  //     itself. regularMarketPrice is the LAST TRADED PRICE of that session,
  //     which = the requested date's close. e.g. Malaysia afternoon Sept 23
  //     asking for Sept 22 close → Yahoo's session is still Sept 22 (US pre-
  //     market Sept 23 hasn't happened), regularMarketPrice = Sept 22 close.
  //
  //   Scenario B (curDate > requestedDate):
  //     Yahoo has moved on to a later session. regularMarketPreviousClose is
  //     the previous session's close, which = the requested date's close.
  //     e.g. Malaysia evening Sept 23 during US market open → curDate =
  //     Sept 23, requested = Sept 22, previousClose = Sept 22.
  const marketOpenNow = isMarketOpen(market).open;
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const r = await fetch(
        `https://${host}/v7/finance/quote?symbols=${encodeURIComponent(sym)}&fields=regularMarketPrice,regularMarketPreviousClose,regularMarketTime`,
        { headers: { "User-Agent": UA, "Accept": "application/json" }, next: { revalidate: 0 } }
      );
      if (!r.ok) continue;
      const j = await r.json();
      const q = j?.quoteResponse?.result?.[0];
      const price = q?.regularMarketPrice;
      const prevClose = q?.regularMarketPreviousClose;
      const curTs = q?.regularMarketTime;
      if (!curTs) continue;
      const curDate = new Date(curTs * 1000).toISOString().slice(0, 10);

      // Scenario B — session has moved past the requested date. previousClose
      // holds the requested date's close (or the last trading day at/before
      // the requested date if the request landed on a weekend/holiday).
      if (curDate > date && prevClose != null && isFinite(prevClose)) {
        return { symbol, market, requestedDate: date, effectiveDate: date, close: prevClose, source: "yahoo" };
      }

      // Scenario A — Yahoo's session is still ON the requested date. If the
      // market has already CLOSED for that session (i.e. we're now in the
      // post-close / next-day pre-market window), regularMarketPrice IS the
      // finalized close for the requested date. We only accept this when the
      // market is currently closed — during live trading regularMarketPrice
      // is a moving intraday tick, not a close.
      if (curDate === date && !marketOpenNow && price != null && isFinite(price)) {
        return { symbol, market, requestedDate: date, effectiveDate: date, close: price, source: "yahoo" };
      }
    } catch { continue; }
  }

  return fallback;
}

async function polygonHist(symbol: string, market: MarketCode, date: string): Promise<HistoricalClose | null> {
  const key = process.env.POLYGON_API_KEY;
  if (!key || market !== "US") return null;
  const sym = symbol.toUpperCase();
  const target = new Date(date + "T00:00:00Z");
  const from = new Date(target.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const to = date;
  try {
    const r = await fetch(
      `https://api.polygon.io/v2/aggs/ticker/${sym}/range/1/day/${from}/${to}?adjusted=true&sort=desc&limit=10&apiKey=${key}`,
      { next: { revalidate: 0 } }
    );
    if (!r.ok) return null;
    const j = await r.json();
    const bars: { t: number; c: number }[] = j?.results ?? [];
    for (const bar of bars) {
      const eff = new Date(bar.t).toISOString().slice(0, 10);
      if (eff <= date && isFinite(bar.c) && bar.c > 0) {
        return { symbol, market, requestedDate: date, effectiveDate: eff, close: bar.c, source: "yahoo" };
      }
    }
    return null;
  } catch { return null; }
}

/**
 * Stooq historical via the daily CSV with date range. Endpoint:
 *   https://stooq.com/q/d/l/?s={sym}&i=d&d1={YYYYMMDD}&d2={YYYYMMDD}
 */
async function stooqHist(symbol: string, market: MarketCode, date: string): Promise<HistoricalClose | null> {
  const sym = stooqSymbol(symbol, market);
  const target = new Date(date + "T00:00:00Z");
  const start = new Date(target.getTime() - 14 * 86_400_000);
  // d2 is target + 1 day to ensure Stooq includes the requested date even with
  // minor data-feed delays (Stooq sometimes updates end-of-day data overnight).
  const d2 = new Date(target.getTime() + 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  try {
    const r = await fetch(
      `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d&d1=${fmt(start)}&d2=${fmt(d2)}`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" },
        next: { revalidate: 0 },
      }
    );
    if (!r.ok) return null;
    const text = await r.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return null;
    // Header: Date,Open,High,Low,Close,Volume
    // Walk newest → oldest.
    for (let i = lines.length - 1; i >= 1; i--) {
      const cols = lines[i].split(",");
      if (cols.length < 5) continue;
      const eff = cols[0];
      const close = parseFloat(cols[4]);
      if (eff && eff <= date && isFinite(close) && close > 0) {
        return { symbol, market, requestedDate: date, effectiveDate: eff, close, source: "stooq" };
      }
    }
    return null;
  } catch { return null; }
}

export async function fetchHistoricalClose(
  symbol: string, market: MarketCode, date: string
): Promise<HistoricalClose | null> {
  const k = histKey(symbol, market, date);
  const hit = histCache.get(k);
  // Don't use server-side cache if effectiveDate < requestedDate — the real
  // close may now be available. Only cache exact-date hits permanently.
  if (hit && hit.effectiveDate >= date) return hit;
  for (const f of [polygonHist, yahooHist, stooqHist]) {
    const r = await f(symbol, market, date);
    if (r) {
      if (r.effectiveDate >= date) histCache.set(k, r);
      return r;
    }
  }
  return null;
}

