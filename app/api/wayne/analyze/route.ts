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

// Debt Gate — graduated, calibrated against real-world names:
//   • ORACLE  Net Debt $135B, FCF −$23B → HARD BAN
//   • INTEL   Net Debt ~$30B, FCF cyclically near zero → bearable, PASS with caution
//   • DELL    Net Debt ~$20B, FCF ~$8.5B (D/FCF 2.4x), negative equity → PASS
//   • MRVL    Net cash → PASS
//
// Rules (any ONE triggers the ban):
//   (a) D/FCF > 5x  (was 3x — too tight, banned DELL/INTEL unnecessarily)
//   (b) D/E > 500% (was 300% — too tight for buyback-heavy balance sheets)
//   (c) Negative FCF AND Net Debt > $50B  (Oracle catastrophic case only)
//   (d) FCF loss > $15B/year AND Net Debt > $30B  (sustained cash burn)
//
// The hyper-growth exemption (revenueGrowth > 40%) overrides (c) and (d) —
// CoreWeave type names where the burn is growth capex, not operating distress.
const NET_DEBT_TO_FCF_BAN = 5.0;
const NET_DEBT_TO_EQUITY_BAN = 5.0;
const CATASTROPHIC_DEBT_USD = 50_000_000_000; // $50B
const SUSTAINED_FCF_LOSS_USD = -15_000_000_000; // -$15B
const SIZEABLE_DEBT_USD = 30_000_000_000; // $30B

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
    freeCashflow?: number | null;
    operatingCashflow?: number | null;
    debtToEquityYahoo?: number | null;
    currentRatio?: number | null;
    quickRatio?: number | null;
    cashflowOpCF?: number | null;
    cashflowCapex?: number | null;
    cashflowFCF?: number | null;
    totalStockholderEquity?: number | null;
    totalRevenueTTM?: number | null;
    enterpriseToRevenueTTM?: number | null;
  };
  warnings?: string[];
  error?: string;
}

