// Server route: /api/stock-profile?symbol=NVDA&market=US
//
// Returns a normalized snapshot for the stock-analysis page. Pulls:
//   • assetProfile           — sector, industry, country, hq, summary, employees
//   • summaryDetail          — price, market cap, dividend yield, 52w range
//   • defaultKeyStatistics   — P/E (forward), enterprise value, sharesOutstanding,
//                              EV/Revenue, beta
//   • financialData          — current margins, revenue growth, EPS growth, totalCash, totalDebt
//   • incomeStatementHistory — last 4 annual income statements (revenue/net income)
//   • earningsHistory        — last 4 quarterly EPS estimates vs actuals (beat/miss)
//   • price                  — 30-day pricing for the perf number on the dashboard
//
// All data comes from Yahoo Finance's public query API. No API key required.
// We cache aggressively because fundamentals only change quarterly.

import { NextRequest, NextResponse } from "next/server";
import type { MarketCode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function yahooSymbol(symbol: string, market: MarketCode): string {
  const suf: Record<MarketCode, string> = {
    US: "", HK: ".HK", JP: ".T", AU: ".AX", SG: ".SI", MY: ".KL",
  };
  return symbol.toUpperCase().replace(/^0+/, "") // strip leading zeros for HK 4-digit codes
    + suf[market];
}

interface YahooModuleResp {
  quoteSummary?: {
    result?: Array<Record<string, any>>;
    error?: any;
  };
}

interface YahooChartResp {
  chart?: {
    result?: Array<{
      meta?: any;
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: (number | null)[] }> };
    }>;
    error?: any;
  };
}

async function fetchQuoteSummary(sym: string): Promise<Record<string, any> | null> {
  const modules = [
    "assetProfile",
    "summaryDetail",
    "defaultKeyStatistics",
    "financialData",
    "incomeStatementHistory",
    "earningsHistory",
    "price",
  ].join(",");
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${modules}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, next: { revalidate: 0 } });
    if (!r.ok) return null;
    const j: YahooModuleResp = await r.json();
    return j.quoteSummary?.result?.[0] ?? null;
  } catch { return null; }
}

