// Smoke test — exercises the parser, calc engine, market clock, and storage
// shape *without* needing npm packages. Run with:
//   node --experimental-strip-types scripts/smoke.mjs
//
// We only depend on Node ≥22 for TS type stripping. No build, no install.

import { parseTrancheText } from "../lib/parser.ts";
import {
  koSchedule, currentKoLevel, tableRows, assessRisk,
  clientCalc, validateLot, MIN_LOT, formatCcy, formatPx,
  koProbabilityHeuristic,
} from "../lib/calc.ts";
import {
  isMarketOpen, marketSnapshots, malaysiaNowParts,
  addBusinessDays, addMonthsBizSnap, MARKETS,
} from "../lib/markets.ts";
import { SAMPLE_TRANCHE_TEXT } from "../lib/sample.ts";

let pass = 0, fail = 0;
const log = (ok, name, extra = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? "  " + extra : ""}`);
};
const eq = (a, b, name) => log(a === b, name, a === b ? "" : `expected ${b}, got ${a}`);
const near = (a, b, eps, name) => log(Math.abs(a - b) < eps, name, Math.abs(a - b) < eps ? "" : `expected ≈${b}, got ${a}`);
const ok = (cond, name) => log(!!cond, name);

// ─── Parser ────────────────────────────────────────────────────────────────
const { tranche, warnings } = parseTrancheText(SAMPLE_TRANCHE_TEXT);
eq(tranche.issuer, "MSI", "parser: issuer");
eq(tranche.trancheCode, "MSIT260592", "parser: tranche code");
eq(tranche.currency, "MYR", "parser: currency from MYR + flag");
eq(tranche.tradeDate, "2026-05-12", "parser: trade date");
eq(tranche.tradeCutoff, "16:00", "parser: trade cutoff (4pm → 16:00)");
eq(tranche.settlementOffset, 7, "parser: settlement T+7");
eq(tranche.settlementDate, addBusinessDays("2026-05-12", 7, "US"), "parser: settlement = T+7 biz days");
eq(tranche.offeringStart, "2026-05-08", "parser: offering start");
eq(tranche.offeringEnd, "2026-05-12", "parser: offering end");
near(tranche.couponPa, 0.09, 1e-9, "parser: coupon 9% pa");
eq(tranche.tenorMonths, 11, "parser: tenor 11M");
near(tranche.strikePct, 1.0, 1e-9, "parser: strike 100%");
near(tranche.koStartPct, 1.08, 1e-9, "parser: KO start 108%");
near(tranche.koStepdownPct, 0.04, 1e-9, "parser: stepdown 4%");
near(tranche.ekiPct, 0.6, 1e-9, "parser: EKI 60%");
eq(tranche.underlyings.length, 3, "parser: 3 underlyings");
eq(tranche.underlyings.map(u => u.symbol).join(","), "TSM,AVGO,GOOGL", "parser: TSM, Broadcom→AVGO, Google→GOOGL");
eq(tranche.underlyings.every(u => u.market === "US"), true, "parser: all US market");
eq(warnings.length, 0, "parser: no warnings on canonical sample");

// ─── KO schedule + stepdown ────────────────────────────────────────────────
const t = { ...tranche, initialFixing: { TSM: 200, AVGO: 1000, GOOGL: 180 } };
const sched = koSchedule(t);
eq(sched.length, 11, "ko: 11 monthly observations");
near(sched[0].koPct, 1.08, 1e-9, "ko: obs1 = 108%");
near(sched[1].koPct, 1.04, 1e-9, "ko: obs2 = 104% (stepdown)");
near(sched[2].koPct, 1.00, 1e-9, "ko: obs3 = 100%");
near(sched[3].koPct, 1.00, 1e-9, "ko: obs4 floored at strike (no <100%)");
near(sched[10].koPct, 1.00, 1e-9, "ko: final obs floored at strike");
near(sched[0].koPriceBySymbol.TSM, 216, 1e-9, "ko: TSM obs1 price = 200 × 1.08");

// ─── tableRows + indicative pricing ────────────────────────────────────────
const quotes = {
  TSM:   { symbol: "TSM",   market: "US", price: 210, prevClose: 208, high52: 250, low52: 150, asOf: "x", marketOpen: false, source: "mock" },
  AVGO:  { symbol: "AVGO",  market: "US", price: 950, prevClose: 940, high52: 1100, low52: 700, asOf: "x", marketOpen: false, source: "mock" },
  GOOGL: { symbol: "GOOGL", market: "US", price: 175, prevClose: 178, high52: 220, low52: 120, asOf: "x", marketOpen: false, source: "mock" },
};
const rows = tableRows(t, quotes);
near(rows[0].strike, 200, 1e-9, "table: TSM strike = 200×100% = 200");
near(rows[0].eki,    120, 1e-9, "table: TSM EKI    = 200×60%  = 120");
near(rows[1].strike, 1000, 1e-9, "table: AVGO strike = 1000");
near(rows[1].eki,     600, 1e-9, "table: AVGO EKI    = 600");
near(rows[2].eki,     108, 1e-9, "table: GOOGL EKI   = 108");

// ─── Risk band ─────────────────────────────────────────────────────────────
let r = assessRisk(t, quotes);
ok(r && (r.band === "moderate" || r.band === "safe" || r.band === "high-risk"), "risk: rated for healthy spot");

// Force GOOGL below KI and recheck
const stress = { ...quotes, GOOGL: { ...quotes.GOOGL, price: 100 } }; // KI = 108
r = assessRisk(t, stress);
eq(r.band, "critical", "risk: GOOGL below 108 → critical");
eq(r.worstSymbol, "GOOGL", "risk: worst-of identified");

// ─── Calculator ────────────────────────────────────────────────────────────
eq(validateLot("MYR", 49_000), `Below minimum lot for MYR (${formatCcy("MYR", 50000)}).`, "calc: MYR below min flagged");
eq(validateLot("MYR", 50_000), null, "calc: MYR at min OK");
const c = clientCalc(t, "MYR", 100_000);
near(c.monthlyCoupon, 100_000 * 0.09 / 12, 1e-6, "calc: monthly coupon = principal × 9% / 12");
near(c.totalCoupon, c.monthlyCoupon * 11, 1e-6, "calc: total coupon = monthly × tenor");
near(c.annualizedReturnPct, (c.totalCoupon / 100_000) * (12 / 11) * 100, 1e-6, "calc: annualized matches stated coupon");
near(c.estimatedPayout, 100_000 + c.totalCoupon, 1e-6, "calc: payout = principal + total coupon");

// ─── Heuristic prob ────────────────────────────────────────────────────────
const p = koProbabilityHeuristic(t, quotes);
ok(p >= 0 && p <= 100, `heuristic: KO probability bounded (${p})`);

// ─── Markets ───────────────────────────────────────────────────────────────
const snaps = marketSnapshots(new Date("2026-05-09T07:00:00Z")); // Sat morning UTC
ok(snaps.length === 6, "markets: 6 snapshots");
ok(snaps.every(s => !s.open), "markets: all closed on Saturday UTC instant");
const sat = isMarketOpen("US", new Date("2026-05-09T15:00:00Z"));
eq(sat.reason, "weekend", "markets: US — weekend on 2026-05-09");
const my = malaysiaNowParts(new Date("2026-05-09T03:30:00Z")); // 11:30 AM MY
ok(my.time.startsWith("11:30") || my.time.startsWith("11:31"), `markets: MY clock ≈ 11:30 (got ${my.time})`);
const mid = isMarketOpen("US", new Date("2026-05-12T17:00:00Z")); // Tue 13:00 NY = open
eq(mid.reason, "open", "markets: US — open on 2026-05-12 13:00 ET");

// Trade-date settlement  → expected: trade Tue 12 May 2026, T+7 biz = 21 May 2026
eq(addBusinessDays("2026-05-12", 7, "US"), "2026-05-21", "markets: T+7 biz from 12-May-26 → 21-May-26");

// addMonthsBizSnap forward-snaps weekend → next business day
eq(addMonthsBizSnap("2026-01-30", 1, "US"), "2026-03-02", "markets: Jan 30 + 1m → Mar 2 (Feb 28 was Sat in '26 → snap)");

// ─── Indicative ↔ actual fixing flag ───────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
ok(today < tranche.tradeDate, "fixing: today is before trade date in our test horizon");

// ─── Variant: 2-digit year + emoji header + parenthetical company names ───
const SAMPLE_2 = `💡MSI 👶🏻🦥
Offering: 08 May 26
Trade: 08 May 26
Settlement: T+7
Tranche Code: MSIT260572
MYR
ANET US (Arista Networks)
APH US (Amphenol)
Strike 100%
KO 107%, Stepdown 7%
Coupon 8.5% p.a.
Tenor 7M
EKI 60%
`;
const r2 = parseTrancheText(SAMPLE_2);
eq(r2.tranche.issuer, "MSI", "v2: emoji-decorated issuer detected");
eq(r2.tranche.trancheCode, "MSIT260572", "v2: tranche code");
eq(r2.tranche.tradeDate, "2026-05-08", "v2: 2-digit year date '08 May 26'");
eq(r2.tranche.offeringEnd, "2026-05-08", "v2: 2-digit year offering");
eq(r2.tranche.currency, "MYR", "v2: MYR currency");
eq(r2.tranche.tenorMonths, 7, "v2: tenor 7M");
near(r2.tranche.couponPa, 0.085, 1e-9, "v2: coupon 8.5% pa");
near(r2.tranche.koStartPct, 1.07, 1e-9, "v2: KO 107%");
near(r2.tranche.koStepdownPct, 0.07, 1e-9, "v2: stepdown 7% (capital S)");
near(r2.tranche.ekiPct, 0.6, 1e-9, "v2: EKI 60%");
eq(r2.tranche.underlyings.length, 2, "v2: 2 underlyings (parens-suffixed)");
eq(r2.tranche.underlyings.map(u => u.symbol).join(","), "ANET,APH", "v2: ANET, APH detected");
eq(r2.tranche.underlyings[0].rawName, "ANET (Arista Networks)", "v2: rawName preserves company");

// ─── Summary ───────────────────────────────────────────────────────────────
console.log("\n────────────────");
console.log(`${pass} passed · ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
