// Server route: /api/stock-profile?symbol=NVDA&market=US
//
// Strategy: be permissive about what the user types ("NVDA", "NVIDIA",
// "sandisk", "Western Digital") and aggressive about getting SOMETHING
// back. We layer multiple sources so the page is rarely empty:
//
//   1. Symbol resolution
//        a. Looks-like-ticker? Use as-is.
//        b. Yahoo search endpoint  (handles "NVIDIA" → "NVDA")
//        c. Stooq lookup as last resort
//   2. Yahoo quoteSummary (primary — gives sector, financials, earnings)
//   3. Yahoo quote v7 (fallback — gives price/cap/52w when quoteSummary
//        returns empty modules)
//   4. Yahoo chart (5y history + 30d perf)
//   5. Stooq fallback for chart if Yahoo chart fails
//
// We only 502 when EVERYTHING fails. Otherwise we return partial data
// with a `warnings` array so the UI knows what's missing.

import { NextRequest, NextResponse } from "next/server";
import type { MarketCode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// Yahoo uses two hosts that occasionally diverge on availability. We try
// both. query2 is the newer one but query1 sometimes has data for older
// tickers.
const YAHOO_HOSTS = ["query2.finance.yahoo.com", "query1.finance.yahoo.com"];

/** Append the right Yahoo suffix per market. HK keeps leading zeros. */
function yahooSymbol(symbol: string, market: MarketCode): string {
  const suf: Record<MarketCode, string> = {
    US: "", HK: ".HK", JP: ".T", AU: ".AX", SG: ".SI", MY: ".KL",
  };
  // HK tickers are typically 4 digits with leading zeros (e.g. 0700, 0005).
  // Do NOT strip them — Yahoo's HK URLs use the padded form.
  return symbol.toUpperCase() + suf[market];
}

interface YahooModuleResp {
  quoteSummary?: { result?: Array<Record<string, any>>; error?: any };
}
interface YahooChartResp {
  chart?: {
    result?: Array<{ meta?: any; timestamp?: number[]; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }>;
    error?: any;
  };
}
interface YahooSearchResp {
  quotes?: Array<{ symbol: string; longname?: string; shortname?: string; exchange?: string; quoteType?: string }>;
}
interface YahooQuoteV7Resp {
  quoteResponse?: { result?: Array<Record<string, any>>; error?: any };
}

async function tryFetch<T>(urls: string[]): Promise<T | null> {
  // Try each URL in order, returning the first 200 + non-empty body.
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" }, next: { revalidate: 0 } });
      if (!r.ok) continue;
      const j = (await r.json()) as T;
      return j;
    } catch { /* try next host */ }
  }
  return null;
}

/**
 * Convert free-form input into a Yahoo-valid ticker. Returns a list of
 * candidate symbols (with market suffix). Caller iterates until one
 * yields data.
 *
 * Steps:
 *   1. Looks-like-ticker (≤6 chars, alphanumeric) → use as-is for the
 *      hinted market, plus the bare form for US fallback.
 *   2. Yahoo search — handles "NVIDIA" → "NVDA", "Sandisk" → "SNDK",
 *      "Western Digital" → "WDC".
 *   3. If everything fails, return the raw upper-cased input as a last try.
 */
async function resolveCandidates(raw: string, market: MarketCode): Promise<string[]> {
  const upper = raw.toUpperCase().trim();
  const out = new Set<string>();
  const looksLikeTicker = /^[A-Z0-9.\-]{1,8}$/.test(upper);

  if (looksLikeTicker) {
    out.add(yahooSymbol(upper, market));
    if (market !== "US") out.add(upper); // also try without suffix (US ADR)
  }

  // Yahoo search — typically resolves company names → first ticker hit.
  // Filter to EQUITY quotes; prefer the requested market when possible.
  const searchHosts = YAHOO_HOSTS.map(
    (h) => `https://${h}/v1/finance/search?q=${encodeURIComponent(raw)}&quotesCount=8&newsCount=0`
  );
  const s = await tryFetch<YahooSearchResp>(searchHosts);
  if (s?.quotes?.length) {
    const equities = s.quotes.filter((q) => q.quoteType === "EQUITY" || q.quoteType === "ETF");
    // Push market-matching first, then everything else.
    const preferredSuffix = market === "US" ? "" : yahooSymbol("", market).slice(0);
    for (const q of equities) {
      if (market === "US") {
        if (!q.symbol.includes(".")) out.add(q.symbol);
      } else if (q.symbol.endsWith(preferredSuffix)) {
        out.add(q.symbol);
      }
    }
    // Then add any equity hits as fallback regardless of market.
    for (const q of equities) out.add(q.symbol);
  }

  // Last-resort: try whatever the user typed verbatim.
  if (!out.size) out.add(yahooSymbol(upper, market));
  return Array.from(out);
}