async function fetch30dPerf(sym: string): Promise<number | null> {
  // 30-day total return — close today vs close 30 cal days ago. Simple math.
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2mo&interval=1d`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, next: { revalidate: 0 } });
    if (!r.ok) return null;
    const j: YahooChartResp = await r.json();
    const closes = j.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const cleaned = closes.filter((x): x is number => typeof x === "number" && isFinite(x));
    if (cleaned.length < 2) return null;
    const last = cleaned[cleaned.length - 1];
    const ref = cleaned[Math.max(0, cleaned.length - 22)]; // ~22 trading days ≈ 30 calendar
    if (!ref) return null;
    return ((last - ref) / ref) * 100;
  } catch { return null; }
}

async function fetchPriceHistory(sym: string): Promise<{ t: number; c: number }[]> {
  // 5-year daily for the chart
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5y&interval=1wk`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, next: { revalidate: 0 } });
    if (!r.ok) return [];
    const j: YahooChartResp = await r.json();
    const result = j.chart?.result?.[0];
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
  const symbol = (req.nextUrl.searchParams.get("symbol") || "").trim().toUpperCase();
  const market = (req.nextUrl.searchParams.get("market") || "US").toUpperCase() as MarketCode;
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }
  const sym = yahooSymbol(symbol, market);

  const [qs, perf30, history] = await Promise.all([
    fetchQuoteSummary(sym),
    fetch30dPerf(sym),
    fetchPriceHistory(sym),
  ]);

  if (!qs) {
    return NextResponse.json({ error: `Yahoo returned no data for ${sym}` }, { status: 502 });
  }

  // ─── Asset profile ───
  const ap = qs.assetProfile ?? {};
  const profile = {
    sector: ap.sector ?? null,
    industry: ap.industry ?? null,
    country: ap.country ?? null,
    city: ap.city ?? null,
    state: ap.state ?? null,
    website: ap.website ?? null,
    fullTimeEmployees: ap.fullTimeEmployees ?? null,
    summary: ap.longBusinessSummary ?? null,
  };

  // ─── Price snapshot ───
  const sd = qs.summaryDetail ?? {};
  const pr = qs.price ?? {};
  const ks = qs.defaultKeyStatistics ?? {};
  const fd = qs.financialData ?? {};
  const snapshot = {
    longName: pr.longName ?? pr.shortName ?? symbol,
    exchange: pr.exchangeName ?? pr.exchange ?? null,
    currency: pr.currency ?? sd.currency ?? null,
    price: pickNum(pr, "regularMarketPrice") ?? pickNum(fd, "currentPrice"),
    marketCap: pickNum(pr, "marketCap") ?? pickNum(sd, "marketCap"),
    high52: pickNum(sd, "fiftyTwoWeekHigh"),
    low52: pickNum(sd, "fiftyTwoWeekLow"),
    dividendYield: pickNum(sd, "dividendYield"),
    beta: pickNum(ks, "beta"),
    perf30d: perf30,
  };

  // ─── Fundamentals ───
  const fundamentals = {
    forwardPE: pickNum(ks, "forwardPE") ?? pickNum(sd, "forwardPE"),
    trailingPE: pickNum(sd, "trailingPE"),
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
    sharesOutstanding: pickNum(ks, "sharesOutstanding"),
    epsTrailing: pickNum(ks, "trailingEps"),
    epsForward: pickNum(ks, "forwardEps"),
  };

  // ─── Income statement (last 4 years) ───
  const incomeRows: Array<{ year: number; revenue: number; netIncome: number | null }> = [];
  const ish = qs.incomeStatementHistory?.incomeStatementHistory ?? [];
  for (const row of ish) {
    const revenue = pickNum(row, "totalRevenue");
    const netIncome = pickNum(row, "netIncome");
    const endDate = row?.endDate?.fmt || row?.endDate?.raw;
    const year = endDate ? new Date(typeof endDate === "number" ? endDate * 1000 : endDate).getUTCFullYear() : null;
    if (revenue != null && year != null) {
      incomeRows.push({ year, revenue, netIncome });
    }
  }
  incomeRows.sort((a, b) => a.year - b.year);

  // ─── Earnings history (last 4 quarters: beat / miss / inline) ───
  const earningsRows: Array<{
    quarter: string; estimate: number | null; actual: number | null;
    surprisePct: number | null; verdict: "beat" | "miss" | "inline" | null;
  }> = [];
  const eh = qs.earningsHistory?.history ?? [];
  for (const row of eh) {
    const est = pickNum(row, "epsEstimate");
    const act = pickNum(row, "epsActual");
    const sp = pickNum(row, "surprisePercent");
    const q = row?.quarter?.fmt ?? row?.period ?? null;
    let verdict: "beat" | "miss" | "inline" | null = null;
    if (sp != null) {
      verdict = sp > 0.02 ? "beat" : sp < -0.02 ? "miss" : "inline";
    } else if (est != null && act != null) {
      const pct = (act - est) / Math.abs(est);
      verdict = pct > 0.02 ? "beat" : pct < -0.02 ? "miss" : "inline";
    }
    earningsRows.push({ quarter: q, estimate: est, actual: act, surprisePct: sp != null ? sp * 100 : null, verdict });
  }
  // Yahoo gives newest first — reverse for chart.
  earningsRows.reverse();

  return new NextResponse(
    JSON.stringify({
      symbol, market, sym,
      profile, snapshot, fundamentals,
      income: incomeRows,
      earnings: earningsRows,
      priceHistory: history,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        // Fundamentals refresh quarterly; price snapshot is fine at 15 min stale.
        "cache-control": "public, s-maxage=900, stale-while-revalidate=86400",
      },
    }
  );
}
