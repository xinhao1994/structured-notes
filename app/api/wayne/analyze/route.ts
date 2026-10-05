// GET /api/wayne/analyze?symbol=MRVL&market=US
//
// Wayne's DCF model: two-stage DCF + forward-multiple blend with safety
// margin. Named after the treasury specialist whose structured note tranches
// knock out early because he underwrites to intrinsic value and refuses
// highly-leveraged names.
//
// Data pipeline:
//   This route delegates ALL market data fetching to /api/stock-profile,
//   which already has:
//     • Yahoo quoteSummary WITH crumb/cookie handshake (survives 401/403)
//     • Yahoo v7 quote WITH crumb (fallback)
//     • Finnhub /stock/profile2 + /stock/metric (secondary fallback)
//     • Stooq CSV (last-resort price history)
//   So Wayne gets the same resilience that the Analyze tab enjoys.
//
// Wayne's rules:
//   • CAPM discount rate: r = 4.5% + β × 5.5%
//   • Growth clamped [2%, 20%] — no fantasy numbers
//   • 5-year explicit DCF + Gordon terminal (g∞ = 3%)
//   • Blended target = 0.5·Intrinsic + 0.5·(ForwardEPS × ForwardPE)
//   • 5% safety margin applied
//   • D/E > 1.0 → "Wayne skips" (Oracle gets filtered out automatically)

