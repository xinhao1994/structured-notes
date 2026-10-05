// GET /api/wayne/analyze?symbol=MRVL&market=US
//
// Wayne's DCF: a two-stage discounted cash flow + forward-multiple blend.
// Named after the treasury specialist whose structured note tranches knock
// out early because he underwrites to intrinsic value with a safety margin
// and refuses highly-leveraged names.
//
// Inputs (fetched from Yahoo Finance v10 quoteSummary + v7 quote):
//   • Forward P/E
//   • Forward EPS
//   • Beta
//   • Trailing-twelve-month Free Cash Flow (op cashflow − capex)
//   • Total debt / total equity (ban rule: D/E > 1.0 → "Wayne skips")
//   • Earnings growth, revenue growth (used as growth proxies)
//
// Formulas:
//   WACC (CAPM)       r = Rf + β × ERP
//   5-yr explicit DCF Σ FCFₜ / (1+r)ᵗ  with FCFₜ = FCF₀·(1+g₁)ᵗ
//   Terminal value    TV = FCF₅·(1+g∞) / (r − g∞), discounted back 5 years
//   Intrinsic / share (ΣPV + TV_PV) / sharesOut
//   Future value 12m  epsForward × forwardPE   (next-year multiple)
//   Wayne's target    0.50 × intrinsic + 0.50 × fwdMultiple
//                     × (1 − 0.05)   (5% Wayne safety discount)

