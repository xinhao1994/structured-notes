// Server route: /api/stock-profile?symbol=NVDA&market=US
//
// Yahoo's quoteSummary endpoint started requiring a "crumb" + cookie pair
// in 2023 — it works in browsers but returns 401/403 from Vercel functions
// without that handshake. We do the full handshake here, cache the crumb
// in module scope so warm Lambdas reuse it, and fall back to Finnhub
// (existing FINNHUB_API_KEY) and Stooq when Yahoo refuses.
//
// Data layering:
//   1. Symbol resolution
//        a. Looks-like-ticker → use as-is.
//        b. Yahoo /v1/finance/search (no auth needed)
//   2. Fundamentals + profile
//        a. Yahoo quoteSummary WITH crumb (primary)
//        b. Yahoo quote v7 WITH crumb (fallback)
//        c. Finnhub /stock/profile2 + /stock/metric + /stock/earnings (fallback)
//   3. Price history
//        a. Yahoo chart v8 (no auth needed) — usually works
//        b. Stooq CSV
//
// We only 502 when everything fails. Otherwise return partial data with
// a `warnings` array.

import { NextRequest, NextResponse } from "next/server";
import type { MarketCode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

/* ────────────────────────────────────────────────────────────────────────
   Yahoo crumb cache — module scope so warm Lambdas reuse it.
   Crumbs are session-scoped; we refetch on 401/403.
   ──────────────────────────────────────────────────────────────────────── */
interface YahooSession { cookie: string; crumb: string; fetchedAt: number; }
let yahooSession: YahooSession | null = null;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min

async function getYahooSession(force = false): Promise<YahooSession | null> {
  if (!force && yahooSession && Date.now() - yahooSession.fetchedAt < SESSION_TTL_MS) {
    return yahooSession;
  }
  try {
    // Step 1: hit fc.yahoo.com to get the A1 / A3 cookies.
    const r1 = await fetch("https://fc.yahoo.com/", {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      redirect: "manual",
      next: { revalidate: 0 },
    });
    // Collect Set-Cookie headers from the response.
    const setCookie = (r1.headers as any).getSetCookie?.() ?? [r1.headers.get("set-cookie")].filter(Boolean);
    const cookies = (Array.isArray(setCookie) ? setCookie : [setCookie])
      .filter(Boolean)
      .map((c: string) => c.split(";")[0])
      .join("; ");
    if (!cookies) return null;

    // Step 2: get the crumb using that cookie.
    const r2 = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookies, Accept: "*/*" },
      next: { revalidate: 0 },
    });
    if (!r2.ok) return null;
    const crumb = (await r2.text()).trim();
    if (!crumb || crumb.length > 64) return null;

    yahooSession = { cookie: cookies, crumb, fetchedAt: Date.now() };
    return yahooSession;
  } catch {
    return null;
  }
}

async function yahooAuthedGet<T>(path: string, params: Record<string, string>): Promise<T | null> {
  // Try with crumb (first call gets/uses cached, second call refreshes if 401).
  for (let attempt = 0; attempt < 2; attempt++) {
    const session = await getYahooSession(attempt > 0);
    const search = new URLSearchParams({ ...params, ...(session ? { crumb: session.crumb } : {}) });
    for (const host of YAHOO_HOSTS) {
      try {
        const r = await fetch(`https://${host}${path}?${search.toString()}`, {
          headers: {
            "User-Agent": UA,
            Accept: "application/json",
            ...(session ? { Cookie: session.cookie } : {}),
          },
          next: { revalidate: 0 },
        });
        if (r.status === 401 || r.status === 403) break; // try next attempt (refresh crumb)
        if (!r.ok) continue;
        const j = (await r.json()) as T;
        return j;
      } catch { /* try next host */ }
    }
  }
  return null;
}