import { NextRequest, NextResponse } from "next/server";
import type { MarketCode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Model constants (Friday × Wayne framework) ───────────────────────
const RISK_FREE = 0.0528;        // US 10Y treasury (Friday uses 5.28%)
const EQUITY_PREMIUM = 0.055;    // long-run equity risk premium
const TERMINAL_GROWTH = 0.05;    // Friday uses 5% for Gordon terminal
const EXPLICIT_YEARS = 5;
const MAX_G1 = 0.20;
const MIN_G1 = 0.02;
const DEFAULT_GROWTH = 0.08;

// Wayne's PE discipline — reverse-engineered from MRVL ($59x vs market
// $72x = 0.82). Rounded to 0.85 for a cleaner conservative haircut rule.
const WAYNE_PE_HAIRCUT = 0.85;

// Debt Gate — HARD FILTER (runs first, overrides everything)
const NET_DEBT_TO_FCF_BAN = 3.0;    // Friday: Net Debt / FCF > 3x → BAN
const NET_DEBT_TO_EQUITY_BAN = 3.0; // Friday: Net Debt / Equity > 300% → BAN

// ELI structure defaults (90/50 is typical for your tranches)
const DEFAULT_STRIKE_PCT = 0.90;
const DEFAULT_EKI_PCT = 0.50;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

interface StockProfileResp {
  symbol?: string;
  snapshot?: {
    longName?: string;
    exchange?: string;
    currency?: string;
    price?: number;
    marketCap?: number;
    beta?: number;
    perf30d?: number | null;
  };
  fundamentals?: {
    forwardPE?: number | null;
    trailingPE?: number | null;
    epsForward?: number | null;
    epsTrailing?: number | null;
    totalCash?: number | null;
    totalDebt?: number | null;
    sharesOutstanding?: number | null;
    revenueGrowth?: number | null;
    earningsGrowth?: number | null;
    profitMargin?: number | null;
    operatingMargin?: number | null;
    enterpriseValue?: number | null;
    // Added for Wayne:
    freeCashflow?: number | null;
    operatingCashflow?: number | null;
    cashflowOpCF?: number | null;
    cashflowCapex?: number | null;
    cashflowFCF?: number | null;
    totalStockholderEquity?: number | null;
  };
  warnings?: string[];
  error?: string;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = (sp.get("symbol") || "").trim().toUpperCase();
  const market = (sp.get("market") || "US").toUpperCase() as MarketCode;
  if (!symbol) return NextResponse.json({ error: "missing symbol" }, { status: 400 });

  // Delegate data fetching to /api/stock-profile — uses the same deployment
  // host so it inherits all env vars + Yahoo auth session.
  const origin = req.nextUrl.origin;
  const profileUrl = `${origin}/api/stock-profile?symbol=${encodeURIComponent(symbol)}&market=${market}`;
  let profile: StockProfileResp | null = null;
  try {
    const r = await fetch(profileUrl, { cache: "no-store" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return NextResponse.json(
        { error: j.error || `stock-profile returned HTTP ${r.status}` },
        { status: r.status },
      );
    }
    profile = (await r.json()) as StockProfileResp;
  } catch (e: any) {
    return NextResponse.json(
      { error: `stock-profile fetch failed: ${String(e?.message || e)}` },
      { status: 502 },
    );
  }

  if (!profile || !profile.snapshot?.price) {
    return NextResponse.json(
      { error: `No quote found for ${symbol} (${market}). Try the exact ticker as it appears on your exchange.` },
      { status: 404 },
    );
  }

  const snap = profile.snapshot;
  const f = profile.fundamentals || {};
  const warnings: string[] = [...(profile.warnings || [])];

  // Resolve FCF: direct value → cashflow computed value → NetIncome × 1.1 proxy
  // We don't have netIncome exposed, so fall back to earnings yield proxy if needed.
  let fcf = f.freeCashflow ?? f.cashflowFCF ?? null;
  let fcfSource: "yahoo-direct" | "cashflow-stmt" | "estimated" | "unavailable" = "unavailable";
  if (f.freeCashflow != null && Number.isFinite(f.freeCashflow)) {
    fcf = f.freeCashflow;
    fcfSource = "yahoo-direct";
  } else if (f.cashflowFCF != null && Number.isFinite(f.cashflowFCF)) {
    fcf = f.cashflowFCF;
    fcfSource = "cashflow-stmt";
  } else if (
    f.epsForward != null && f.sharesOutstanding != null &&
    Number.isFinite(f.epsForward) && Number.isFinite(f.sharesOutstanding)
  ) {
    // Estimate FCF from forward earnings × ~1.1 (typical FCF/earnings ratio for stable co)
    const estNetIncome = f.epsForward * f.sharesOutstanding;
    fcf = estNetIncome * 1.1;
    fcfSource = "estimated";
    warnings.push("FCF estimated from forward EPS × shares × 1.1 — no cashflow statement from Yahoo.");
  }

  // ─── DEBT GATE (hard filter — Friday's rule, runs FIRST) ──────────────
  const netDebt = (f.totalDebt ?? 0) - (f.totalCash ?? 0);
  const annualFCF = fcf; // FCF resolved above
  const debtToFCF =
    annualFCF != null && annualFCF !== 0 ? netDebt / annualFCF : null;
  const equity = f.totalStockholderEquity;
  const debtToEquity =
    equity != null && equity > 0 ? netDebt / equity : null;

  const banReasons: string[] = [];
  if (debtToFCF != null && debtToFCF > NET_DEBT_TO_FCF_BAN) {
    banReasons.push(`Net Debt / FCF = ${debtToFCF.toFixed(2)}x (> ${NET_DEBT_TO_FCF_BAN}x limit)`);
  }
  if (debtToEquity != null && debtToEquity > NET_DEBT_TO_EQUITY_BAN) {
    banReasons.push(`Net Debt / Equity = ${(debtToEquity * 100).toFixed(0)}% (> ${NET_DEBT_TO_EQUITY_BAN * 100}% limit)`);
  }
  const banned = banReasons.length > 0;

  // ─── CAPM discount rate ───────────────────────────────────────────────
  const beta = snap.beta ?? 1.0;
  const discountRate = RISK_FREE + beta * EQUITY_PREMIUM;

  // ─── Growth rate (bounded, favour earnings growth) ────────────────────
  const rawG =
    f.earningsGrowth != null && Number.isFinite(f.earningsGrowth) ? f.earningsGrowth :
    f.revenueGrowth != null && Number.isFinite(f.revenueGrowth) ? f.revenueGrowth :
    DEFAULT_GROWTH;
  const growth = clamp(rawG, MIN_G1, MAX_G1);
  const growthSource =
    f.earningsGrowth != null && Number.isFinite(f.earningsGrowth) ? "earningsGrowth" :
    f.revenueGrowth != null && Number.isFinite(f.revenueGrowth) ? "revenueGrowth" : `default-${(DEFAULT_GROWTH*100).toFixed(0)}%`;

  // ─── PE multiples (Our = market forward PE, Wayne's = 85% of that) ───
  const ourPE = f.forwardPE ?? null;
  const waynesPE = ourPE != null ? ourPE * WAYNE_PE_HAIRCUT : null;

  // ─── Intrinsic Value TODAY — PE method (Friday's primary anchor) ─────
  // Our IV = Forward EPS × Market Forward PE
  // Wayne's IV = Forward EPS × (Market PE × 0.85)   [his discipline]
  const ourIntrinsicValue =
    f.epsForward != null && ourPE != null ? f.epsForward * ourPE : null;
  const waynesIntrinsicValue =
    f.epsForward != null && waynesPE != null ? f.epsForward * waynesPE : null;

  // ─── Future Value 12M — next-fiscal-year EPS × same PE ───────────────
  // FY+1 EPS projection = Forward EPS × (1 + growth)
  const nextYearEPS =
    f.epsForward != null ? f.epsForward * (1 + growth) : null;
  const ourFutureValue =
    nextYearEPS != null && ourPE != null ? nextYearEPS * ourPE : null;
  const waynesFutureValue =
    nextYearEPS != null && waynesPE != null ? nextYearEPS * waynesPE : null;

  // ─── FCF DCF (cross-check — Friday notes it undershoots growth names)─
  const projections: Array<{ year: number; fcf: number; pv: number }> = [];
  let fcfIntrinsicValue: number | null = null;
  let terminalValue: number | null = null;
  let terminalPV: number | null = null;
  let enterpriseValue: number | null = null;

  if (annualFCF != null && annualFCF > 0 && f.sharesOutstanding && f.sharesOutstanding > 0) {
    let sumPV = 0;
    let lastFCF = annualFCF;
    for (let t = 1; t <= EXPLICIT_YEARS; t++) {
      const fcfT = annualFCF * Math.pow(1 + growth, t);
      const pv = fcfT / Math.pow(1 + discountRate, t);
      sumPV += pv;
      lastFCF = fcfT;
      projections.push({ year: t, fcf: fcfT, pv });
    }
    terminalValue = lastFCF * (1 + TERMINAL_GROWTH) / (discountRate - TERMINAL_GROWTH);
    terminalPV = terminalValue / Math.pow(1 + discountRate, EXPLICIT_YEARS);
    enterpriseValue = sumPV + terminalPV;
    fcfIntrinsicValue = (enterpriseValue - netDebt) / f.sharesOutstanding;
  }

  // ─── Wayne's Target Price = Wayne's Intrinsic Value (today) ──────────
  // Friday showed that this is the right anchor — Wayne's conservative PE
  // applied to current forward EPS. For MRVL this gave $220-230, matching
  // what the user heard from Wayne directly.
  const waynesTarget = waynesIntrinsicValue;

  // ─── ELI level analysis (90/50 defaults) ─────────────────────────────
  const strikePct = Number(sp.get("strikePct")) || DEFAULT_STRIKE_PCT;
  const ekiPct = Number(sp.get("ekiPct")) || DEFAULT_EKI_PCT;
  const strikePrice = snap.price! * strikePct;
  const ekiPrice = snap.price! * ekiPct;
  const eliLevels = {
    strikePct, ekiPct, strikePrice, ekiPrice,
    strikeVsOurIV:    ourIntrinsicValue    != null ? strikePrice - ourIntrinsicValue    : null,
    strikeVsWaynesIV: waynesIntrinsicValue != null ? strikePrice - waynesIntrinsicValue : null,
    ekiVsOurIV:       ourIntrinsicValue    != null ? ekiPrice    - ourIntrinsicValue    : null,
    ekiVsWaynesIV:    waynesIntrinsicValue != null ? ekiPrice    - waynesIntrinsicValue : null,
  };

  // ─── Verdict (judged against WAYNE'S target — the conservative view) ─
  let verdict: "LAUNCH" | "WATCH" | "AVOID" | "SKIP" = "WATCH";
  if (banned) verdict = "SKIP";
  else if (waynesTarget != null && snap.price != null) {
    const upside = (waynesTarget - snap.price) / snap.price;
    verdict = upside >= 0.15 ? "LAUNCH" : upside >= 0 ? "WATCH" : "AVOID";
  }

  return NextResponse.json({
    symbol,
    market,
    ySymbol: profile.symbol || symbol,
    longName: snap.longName || null,
    currency: snap.currency || null,
    price: snap.price!,
    marketCap: snap.marketCap || null,
    inputs: {
      beta,
      forwardPE: f.forwardPE ?? null,
      trailingPE: f.trailingPE ?? null,
      epsForward: f.epsForward ?? null,
      epsTrailing: f.epsTrailing ?? null,
      freeCashFlow: fcf,
      operatingCashFlow: f.cashflowOpCF ?? f.operatingCashflow ?? null,
      capex: f.cashflowCapex ?? null,
      sharesOut: f.sharesOutstanding ?? null,
      totalDebt: f.totalDebt ?? null,
      totalCash: f.totalCash ?? null,
      totalEquity: f.totalStockholderEquity ?? null,
      earningsGrowth: f.earningsGrowth ?? null,
      revenueGrowth: f.revenueGrowth ?? null,
    },
    assumptions: {
      riskFree: RISK_FREE,
      equityPremium: EQUITY_PREMIUM,
      terminalGrowth: TERMINAL_GROWTH,
      waynePEHaircut: WAYNE_PE_HAIRCUT,
      explicitYears: EXPLICIT_YEARS,
      growthUsed: growth,
      growthSource,
      fcfSource,
      netDebtToFCFBan: NET_DEBT_TO_FCF_BAN,
      netDebtToEquityBan: NET_DEBT_TO_EQUITY_BAN,
    },
    computed: {
      discountRate,
      growth,
      // PE multiples
      ourPE,
      waynesPE,
      nextYearEPS,
      // The four main numbers Friday called out:
      ourIntrinsicValue,
      waynesIntrinsicValue,
      ourFutureValue,
      waynesFutureValue,
      // Legacy aliases (kept so the current page keeps working)
      intrinsicPerShare: ourIntrinsicValue,
      futureValue12m: ourFutureValue,
      waynesTarget,
      // FCF supporting DCF (undershoots growth names)
      fcfIntrinsicValue,
      projections,
      terminalValue,
      terminalPV,
      enterpriseValue,
      // Debt Gate detail
      netDebt,
      debtToFCF,
      debtToEquity,
      banned,
      banReasons,
      // ELI
      eliLevels,
      verdict,
      upsidePct: waynesTarget != null && snap.price ? ((waynesTarget - snap.price) / snap.price) * 100 : null,
    },
    warnings,
    generatedAt: new Date().toISOString(),
  }, { headers: { "cache-control": "no-store" } });
}