// Target EV/Sales multiples by growth bucket. Pre-profit growth names
// (CRWV, PLTR early, SNOW, SHOP, SPOT early) are valued on sales because
// earnings are temporarily suppressed by capex / S&M intensity.
function targetEvSalesMultiple(revenueGrowth: number | null, profitMargin: number | null): { market: number; wayne: number } {
  // Hyper-growth (>40% YoY): priced like premium cloud → 10x market, 8x Wayne
  // High-growth (20-40%):    7x market, 5.5x Wayne
  // Moderate (10-20%):       4x market, 3x Wayne
  // Slow (<10%):             2x market, 1.5x Wayne
  const g = revenueGrowth ?? 0.1;
  let market: number;
  if (g > 0.40) market = 10;
  else if (g > 0.20) market = 7;
  else if (g > 0.10) market = 4;
  else market = 2;
  // Already-profitable names (positive margin) deserve a bump; cash-burners get the raw rate
  if (profitMargin != null && profitMargin > 0.10) market *= 1.2;
  return { market, wayne: market * 0.80 }; // Wayne even more conservative here (20% haircut)
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
  // Two independent rules — EITHER triggers a ban:
  //   (a) Net Debt / Annual FCF > 3x  — can't service debt from cashflow
  //   (b) Net Debt / Equity > 300%    — balance sheet is dangerously levered
  //
  // Edge cases that caught the original Oracle/Dell bugs:
  //   • Oracle burns cash (FCF = -$23B) with $135B net debt → the naive
  //     ratio is NEGATIVE (passes a `> 3` check falsely). Negative FCF
  //     with positive net debt is itself the worst possible state → BAN.
  //   • Dell's Yahoo totalDebt INCLUDES DFS customer-financing debt that
  //     is self-liquidating. Yahoo's own normalized `debtToEquity` from
  //     defaultKeyStatistics (reported as PERCENT, e.g. 250 = 2.5x) is the
  //     correct number to gate on. We prefer that over the raw calculation.

  const totalDebt = f.totalDebt ?? 0;
  const totalCash = f.totalCash ?? 0;
  const netDebt = totalDebt - totalCash;
  const annualFCF = fcf; // FCF resolved above
  const equity = f.totalStockholderEquity;
  const cashRich = netDebt <= 0;

  // ── Rule (a): Net Debt / FCF ──
  let debtToFCF: number | null = null;
  let fcfGateReason: string | null = null;
  if (cashRich) {
    // Net cash position — nothing to service, pass automatically.
    debtToFCF = netDebt !== 0 && annualFCF != null && annualFCF !== 0
      ? netDebt / annualFCF
      : 0;
  } else if (annualFCF == null) {
    // No FCF data at all — can't evaluate this rule; don't ban on absence.
    debtToFCF = null;
  } else if (annualFCF <= 0) {
    // Negative/zero FCF with positive net debt: graduated response.
    //   • Hyper-growth exemption (revGrowth > 40%): CoreWeave-style
    //     growth-capex burn — warn but don't ban.
    //   • Catastrophic case: Net Debt > $50B OR annual FCF loss < −$15B
    //     with debt > $30B → BAN (Oracle fits here).
    //   • Otherwise: INTEL-style cyclical dip → bearable WARNING, no ban.
    const hyperGrowth = (f.revenueGrowth ?? 0) > 0.40;
    debtToFCF = Number.POSITIVE_INFINITY;
    const catastrophic =
      netDebt > CATASTROPHIC_DEBT_USD ||
      (annualFCF < SUSTAINED_FCF_LOSS_USD && netDebt > SIZEABLE_DEBT_USD);

    if (hyperGrowth) {
      fcfGateReason = null;
      warnings.push(`Growth-stage exemption: FCF is negative (${(annualFCF / 1_000_000_000).toFixed(1)}B) but revenue growing ${((f.revenueGrowth ?? 0) * 100).toFixed(0)}% YoY — treated as growth capex, not operating distress. Still risky for ELI exposure.`);
    } else if (catastrophic) {
      fcfGateReason = annualFCF < 0
        ? `Catastrophic: FCF ${(annualFCF / 1_000_000_000).toFixed(1)}B (NEGATIVE) with ${(netDebt / 1_000_000_000).toFixed(0)}B of net debt — company burns cash on a scale debt cannot absorb (Oracle class).`
        : `Catastrophic: zero FCF with ${(netDebt / 1_000_000_000).toFixed(0)}B of net debt.`;
    } else {
      // Bearable — INTEL cyclical dip. Note but no ban.
      fcfGateReason = null;
      warnings.push(`FCF cyclically negative (${(annualFCF / 1_000_000_000).toFixed(1)}B) but net debt (${(netDebt / 1_000_000_000).toFixed(1)}B) is manageable — borderline, Wayne tolerates but keep an eye on it.`);
    }
  } else {
    debtToFCF = netDebt / annualFCF;
    if (debtToFCF > NET_DEBT_TO_FCF_BAN) {
      fcfGateReason = `Net Debt / FCF = ${debtToFCF.toFixed(2)}x (> ${NET_DEBT_TO_FCF_BAN}x limit)`;
    }
  }

  // ── Rule (b): Net Debt / Equity ──
  // Prefer Yahoo's normalized debtToEquity from defaultKeyStatistics (it
  // excludes financing-arm debt like DELL's DFS book). Yahoo reports
  // percent (250 = 2.5x), so divide by 100 to get the ratio.
  //
  // Sanity ceiling: when a company has done massive buybacks (DELL, MCD,
  // SBUX, HD, AZO, DPZ, LMT, PM, etc.), their stockholder equity turns
  // negative or near-zero. The D/E ratio then becomes mathematically huge
  // (3000%+, 10,000%+) and meaningless — it does NOT indicate real
  // leverage, just that returned-to-shareholder capital exceeds retained
  // earnings. Debt-to-FCF is the honest gauge for these names. So if the
  // reported D/E is above 10× (1000%), we DROP it and gate on D/FCF only.
  const D_E_SANITY_CEILING = 10;
  let debtToEquity: number | null = null;
  let debtToEquitySource: "yahoo-normalized" | "raw-computed" | "unavailable" | "ignored-distorted" = "unavailable";
  if (f.debtToEquityYahoo != null && Number.isFinite(f.debtToEquityYahoo)) {
    const yahooDE = f.debtToEquityYahoo / 100;
    if (yahooDE > D_E_SANITY_CEILING) {
      // Negative/near-zero equity from buybacks — ratio not meaningful
      debtToEquity = null;
      debtToEquitySource = "ignored-distorted";
      warnings.push(`Equity-ratio skipped: Yahoo reports D/E = ${(yahooDE * 100).toFixed(0)}%, which signals negative or near-zero book equity (common for buyback-heavy co's like DELL). Debt-to-FCF is the honest gauge; using that alone.`);
    } else {
      debtToEquity = yahooDE;
      debtToEquitySource = "yahoo-normalized";
    }
  } else if (equity != null && equity > 0) {
    debtToEquity = netDebt / equity;
    debtToEquitySource = "raw-computed";
  }
  let equityGateReason: string | null = null;
  if (debtToEquity != null && debtToEquity > NET_DEBT_TO_EQUITY_BAN) {
    equityGateReason = `Debt / Equity = ${(debtToEquity * 100).toFixed(0)}% (> ${NET_DEBT_TO_EQUITY_BAN * 100}% limit)`;
  }

  const banReasons: string[] = [];
  if (fcfGateReason) banReasons.push(fcfGateReason);
  if (equityGateReason) banReasons.push(equityGateReason);
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

  // ─── EV/Sales fallback (for pre-profit growth names) ────────────────
  const peMethodFailed = ourIntrinsicValue == null || (f.epsForward != null && f.epsForward <= 0);
  const evSalesMultiples = targetEvSalesMultiple(f.revenueGrowth ?? null, f.profitMargin ?? null);
  let ourEvSalesIV: number | null = null;
  let waynesEvSalesIV: number | null = null;
  let ourEvSalesFV: number | null = null;    // 12M forward on next-year revenue
  let waynesEvSalesFV: number | null = null;
  let evSalesUsed = false;
  if (f.totalRevenueTTM != null && f.totalRevenueTTM > 0 && f.sharesOutstanding) {
    const netCash = (f.totalCash ?? 0) - (f.totalDebt ?? 0);
    ourEvSalesIV   = (evSalesMultiples.market * f.totalRevenueTTM + netCash) / f.sharesOutstanding;
    waynesEvSalesIV = (evSalesMultiples.wayne * f.totalRevenueTTM + netCash) / f.sharesOutstanding;
    const nextYearRev = f.totalRevenueTTM * (1 + growth);
    ourEvSalesFV   = (evSalesMultiples.market * nextYearRev + netCash) / f.sharesOutstanding;
    waynesEvSalesFV = (evSalesMultiples.wayne * nextYearRev + netCash) / f.sharesOutstanding;
    if (peMethodFailed) evSalesUsed = true;
  }

  // ─── Wayne's Target Price = Wayne's FUTURE value (12M) ───────────────
  // CRITICAL fix: using Wayne's current IV (= Forward EPS × Market PE × 0.85)
  // meant every stock trading at market multiple showed a mechanical −15%
  // "richly priced" verdict — pure artefact of the haircut, not a real
  // signal. Wayne's actual investable target is the FUTURE price: next-
  // year EPS × Wayne's PE. For a growing stock, that lands ABOVE current;
  // for a flat/declining one it stays below — which is the real signal.
  const waynesTarget = evSalesUsed
    ? (waynesEvSalesFV ?? waynesEvSalesIV)
    : (waynesFutureValue ?? waynesEvSalesFV ?? waynesIntrinsicValue);
  const effectiveOurIV = ourIntrinsicValue ?? ourEvSalesIV;

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
      // EV/Sales fallback (for pre-profit growth names like CRWV)
      ourEvSalesIV,
      waynesEvSalesIV,
      ourEvSalesFV,
      waynesEvSalesFV,
      evSalesMarketMultiple: evSalesMultiples.market,
      evSalesWayneMultiple: evSalesMultiples.wayne,
      evSalesUsed,
      peMethodFailed,
      // Legacy aliases (kept so the current page keeps working)
      intrinsicPerShare: effectiveOurIV,
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
      debtToEquitySource,
      cashRich,
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