/** Unauthenticated GET — for endpoints Yahoo doesn't gate (search, chart). */
async function yahooOpenGet<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const search = new URLSearchParams(params);
  for (const host of YAHOO_HOSTS) {
    try {
      const r = await fetch(`https://${host}${path}?${search.toString()}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        next: { revalidate: 0 },
      });
      if (!r.ok) continue;
      const j = (await r.json()) as T;
      return j;
    } catch {}
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────
   Type helpers + Yahoo response shapes
   ──────────────────────────────────────────────────────────────────────── */
interface YahooModuleResp { quoteSummary?: { result?: Array<Record<string, any>>; error?: any }; }
interface YahooChartResp {
  chart?: { result?: Array<{ meta?: any; timestamp?: number[]; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }>; error?: any };
}
interface YahooSearchResp {
  quotes?: Array<{ symbol: string; longname?: string; shortname?: string; exchange?: string; quoteType?: string }>;
}
interface YahooQuoteV7Resp { quoteResponse?: { result?: Array<Record<string, any>>; error?: any }; }

function yahooSymbol(symbol: string, market: MarketCode): string {
  const suf: Record<MarketCode, string> = { US: "", HK: ".HK", JP: ".T", AU: ".AX", SG: ".SI", MY: ".KL" };
  return symbol.toUpperCase() + suf[market];
}

/* ────────────────────────────────────────────────────────────────────────
   Symbol resolution
   ──────────────────────────────────────────────────────────────────────── */
async function resolveCandidates(raw: string, market: MarketCode): Promise<string[]> {
  const upper = raw.toUpperCase().trim();
  const out = new Set<string>();
  const looksLikeTicker = /^[A-Z0-9.\-]{1,8}$/.test(upper);

  // STRICT market matching. Previously we added all equity matches as
  // fallbacks, which meant a US search for "NVIDIA" was trying Nvidia's
  // German (.DE), Amsterdam (.AS), Hamburg (.HM) listings too. Those
  // exchanges return 502 from Yahoo on Vercel, eating up retries.
  if (looksLikeTicker) {
    out.add(yahooSymbol(upper, market));
  }

  const s = await yahooOpenGet<YahooSearchResp>("/v1/finance/search", {
    q: raw, quotesCount: "10", newsCount: "0",
  });
  if (s?.quotes?.length) {
    const equities = s.quotes.filter((q) => q.quoteType === "EQUITY" || q.quoteType === "ETF");
    const wantSuffix = market === "US" ? "" : yahooSymbol("", market);
    for (const q of equities) {
      if (market === "US") {
        // US: no exchange suffix at all (NVDA, BRK.B, BRK-B are ok). Reject
        // .DE, .AS, .HM (European exchanges) explicitly — those routinely
        // 502 from Vercel functions and the user wants US data.
        if (!/\.(DE|AS|HM|F|MU|MI|PA|L|TO|MX|SA|BR|HE|ST|CO|VI|IR|BD|SW|VX|TA|JO|WA|PR|BO|NS|KS|KQ|TW|TWO|SI|BK|JK|SI|AX|NZ|MX|MC|LS|AT|BE|CN|LN|NEO)$/.test(q.symbol)) {
          out.add(q.symbol);
        }
      } else if (q.symbol.endsWith(wantSuffix)) {
        out.add(q.symbol);
      }
    }
  }

  if (!out.size) out.add(yahooSymbol(upper, market));
  // Keep top 4 — enough to retry across hosts/typos, not so many we waste time
  return Array.from(out).slice(0, 4);
}

/* ────────────────────────────────────────────────────────────────────────
   Yahoo data fetchers (crumb-authenticated)
   ──────────────────────────────────────────────────────────────────────── */
async function fetchQuoteSummary(sym: string): Promise<Record<string, any> | null> {
  const modules = [
    "assetProfile", "summaryDetail", "defaultKeyStatistics",
    "financialData", "incomeStatementHistory", "earningsHistory", "price",
    "recommendationTrend",   // analyst Buy / Hold / Sell distribution
    "calendarEvents",         // next earnings date + estimates
    "upgradeDowngradeHistory",// recent upgrades / downgrades
  ].join(",");
  const j = await yahooAuthedGet<YahooModuleResp>(`/v10/finance/quoteSummary/${encodeURIComponent(sym)}`, { modules });
  return j?.quoteSummary?.result?.[0] ?? null;
}

async function fetchQuoteV7(sym: string): Promise<Record<string, any> | null> {
  const j = await yahooAuthedGet<YahooQuoteV7Resp>("/v7/finance/quote", { symbols: sym });
  return j?.quoteResponse?.result?.[0] ?? null;
}

async function fetch30dPerf(sym: string): Promise<number | null> {
  const j = await yahooOpenGet<YahooChartResp>(`/v8/finance/chart/${encodeURIComponent(sym)}`, {
    range: "2mo", interval: "1d",
  });
  const closes = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  const cleaned = closes.filter((x): x is number => typeof x === "number" && isFinite(x));
  if (cleaned.length < 2) return null;
  const last = cleaned[cleaned.length - 1];
  const ref = cleaned[Math.max(0, cleaned.length - 22)];
  if (!ref) return null;
  return ((last - ref) / ref) * 100;
}

async function fetchPriceHistory(sym: string): Promise<{ t: number; c: number }[]> {
  const j = await yahooOpenGet<YahooChartResp>(`/v8/finance/chart/${encodeURIComponent(sym)}`, {
    range: "5y", interval: "1wk",
  });
  const result = j?.chart?.result?.[0];
  if (!result) return [];
  const ts = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const out: { t: number; c: number }[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (typeof c === "number" && isFinite(c)) out.push({ t: ts[i] * 1000, c: Math.round(c * 100) / 100 });
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────
   Finnhub fallback for fundamentals (US-focused)
   Free-tier endpoints (no payment required for our usage):
     /stock/profile2  — name, country, ipo, marketCap, weburl, finnhubIndustry
     /stock/metric    — P/E, margins, growth, etc. (`metric=all`)
     /stock/earnings  — quarterly EPS estimate vs actual (beat/miss)
   Activated when env FINNHUB_API_KEY is set.
   ──────────────────────────────────────────────────────────────────────── */
const FINNHUB_KEY = () => process.env.FINNHUB_API_KEY;

async function finnhubGet<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const key = FINNHUB_KEY();
  if (!key) return null;
  const search = new URLSearchParams({ ...params, token: key });
  try {
    const r = await fetch(`https://finnhub.io/api/v1${path}?${search.toString()}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch { return null; }
}

interface FinnhubProfile {
  country?: string; currency?: string; exchange?: string; finnhubIndustry?: string;
  ipo?: string; logo?: string; marketCapitalization?: number; name?: string;
  shareOutstanding?: number; ticker?: string; weburl?: string;
}
interface FinnhubMetric {
  metric?: {
    "10DayAverageTradingVolume"?: number;
    "52WeekHigh"?: number; "52WeekLow"?: number;
    "peNormalizedAnnual"?: number; "peTTM"?: number; "peExclExtraTTM"?: number;
    "forwardPE"?: number; "psTTM"?: number; "pbAnnual"?: number;
    "epsTTM"?: number; "epsAnnual"?: number;
    "epsGrowthQuarterlyYoy"?: number; "revenueGrowthQuarterlyYoy"?: number;
    "netProfitMarginAnnual"?: number; "operatingMarginAnnual"?: number;
    "currentRatioAnnual"?: number; "totalDebt/totalEquityAnnual"?: number;
    "dividendYieldIndicatedAnnual"?: number; "beta"?: number;
    "marketCapitalization"?: number;
    [k: string]: number | undefined;
  };
}
interface FinnhubEarnings { period: string; symbol?: string; estimate: number; actual: number; surprise: number; surprisePercent: number; }

async function fetchFinnhubBundle(sym: string): Promise<{
  profile: FinnhubProfile | null;
  metric: FinnhubMetric | null;
  earnings: FinnhubEarnings[] | null;
}> {
  // Strip Yahoo suffix — Finnhub uses bare ticker for US.
  const bare = sym.replace(/\.[A-Z]+$/, "");
  const [profile, metric, earnings] = await Promise.all([
    finnhubGet<FinnhubProfile>("/stock/profile2", { symbol: bare }),
    finnhubGet<FinnhubMetric>("/stock/metric", { symbol: bare, metric: "all" }),
    finnhubGet<FinnhubEarnings[]>("/stock/earnings", { symbol: bare }),
  ]);
  return { profile, metric, earnings };
}

/* ────────────────────────────────────────────────────────────────────────
   Stooq fallback for price history
   ──────────────────────────────────────────────────────────────────────── */
async function fetchStooqHistory(symbol: string, market: MarketCode): Promise<{ t: number; c: number }[]> {
  const suf: Record<MarketCode, string> = { US: ".us", HK: ".hk", JP: ".jp", AU: ".au", SG: ".sg", MY: ".kl" };
  const sym = symbol.toLowerCase().replace(/\.[a-z]+$/i, "") + suf[market];
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=w`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, next: { revalidate: 0 } });
    if (!r.ok) return [];
    const text = await r.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 3) return [];
    const out: { t: number; c: number }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length < 5) continue;
      const t = Date.parse(cols[0]);
      const c = parseFloat(cols[4]);
      if (isFinite(t) && isFinite(c)) out.push({ t, c });
    }
    const cutoff = Date.now() - 5 * 365 * 86_400_000;
    return out.filter((p) => p.t >= cutoff);
  } catch { return []; }
}

/* ────────────────────────────────────────────────────────────────────────
   Utility
   ──────────────────────────────────────────────────────────────────────── */
function pickNum(o: any, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "number" && isFinite(v)) return v;
    if (v && typeof v.raw === "number" && isFinite(v.raw)) return v.raw;
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────
   Main handler
   ──────────────────────────────────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const symbolInput = (req.nextUrl.searchParams.get("symbol") || "").trim();
  const market = (req.nextUrl.searchParams.get("market") || "US").toUpperCase() as MarketCode;
  if (!symbolInput) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  // Step 1: resolve candidates
  const candidates = await resolveCandidates(symbolInput, market);
  const warnings: string[] = [];

  // Step 2: try each candidate against Yahoo quoteSummary (crumbed)
  let qs: Record<string, any> | null = null;
  let qv7: Record<string, any> | null = null;
  let resolvedSym = "";
  let resolvedSymbol = symbolInput.toUpperCase();
  for (const sym of candidates) {
    [qs, qv7] = await Promise.all([fetchQuoteSummary(sym), fetchQuoteV7(sym)]);
    if (qs || qv7) {
      resolvedSym = sym;
      resolvedSymbol = sym.replace(/\.(HK|T|AX|SI|KL)$/i, "");
      break;
    }
  }

  // Step 3: if Yahoo authed endpoints failed entirely, try Finnhub for US tickers
  let fhProfile: FinnhubProfile | null = null;
  let fhMetric: FinnhubMetric | null = null;
  let fhEarnings: FinnhubEarnings[] | null = null;
  if (!qs && !qv7) {
    const usCand = candidates.find((c) => !c.includes(".")) || candidates[0];
    if (usCand) {
      const bundle = await fetchFinnhubBundle(usCand);
      fhProfile = bundle.profile; fhMetric = bundle.metric; fhEarnings = bundle.earnings;
      if (fhProfile?.name) {
        resolvedSym = usCand;
        resolvedSymbol = usCand;
        warnings.push("Yahoo blocked — fundamentals from Finnhub.");
      }
    }
  } else if (!qs) {
    warnings.push("quoteSummary unavailable — using quote-only data; some financials/earnings empty.");
  }

  if (!qs && !qv7 && !fhProfile) {
    return NextResponse.json({
      error: `No data found for "${symbolInput}". Tried: ${candidates.join(", ")}. ${FINNHUB_KEY() ? "" : "(Set FINNHUB_API_KEY env for richer fallback.)"}`,
      candidatesTried: candidates,
    }, { status: 502 });
  }

  // Step 4: price history
  let priceHistory: { t: number; c: number }[] = [];
  let perf30d: number | null = null;
  const symForChart = resolvedSym || candidates[0];
  if (symForChart) {
    [priceHistory, perf30d] = await Promise.all([
      fetchPriceHistory(symForChart),
      fetch30dPerf(symForChart),
    ]);
  }
  if (priceHistory.length === 0) {
    priceHistory = await fetchStooqHistory(resolvedSymbol, market);
    if (priceHistory.length > 0) warnings.push("Yahoo chart unavailable — price history from Stooq.");
  }

  const ap = qs?.assetProfile ?? {};
  const profile = {
    sector: ap.sector ?? qv7?.sector ?? null,
    industry: ap.industry ?? qv7?.industry ?? fhProfile?.finnhubIndustry ?? null,
    country: ap.country ?? fhProfile?.country ?? null,
    city: ap.city ?? null,
    state: ap.state ?? null,
    website: ap.website ?? fhProfile?.weburl ?? null,
    fullTimeEmployees: ap.fullTimeEmployees ?? null,
    summary: ap.longBusinessSummary ?? null,
  };

  const sd = qs?.summaryDetail ?? {};
  const pr = qs?.price ?? {};
  const ks = qs?.defaultKeyStatistics ?? {};
  const fd = qs?.financialData ?? {};
  const fm = fhMetric?.metric ?? {};

  const snapshot = {
    longName: pr.longName ?? pr.shortName ?? qv7?.longName ?? qv7?.shortName ?? fhProfile?.name ?? resolvedSymbol,
    exchange: pr.exchangeName ?? pr.exchange ?? qv7?.fullExchangeName ?? qv7?.exchange ?? fhProfile?.exchange ?? null,
    currency: pr.currency ?? sd.currency ?? qv7?.currency ?? fhProfile?.currency ?? null,
    price: pickNum(pr, "regularMarketPrice") ?? pickNum(fd, "currentPrice") ?? pickNum(qv7 ?? {}, "regularMarketPrice"),
    marketCap: pickNum(pr, "marketCap") ?? pickNum(sd, "marketCap") ?? pickNum(qv7 ?? {}, "marketCap")
      ?? (fhProfile?.marketCapitalization ? fhProfile.marketCapitalization * 1_000_000 : null),
    high52: pickNum(sd, "fiftyTwoWeekHigh") ?? pickNum(qv7 ?? {}, "fiftyTwoWeekHigh") ?? fm["52WeekHigh"] ?? null,
    low52: pickNum(sd, "fiftyTwoWeekLow") ?? pickNum(qv7 ?? {}, "fiftyTwoWeekLow") ?? fm["52WeekLow"] ?? null,
    dividendYield: pickNum(sd, "dividendYield") ?? pickNum(qv7 ?? {}, "dividendYield") ?? fm["dividendYieldIndicatedAnnual"] ?? null,
    beta: pickNum(ks, "beta") ?? fm["beta"] ?? null,
    perf30d,
  };

  const fundamentals = {
    forwardPE: pickNum(ks, "forwardPE") ?? pickNum(sd, "forwardPE") ?? pickNum(qv7 ?? {}, "forwardPE") ?? fm["forwardPE"] ?? null,
    trailingPE: pickNum(sd, "trailingPE") ?? pickNum(qv7 ?? {}, "trailingPE") ?? fm["peTTM"] ?? null,
    pegRatio: pickNum(ks, "pegRatio"),
    enterpriseValue: pickNum(ks, "enterpriseValue"),
    evRevenue: pickNum(ks, "enterpriseToRevenue") ?? fm["psTTM"] ?? null,
    evEbitda: pickNum(ks, "enterpriseToEbitda"),
    profitMargin: pickNum(fd, "profitMargins") ?? (fm["netProfitMarginAnnual"] != null ? fm["netProfitMarginAnnual"]! / 100 : null),
    operatingMargin: pickNum(fd, "operatingMargins") ?? (fm["operatingMarginAnnual"] != null ? fm["operatingMarginAnnual"]! / 100 : null),
    revenueGrowth: pickNum(fd, "revenueGrowth") ?? (fm["revenueGrowthQuarterlyYoy"] != null ? fm["revenueGrowthQuarterlyYoy"]! / 100 : null),
    earningsGrowth: pickNum(fd, "earningsGrowth") ?? (fm["epsGrowthQuarterlyYoy"] != null ? fm["epsGrowthQuarterlyYoy"]! / 100 : null),
    totalCash: pickNum(fd, "totalCash"),
    totalDebt: pickNum(fd, "totalDebt"),
    sharesOutstanding: pickNum(ks, "sharesOutstanding") ?? pickNum(qv7 ?? {}, "sharesOutstanding")
      ?? (fhProfile?.shareOutstanding ? fhProfile.shareOutstanding * 1_000_000 : null),
    epsTrailing: pickNum(ks, "trailingEps") ?? pickNum(qv7 ?? {}, "epsTrailingTwelveMonths") ?? fm["epsTTM"] ?? null,
    epsForward: pickNum(ks, "forwardEps") ?? pickNum(qv7 ?? {}, "epsForward") ?? null,
  };

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
  if (earningsRows.length === 0 && fhEarnings && fhEarnings.length > 0) {
    for (const r of fhEarnings.slice(0, 4)) {
      const sp = r.surprisePercent;
      const verdict: "beat" | "miss" | "inline" = sp > 2 ? "beat" : sp < -2 ? "miss" : "inline";
      earningsRows.push({
        quarter: r.period,
        estimate: r.estimate, actual: r.actual,
        surprisePct: sp, verdict,
      });
    }
    earningsRows.reverse();
  }

  // ─── Analyst recommendation distribution (last available trend snapshot) ───
  const recTrend = qs?.recommendationTrend?.trend ?? [];
  const latestRec = recTrend[0] ?? null;
  const analystRec = latestRec ? {
    period: latestRec.period ?? null,
    strongBuy: latestRec.strongBuy ?? 0,
    buy: latestRec.buy ?? 0,
    hold: latestRec.hold ?? 0,
    sell: latestRec.sell ?? 0,
    strongSell: latestRec.strongSell ?? 0,
  } : null;

  // ─── Next earnings date + analyst revenue / EPS estimate range ───
  const ce = qs?.calendarEvents ?? {};
  const earningsDateRaw = ce.earnings?.earningsDate?.[0];
  const nextEarnings = earningsDateRaw ? {
    date: typeof earningsDateRaw === "number"
      ? new Date(earningsDateRaw * 1000).toISOString().slice(0, 10)
      : earningsDateRaw.fmt ?? null,
    epsEstimate: pickNum(ce.earnings ?? {}, "earningsAverage"),
    epsLow: pickNum(ce.earnings ?? {}, "earningsLow"),
    epsHigh: pickNum(ce.earnings ?? {}, "earningsHigh"),
    revenueEstimate: pickNum(ce.earnings ?? {}, "revenueAverage"),
    revenueLow: pickNum(ce.earnings ?? {}, "revenueLow"),
    revenueHigh: pickNum(ce.earnings ?? {}, "revenueHigh"),
  } : null;

  // ─── Recent upgrade/downgrade history (last 6) ───
  const udh = qs?.upgradeDowngradeHistory?.history ?? [];
  const upgrades = udh.slice(0, 6).map((u: any) => ({
    firm: u.firm ?? null,
    toGrade: u.toGrade ?? null,
    fromGrade: u.fromGrade ?? null,
    action: u.action ?? null,
    date: typeof u.epochGradeDate === "number" ? new Date(u.epochGradeDate * 1000).toISOString().slice(0, 10) : null,
  }));

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
      analystRec,
      nextEarnings,
      upgrades,
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