async function fetchQuoteSummary(sym: string): Promise<Record<string, any> | null> {
  const modules = [
    "assetProfile", "summaryDetail", "defaultKeyStatistics",
    "financialData", "incomeStatementHistory", "earningsHistory", "price",
  ].join(",");
  const urls = YAHOO_HOSTS.map(
    (h) => `https://${h}/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${modules}`
  );
  const j = await tryFetch<YahooModuleResp>(urls);
  return j?.quoteSummary?.result?.[0] ?? null;
}

async function fetchQuoteV7(sym: string): Promise<Record<string, any> | null> {
  // Lightweight fallback: gives price, marketCap, 52w highs, dividend yield,
  // exchange name etc. Works even when quoteSummary returns nothing.
  const urls = YAHOO_HOSTS.map(
    (h) => `https://${h}/v7/finance/quote?symbols=${encodeURIComponent(sym)}`
  );
  const j = await tryFetch<YahooQuoteV7Resp>(urls);
  return j?.quoteResponse?.result?.[0] ?? null;
}

async function fetch30dPerf(sym: string): Promise<number | null> {
  const urls = YAHOO_HOSTS.map(
    (h) => `https://${h}/v8/finance/chart/${encodeURIComponent(sym)}?range=2mo&interval=1d`
  );
  const j = await tryFetch<YahooChartResp>(urls);
  const closes = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  const cleaned = closes.filter((x): x is number => typeof x === "number" && isFinite(x));
  if (cleaned.length < 2) return null;
  const last = cleaned[cleaned.length - 1];
  const ref = cleaned[Math.max(0, cleaned.length - 22)];
  if (!ref) return null;
  return ((last - ref) / ref) * 100;
}

async function fetchPriceHistory(sym: string): Promise<{ t: number; c: number }[]> {
  const urls = YAHOO_HOSTS.map(
    (h) => `https://${h}/v8/finance/chart/${encodeURIComponent(sym)}?range=5y&interval=1wk`
  );
  const j = await tryFetch<YahooChartResp>(urls);
  const result = j?.chart?.result?.[0];
  if (!result) return [];
  const ts = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const out: { t: number; c: number }[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (typeof c === "number" && isFinite(c)) {
      out.push({ t: ts[i] * 1000, c: Math.round(c * 100) / 100 });
    }
  }
  return out;
}

/**
 * Stooq fallback for price history. Provides weekly closes for US/HK/JP/AU/SG/MY.
 * Used when Yahoo's chart endpoint returns nothing.
 */
