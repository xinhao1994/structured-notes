// Calculation engine — all the math that drives the dashboard, table, KO
// schedule, calculator and risk widgets. Pure functions; no side effects;
// no I/O. Easy to unit-test.

import { addMonthsBizSnap } from "./markets";
import type {
  Currency,
  KoObservation,
  PriceQuote,
  RiskAssessment,
  RiskBand,
  Tranche,
  Underlying,
} from "./types";

/** Strike price per underlying = initial × strike%. */
export function strikePrices(t: Tranche): Record<string, number> {
  if (!t.initialFixing) return {};
  const out: Record<string, number> = {};
  for (const u of t.underlyings) {
    const init = t.initialFixing[u.symbol];
    if (init != null) out[u.symbol] = round(init * t.strikePct);
  }
  return out;
}

/** EKI / barrier price per underlying = initial × EKI%. */
export function ekiPrices(t: Tranche): Record<string, number> {
  if (!t.initialFixing) return {};
  const out: Record<string, number> = {};
  for (const u of t.underlyings) {
    const init = t.initialFixing[u.symbol];
    if (init != null) out[u.symbol] = round(init * t.ekiPct);
  }
  return out;
}

/**
 * Generate the full KO observation schedule.
 *
 * For an N-month, monthly-observed autocallable with KO start = K0 and
 * stepdown s, observations are at months 1..N and the KO trigger at obs i is:
 *   max(strike%, K0 - (i-1) * s)
 * (i.e. you don't step below the strike)
 *
 * If `koObsFreqMonths > 1` we observe less frequently.
 */
export function koSchedule(t: Tranche): KoObservation[] {
  const obs: KoObservation[] = [];
  const freq = Math.max(1, t.koObsFreqMonths);
  const total = Math.floor(t.tenorMonths / freq);
  for (let i = 1; i <= total; i++) {
    const koPct = Math.max(t.strikePct, t.koStartPct - (i - 1) * t.koStepdownPct);
    const date = addMonthsBizSnap(t.tradeDate, i * freq, t.underlyings[0]?.market ?? "US");
    const koPriceBySymbol: Record<string, number> = {};
    if (t.initialFixing) {
      for (const u of t.underlyings) {
        const init = t.initialFixing[u.symbol];
        if (init != null) koPriceBySymbol[u.symbol] = round(init * koPct);
      }
    }
    obs.push({ n: i, date, koPct, koPriceBySymbol });
  }
  return obs;
}

/** The "live" KO trigger — the next upcoming KO observation. */
export function currentKoLevel(t: Tranche, today: Date = new Date()): KoObservation | null {
  const sched = koSchedule(t);
  const todayStr = today.toISOString().slice(0, 10);
  return sched.find((o) => o.date >= todayStr) ?? sched[sched.length - 1] ?? null;
}

/** Apply live quotes (and indicative-vs-actual fixing) and produce row data. */
export function tableRows(t: Tranche, quotes: Record<string, PriceQuote | undefined>) {
  const ko = currentKoLevel(t);
  return t.underlyings.map((u) => {
    const q = quotes[u.symbol];
    const initial = t.initialFixing?.[u.symbol];
    const strike = initial != null ? initial * t.strikePct : undefined;
    const eki = initial != null ? initial * t.ekiPct : undefined;
    const koPx = ko && initial != null ? initial * ko.koPct : undefined;
    return {
      underlying: u,
      live: q?.price,
      prevClose: q?.prevClose,
      high52: q?.high52,
      low52: q?.low52,
      eki: eki !== undefined ? round(eki) : undefined,
      strike: strike !== undefined ? round(strike) : undefined,
      ko: koPx !== undefined ? round(koPx) : undefined,
      asOf: q?.asOf,
      source: q?.source,
      currency: q?.currency,
      initial: initial !== undefined ? round(initial) : undefined,
    };
  });
}

/** "Worst-of" risk view: which underlying is closest to KI (the dangerous bound). */
export function assessRisk(
  t: Tranche,
  quotes: Record<string, PriceQuote | undefined>
): RiskAssessment | null {
  if (!t.initialFixing) return null;
  let worst: { sym: string; pctAboveKi: number; pctToKo: number } | null = null;
  const ko = currentKoLevel(t);
  for (const u of t.underlyings) {
    const q = quotes[u.symbol];
    const init = t.initialFixing[u.symbol];
    if (q?.price == null || init == null) continue;
    const ki = init * t.ekiPct;
    const koPx = ko ? init * ko.koPct : init * t.koStartPct;
    const pctAboveKi = (q.price - ki) / q.price * 100;       // smaller = worse
    const pctToKo = (koPx - q.price) / q.price * 100;        // smaller (incl. negative) = closer to KO
    if (!worst || pctAboveKi < worst.pctAboveKi) {
      worst = { sym: u.symbol, pctAboveKi, pctToKo };
    }
  }
  if (!worst) return null;

  const band: RiskBand =
    worst.pctAboveKi <= 0 ? "critical"
    : worst.pctAboveKi < 5 ? "near-ki"
    : worst.pctToKo <= 0 ? "near-ko"          // through KO from above (auto-call imminent)
    : worst.pctAboveKi < 15 ? "high-risk"
    : worst.pctAboveKi < 30 ? "moderate"
    : "safe";

  const rationale =
    band === "critical" ? `Worst-of (${worst.sym}) is below knock-in barrier — capital at risk.`
    : band === "near-ki" ? `Worst-of (${worst.sym}) is within 5% of KI — monitor closely.`
    : band === "near-ko" ? `Worst-of (${worst.sym}) is at/above current KO — auto-call possible at next observation.`
    : band === "high-risk" ? `Worst-of (${worst.sym}) is within 15% of KI.`
    : band === "moderate" ? `Worst-of (${worst.sym}) cushion is 15–30% above KI.`
    : `All underlyings >30% above KI — safe zone.`;

  return { band, worstSymbol: worst.sym, pctAboveKi: round(worst.pctAboveKi, 2), pctToKo: round(worst.pctToKo, 2), rationale };
}