import { NextRequest, NextResponse } from "next/server";
import type { MarketCode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── CAPM constants ────────────────────────────────────────────────────
const RISK_FREE = 0.045;        // US 10Y treasury, 2026 ballpark
const EQUITY_PREMIUM = 0.055;   // long-run equity risk premium
const TERMINAL_GROWTH = 0.03;   // long-term GDP ≈ 3%
const EXPLICIT_YEARS = 5;       // 5-year explicit forecast window
const WAYNE_MARGIN = 0.05;      // 5% safety discount
const MAX_G1 = 0.20;            // cap FCF growth at 20% (no magical thinking)
const MIN_G1 = 0.02;            // floor at 2% (no negative perpetual growth)
const DE_BAN = 1.0;             // D/E above 1.0 → Wayne skips

// Market → Yahoo symbol suffix
function yahooSymbol(symbol: string, market: MarketCode): string {
  if (market === "US") return symbol;
  if (market === "HK") return symbol.padStart(4, "0") + ".HK";
  if (market === "SG") return symbol + ".SI";
  if (market === "MY") return symbol + ".KL";
  if (market === "JP") return symbol + ".T";
  if (market === "AU") return symbol + ".AX";
  return symbol;
}

interface YahooQS {
  quoteSummary?: { result?: Array<Record<string, any>> };
}

interface YahooQ {
  quoteResponse?: { result?: Array<Record<string, any>> };
}

function num(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object" && typeof v.raw === "number") return v.raw;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchYahoo(symbol: string): Promise<{
  price: number | null;
  longName: string | null;
  currency: string | null;
  forwardPE: number | null;
  trailingPE: number | null;
  epsForward: number | null;
  epsTrailing: number | null;
  beta: number | null;
  sharesOut: number | null;
  totalDebt: number | null;
  totalCash: number | null;
  marketCap: number | null;
  operatingCashFlow: number | null;
  capex: number | null;
  freeCashFlow: number | null;
  earningsGrowth: number | null;
  revenueGrowth: number | null;
  totalEquity: number | null;
}> {
  const modules = [
    "price", "summaryDetail", "defaultKeyStatistics", "financialData",
    "cashflowStatementHistory", "balanceSheetHistory",
  ].join(",");
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json",
  };

  const qsUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;
  const qUrl  = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;

  const [qsRes, qRes] = await Promise.allSettled([
    fetch(qsUrl, { headers, cache: "no-store" }).then((r) => r.ok ? r.json() : null),
    fetch(qUrl,  { headers, cache: "no-store" }).then((r) => r.ok ? r.json() : null),
  ]);

  const qs: YahooQS | null = qsRes.status === "fulfilled" ? qsRes.value : null;
  const q:  YahooQ  | null = qRes.status  === "fulfilled" ? qRes.value  : null;

  const r0 = qs?.quoteSummary?.result?.[0] ?? {};
  const pr = r0.price ?? {};
  const sd = r0.summaryDetail ?? {};
  const ks = r0.defaultKeyStatistics ?? {};
  const fd = r0.financialData ?? {};
  const cf = r0.cashflowStatementHistory?.cashflowStatements ?? [];
  const bs = r0.balanceSheetHistory?.balanceSheetStatements ?? [];
  const qv = q?.quoteResponse?.result?.[0] ?? {};

  // Latest annual cashflow row
  const latestCF = cf[0] ?? {};
  const opCF   = num(latestCF.totalCashFromOperatingActivities);
  const capex  = num(latestCF.capitalExpenditures); // Yahoo reports as negative
  const fcf    = opCF != null && capex != null ? opCF + capex : num(fd.freeCashflow);

  const latestBS = bs[0] ?? {};
  const totalEq  = num(latestBS.totalStockholderEquity);

  return {
    price: num(pr.regularMarketPrice) ?? num(fd.currentPrice) ?? num(qv.regularMarketPrice),
    longName: pr.longName || pr.shortName || qv.longName || qv.shortName || null,
    currency: pr.currency || qv.currency || null,
    forwardPE: num(ks.forwardPE) ?? num(sd.forwardPE) ?? num(qv.forwardPE),
    trailingPE: num(sd.trailingPE) ?? num(qv.trailingPE),
    epsForward: num(ks.forwardEps) ?? num(qv.epsForward),
    epsTrailing: num(ks.trailingEps) ?? num(qv.epsTrailingTwelveMonths),
    beta: num(ks.beta) ?? num(sd.beta),
    sharesOut: num(ks.sharesOutstanding) ?? num(qv.sharesOutstanding),
    totalDebt: num(fd.totalDebt),
    totalCash: num(fd.totalCash),
    marketCap: num(pr.marketCap) ?? num(sd.marketCap) ?? num(qv.marketCap),
    operatingCashFlow: opCF,
    capex: capex,
    freeCashFlow: fcf,
    earningsGrowth: num(fd.earningsGrowth),
    revenueGrowth: num(fd.revenueGrowth),
    totalEquity: totalEq,
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = (sp.get("symbol") || "").trim().toUpperCase();
  const market = (sp.get("market") || "US").toUpperCase() as MarketCode;
  if (!symbol) return NextResponse.json({ error: "missing symbol" }, { status: 400 });

  const ySym = yahooSymbol(symbol, market);
  let data;
  try { data = await fetchYahoo(ySym); }
  catch (e: any) { return NextResponse.json({ error: `yahoo fetch failed: ${String(e?.message || e)}` }, { status: 502 }); }

  if (data.price == null) {
    return NextResponse.json({ error: `no quote for ${symbol}` }, { status: 404 });
  }

  // ─── Debt check (Wayne's ban rule) ───────────────────────────────────
  // Use D/E vs equity when available, otherwise fall back to debt / market cap.
  let debtRatio: number | null = null;
  let debtDenomLabel = "equity";
  if (data.totalDebt != null && data.totalEquity != null && data.totalEquity > 0) {
    debtRatio = data.totalDebt / data.totalEquity;
    debtDenomLabel = "equity";
  } else if (data.totalDebt != null && data.marketCap != null && data.marketCap > 0) {
    debtRatio = data.totalDebt / data.marketCap;
    debtDenomLabel = "market cap";
  }
  const banned = debtRatio != null && debtRatio > DE_BAN;

  // ─── Discount rate (CAPM) ────────────────────────────────────────────
  const beta = data.beta ?? 1.0;
  const discountRate = RISK_FREE + beta * EQUITY_PREMIUM;

  // ─── Growth rate (bounded, favour earnings growth) ───────────────────
  const rawG =
    data.earningsGrowth != null && Number.isFinite(data.earningsGrowth) ? data.earningsGrowth :
    data.revenueGrowth != null && Number.isFinite(data.revenueGrowth) ? data.revenueGrowth :
    0.08;
  const growth = clamp(rawG, MIN_G1, MAX_G1);

  // ─── 5-year explicit DCF + terminal ──────────────────────────────────
  const fcf0 = data.freeCashFlow;
  let intrinsicPerShare: number | null = null;
  const projections: Array<{ year: number; fcf: number; pv: number }> = [];
  let terminalValue: number | null = null;
  let terminalPV: number | null = null;
  let totalEnterpriseValue: number | null = null;

  if (fcf0 != null && fcf0 > 0 && data.sharesOut != null && data.sharesOut > 0) {
    let sumPV = 0;
    let lastFCF = fcf0;
    for (let t = 1; t <= EXPLICIT_YEARS; t++) {
      const fcfT = fcf0 * Math.pow(1 + growth, t);
      const pv = fcfT / Math.pow(1 + discountRate, t);
      sumPV += pv;
      lastFCF = fcfT;
      projections.push({ year: t, fcf: fcfT, pv });
    }
    terminalValue = lastFCF * (1 + TERMINAL_GROWTH) / (discountRate - TERMINAL_GROWTH);
    terminalPV = terminalValue / Math.pow(1 + discountRate, EXPLICIT_YEARS);
    totalEnterpriseValue = sumPV + terminalPV;
    // Net cash adjustment
    const netCash = (data.totalCash ?? 0) - (data.totalDebt ?? 0);
    const equityValue = totalEnterpriseValue + netCash;
    intrinsicPerShare = equityValue / data.sharesOut;
  }

  // ─── 12-month future value (forward P/E × forward EPS) ───────────────
  const futureValue12m =
    data.epsForward != null && data.forwardPE != null
      ? data.epsForward * data.forwardPE
      : null;

  // ─── Wayne's target (blended, with safety discount) ──────────────────
  let waynesTarget: number | null = null;
  if (intrinsicPerShare != null && futureValue12m != null) {
    waynesTarget = (0.5 * intrinsicPerShare + 0.5 * futureValue12m) * (1 - WAYNE_MARGIN);
  } else if (futureValue12m != null) {
    waynesTarget = futureValue12m * (1 - WAYNE_MARGIN);
  } else if (intrinsicPerShare != null) {
    waynesTarget = intrinsicPerShare * (1 - WAYNE_MARGIN);
  }

  // ─── Verdict ─────────────────────────────────────────────────────────
  // Upside = Wayne's target vs. current price. For structured notes, we
  // like downside protection → prefer high upside AND non-banned.
  let verdict: "LAUNCH" | "WATCH" | "AVOID" | "SKIP" = "WATCH";
  if (banned) verdict = "SKIP";
  else if (waynesTarget != null && data.price != null) {
    const upside = (waynesTarget - data.price) / data.price;
    verdict = upside >= 0.20 ? "LAUNCH" : upside >= 0.05 ? "WATCH" : "AVOID";
  }

  return NextResponse.json({
    symbol, market, ySymbol: ySym,
    longName: data.longName,
    currency: data.currency,
    price: data.price,
    marketCap: data.marketCap,
    inputs: {
      beta,
      forwardPE: data.forwardPE,
      trailingPE: data.trailingPE,
      epsForward: data.epsForward,
      epsTrailing: data.epsTrailing,
      freeCashFlow: data.freeCashFlow,
      operatingCashFlow: data.operatingCashFlow,
      capex: data.capex,
      sharesOut: data.sharesOut,
      totalDebt: data.totalDebt,
      totalCash: data.totalCash,
      totalEquity: data.totalEquity,
      earningsGrowth: data.earningsGrowth,
      revenueGrowth: data.revenueGrowth,
    },
    assumptions: {
      riskFree: RISK_FREE,
      equityPremium: EQUITY_PREMIUM,
      terminalGrowth: TERMINAL_GROWTH,
      wayneMargin: WAYNE_MARGIN,
      explicitYears: EXPLICIT_YEARS,
      growthUsed: growth,
      growthSource:
        data.earningsGrowth != null && Number.isFinite(data.earningsGrowth) ? "earningsGrowth" :
        data.revenueGrowth != null && Number.isFinite(data.revenueGrowth) ? "revenueGrowth" : "default-8%",
      debtDenomLabel,
      banThreshold: DE_BAN,
    },
    computed: {
      discountRate,
      growth,
      projections,
      terminalValue,
      terminalPV,
      enterpriseValue: totalEnterpriseValue,
      intrinsicPerShare,
      futureValue12m,
      waynesTarget,
      debtRatio,
      banned,
      verdict,
      upsidePct: waynesTarget != null && data.price ? ((waynesTarget - data.price) / data.price) * 100 : null,
    },
    generatedAt: new Date().toISOString(),
  }, { headers: { "cache-control": "no-store" } });
}