async function fetchStooqHistory(symbol: string, market: MarketCode): Promise<{ t: number; c: number }[]> {
  const suf: Record<MarketCode, string> = { US: ".us", HK: ".hk", JP: ".jp", AU: ".au", SG: ".sg", MY: ".kl" };
  const sym = symbol.toLowerCase() + suf[market];
  // 5 years weekly: i=w
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=w`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, next: { revalidate: 0 } });
    if (!r.ok) return [];
    const text = await r.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 3) return [];
    const out: { t: number; c: number }[] = [];
    // Header: Date,Open,High,Low,Close,Volume
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length < 5) continue;
      const t = Date.parse(cols[0]);
      const c = parseFloat(cols[4]);
      if (isFinite(t) && isFinite(c)) out.push({ t, c });
    }
    // Limit to last 5 years' worth
    const cutoff = Date.now() - 5 * 365 * 86_400_000;
    return out.filter((p) => p.t >= cutoff);
  } catch { return []; }
}

function pickNum(o: any, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "number" && isFinite(v)) return v;
    if (v && typeof v.raw === "number" && isFinite(v.raw)) return v.raw;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const symbolInput = (req.nextUrl.searchParams.get("symbol") || "").trim();
  const market = (req.nextUrl.searchParams.get("market") || "US").toUpperCase() as MarketCode;
  if (!symbolInput) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  // Step 1 — resolve free-form input into a list of candidate Yahoo symbols.
  const candidates = await resolveCandidates(symbolInput, market);
  if (!candidates.length) {
    return NextResponse.json({ error: `Could not find any matching ticker for "${symbolInput}". Try the exact ticker (e.g. NVDA, AAPL, 9988).` }, { status: 404 });
  }

  // Step 2 — try each candidate until quoteSummary OR quote v7 returns data.
  const warnings: string[] = [];
  let qs: Record<string, any> | null = null;
  let qv7: Record<string, any> | null = null;
  let resolvedSym = "";
  let resolvedSymbol = symbolInput.toUpperCase();
  for (const sym of candidates) {
    qs = await fetchQuoteSummary(sym);
    qv7 = await fetchQuoteV7(sym);
    if (qs || qv7) {
      resolvedSym = sym;
      // Strip suffix for the "bare" ticker we show in the UI.
      resolvedSymbol = sym.replace(/\.(HK|T|AX|SI|KL)$/i, "");
      break;
    }
  }
  if (!qs && !qv7) {
    return NextResponse.json({
      error: `Yahoo returned no data for any of: ${candidates.join(", ")}. Try the exact ticker (e.g. SNDK for SanDisk).`,
    }, { status: 502 });
  }
  if (!qs) warnings.push("quoteSummary unavailable — using quote-only data; financials and earnings history will be empty.");

  // Step 3 — price history. Yahoo first, Stooq fallback.
  let priceHistory: { t: number; c: number }[] = [];
  let perf30d: number | null = null;
  if (resolvedSym) {
    [priceHistory, perf30d] = await Promise.all([
      fetchPriceHistory(resolvedSym),
      fetch30dPerf(resolvedSym),
    ]);
  }
  if (priceHistory.length === 0) {
    // Stooq uses bare ticker + market suffix
    priceHistory = await fetchStooqHistory(resolvedSymbol, market);
    if (priceHistory.length > 0) warnings.push("Yahoo chart unavailable — price history from Stooq.");
  }

  // ─── Asset profile (prefer quoteSummary, fallback to quote v7) ───
  const ap = qs?.assetProfile ?? {};
  const profile = {
    sector: ap.sector ?? qv7?.sector ?? null,
    industry: ap.industry ?? qv7?.industry ?? null,
    country: ap.country ?? null,
    city: ap.city ?? null,
    state: ap.state ?? null,
    website: ap.website ?? null,
    fullTimeEmployees: ap.fullTimeEmployees ?? null,
    summary: ap.longBusinessSummary ?? null,
  };

  // ─── Price snapshot ───
  const sd = qs?.summaryDetail ?? {};
  const pr = qs?.price ?? {};
  const ks = qs?.defaultKeyStatistics ?? {};
  const fd = qs?.financialData ?? {};
  const snapshot = {
    longName: pr.longName ?? pr.shortName ?? qv7?.longName ?? qv7?.shortName ?? resolvedSymbol,
    exchange: pr.exchangeName ?? pr.exchange ?? qv7?.fullExchangeName ?? qv7?.exchange ?? null,
    currency: pr.currency ?? sd.currency ?? qv7?.currency ?? null,
    price: pickNum(pr, "regularMarketPrice") ?? pickNum(fd, "currentPrice") ?? pickNum(qv7 ?? {}, "regularMarketPrice"),
    marketCap: pickNum(pr, "marketCap") ?? pickNum(sd, "marketCap") ?? pickNum(qv7 ?? {}, "marketCap"),
    high52: pickNum(sd, "fiftyTwoWeekHigh") ?? pickNum(qv7 ?? {}, "fiftyTwoWeekHigh"),
    low52: pickNum(sd, "fiftyTwoWeekLow") ?? pickNum(qv7 ?? {}, "fiftyTwoWeekLow"),
    dividendYield: pickNum(sd, "dividendYield") ?? pickNum(qv7 ?? {}, "dividendYield"),
    beta: pickNum(ks, "beta"),
    perf30d,
  };

  // ─── Fundamentals ───
  const fundamentals = {
    forwardPE: pickNum(ks, "forwardPE") ?? pickNum(sd, "forwardPE") ?? pickNum(qv7 ?? {}, "forwardPE"),
    trailingPE: pickNum(sd, "trailingPE") ?? pickNum(qv7 ?? {}, "trailingPE"),
    pegRatio: pickNum(ks, "pegRatio"),
    enterpriseValue: pickNum(ks, "enterpriseValue"),
    evRevenue: pickNum(ks, "enterpriseToRevenue"),
    evEbitda: pickNum(ks, "enterpriseToEbitda"),
    profitMargin: pickNum(fd, "profitMargins"),
    operatingMargin: pickNum(fd, "operatingMargins"),
    revenueGrowth: pickNum(fd, "revenueGrowth"),
    earningsGrowth: pickNum(fd, "earningsGrowth"),
    totalCash: pickNum(fd, "totalCash"),
    totalDebt: pickNum(fd, "totalDebt"),
    sharesOutstanding: pickNum(ks, "sharesOutstanding") ?? pickNum(qv7 ?? {}, "sharesOutstanding"),
    epsTrailing: pickNum(ks, "trailingEps") ?? pickNum(qv7 ?? {}, "epsTrailingTwelveMonths"),
    epsForward: pickNum(ks, "forwardEps") ?? pickNum(qv7 ?? {}, "epsForward"),
  };

  // ─── Income statement (last 4 years) ───
  const incomeRows: Array<{ year: number; revenue: number; netIncome: number | null }> = [];
  const ish = qs?.incomeStatementHistory?.incomeStatementHistory ?? [];
  for (const row of ish) {
    const revenue = pickNum(row, "totalRevenue");
    const netIncome = pickNum(row, "netIncome");
    const endDate = row?.endDate?.fmt || row?.endDate?.raw;
    const year = endDate ? new Date(typeof endDate === "number" ? endDate * 1000 : endDate).getUTCFullYear() : null;
    if (revenue != null && year != null) incomeRows.push({ year, revenue, netIncome });
  }
  incomeRows.sort((a, b) => a.year - b.year);

  // ─── Earnings history (last 4 quarters) ───
  const earningsRows: Array<{
    quarter: string; estimate: number | null; actual: number | null;
    surprisePct: number | null; verdict: "beat" | "miss" | "inline" | null;
  }> = [];
  const eh = qs?.earningsHistory?.history ?? [];
  for (const row of eh) {
    const est = pickNum(row, "epsEstimate");
    const act = pickNum(row, "epsActual");
    const sp = pickNum(row, "surprisePercent");
    const q = row?.quarter?.fmt ?? row?.period ?? null;
    let verdict: "beat" | "miss" | "inline" | null = null;
    if (sp != null) verdict = sp > 0.02 ? "beat" : sp < -0.02 ? "miss" : "inline";
    else if (est != null && act != null) {
      const pct = (act - est) / Math.abs(est);
      verdict = pct > 0.02 ? "beat" : pct < -0.02 ? "miss" : "inline";
    }
    earningsRows.push({ quarter: q, estimate: est, actual: act, surprisePct: sp != null ? sp * 100 : null, verdict });
  }
  earningsRows.reverse();

  return new NextResponse(
    JSON.stringify({
      symbol: resolvedSymbol, market, sym: resolvedSym,
      inputSymbol: symbolInput,
      candidatesTried: candidates,
      warnings,
      profile, snapshot, fundamentals,
      income: incomeRows,
      earnings: earningsRows,
      priceHistory,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, s-maxage=900, stale-while-revalidate=86400",
      },
    }
  );
}