// ─── client calculator ───────────────────────────────────────────────────────

export const MIN_LOT: Record<Currency, number> = {
  AUD: 17_500,
  USD: 12_500,
  SGD: 17_500,
  HKD: 100_000,
  MYR: 50_000,
  JPY: 1_500_000,
};

/** Validate principal against minimum lot. Returns null when OK. */
export function validateLot(currency: Currency, principal: number): string | null {
  const min = MIN_LOT[currency];
  if (principal < min) {
    return `Below minimum lot for ${currency} (${formatCcy(currency, min)}).`;
  }
  if (principal % 1 !== 0) return "Principal must be a whole number.";
  return null;
}

export interface CalcSummary {
  principal: number;
  currency: Currency;
  monthlyCoupon: number;
  totalCoupon: number;
  annualizedReturnPct: number;
  estimatedPayout: number;        // principal + total coupon (best case, no KI)
  worstCasePayout: number;        // principal × (final / initial) on KI breach (worst stylised)
}

/**
 * Coupons are paid monthly (industry default for this product family) at
 * couponPa / 12 of principal, regardless of underlyings — until the note
 * either KOs (early redemption) or matures.
 *
 * For the "estimated" view we assume the note runs to maturity and pays all
 * coupons. This matches how dealers quote indicative returns to clients.
 */
export function clientCalc(t: Tranche, currency: Currency, principal: number): CalcSummary {
  const monthly = principal * (t.couponPa / 12);
  const total = monthly * t.tenorMonths;
  const annualized = (total / principal) * (12 / t.tenorMonths) * 100;
  return {
    principal,
    currency,
    monthlyCoupon: round(monthly, 2),
    totalCoupon: round(total, 2),
    annualizedReturnPct: round(annualized, 2),
    estimatedPayout: round(principal + total, 2),
    worstCasePayout: round(principal * t.ekiPct + total, 2),
  };
}

// ─── KO probability heuristic ────────────────────────────────────────────────
/**
 * Lightweight KO-probability gauge for the dashboard. Not a Monte-Carlo —
 * this is a UI heuristic that combines (a) cushion above current KO, (b)
 * stepdown schedule remaining, and (c) volatility approximation from
 * 52-week range.
 *
 * Output: 0–100. Bigger = more likely to KO before maturity.
 */
export function koProbabilityHeuristic(
  t: Tranche,
  quotes: Record<string, PriceQuote | undefined>
): number {
  if (!t.initialFixing) return 0;
  const ko = currentKoLevel(t);
  if (!ko) return 0;
  const remainingObs = koSchedule(t).filter((o) => o.date >= new Date().toISOString().slice(0, 10)).length;
  let score = 0;
  let n = 0;
  for (const u of t.underlyings) {
    const q = quotes[u.symbol];
    const init = t.initialFixing[u.symbol];
    if (!q || init == null) continue;
    const cushion = (q.price - init * ko.koPct) / (init * ko.koPct);   // signed cushion above KO
    const range = q.high52 && q.low52 ? (q.high52 - q.low52) / q.price : 0.4;
    // closer to KO + more vol + more remaining observations → higher prob
    const cap = clamp01(0.5 + cushion * 1.2);                 // base ≈ 50%, cushion shifts it
    const volBoost = clamp01(range / 1.5);                    // cap at ~150% range = 1.0
    const tenorBoost = clamp01(remainingObs / 12);            // 12 obs caps at 1.0
    score += (1 - cap) * 0.7 + volBoost * 0.15 + tenorBoost * 0.15;
    n++;
  }
  if (!n) return 0;
  return Math.round((score / n) * 100);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function round(n: number, d = 4): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
export function formatCcy(ccy: Currency, n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: ccy,
    maximumFractionDigits: ccy === "JPY" ? 0 : 2,
  }).format(n);
}
export function formatPx(n: number | undefined, ccy?: string): string {
  if (n == null || !isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: ccy === "JPY" || n > 1000 ? 2 : 4,
  }).format(n);
}
