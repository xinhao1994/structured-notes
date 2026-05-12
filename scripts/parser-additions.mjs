import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("./ts-resolver.mjs", import.meta.url);
const { parseTrancheText } = await import("../lib/parser.ts");

let pass = 0, fail = 0;
const eq = (a, b, n) => (a === b ? (pass++, console.log(`✓ ${n}`)) : (fail++, console.log(`✗ ${n} — expected ${b}, got ${a}`)));
const near = (a, b, eps, n) => (Math.abs(a - b) < eps ? (pass++, console.log(`✓ ${n}`)) : (fail++, console.log(`✗ ${n} — expected ≈${b}, got ${a}`)));
const ok = (c, n) => (c ? (pass++, console.log(`✓ ${n}`)) : (fail++, console.log(`✗ ${n}`)));

const base = (uls, opts = {}) => `MSI
USD
Tranche code: TEST1
Marvell Technologies
${uls}
Trade: 12 May 2026
${opts.coupon ?? "Coupon 8% pa"}
${opts.tenor ?? "Tenor 12M"}
Strike 100%
KO 100% stepdown 4%
EKI 60%`;

// 1. Marvell → MRVL
{
  const { tranche } = parseTrancheText(base(""));
  ok(tranche.underlyings.some(u => u.symbol === "MRVL"), "marvell → MRVL");
}
// 2. Bare ticker NVDA on its own line
{
  const txt = `MSI\nUSD\nTranche code: TEST2\nNVDA\nTrade: 12 May 2026\nCoupon 8% pa\nTenor 12M\nStrike 100%\nKO 100% stepdown 4%\nEKI 60%`;
  const { tranche } = parseTrancheText(txt);
  ok(tranche.underlyings.some(u => u.symbol === "NVDA"), "bare NVDA → NVDA");
}
// 3. Yield → coupon
{
  const txt = `MSI\nUSD\nTranche code: TEST3\nNVDA\nTrade: 12 May 2026\nYield 7.5% pa\nTenor 12M\nStrike 100%\nKO 100% stepdown 4%\nEKI 60%`;
  const { tranche } = parseTrancheText(txt);
  near(tranche.couponPa, 0.075, 1e-9, "yield → coupon 7.5%");
}
// 4. Interest with colon → coupon
{
  const txt = `MSI\nUSD\nTranche code: TEST4\nNVDA\nTrade: 12 May 2026\nInterest: 10% pa\nTenor 12M\nStrike 100%\nKO 100% stepdown 4%\nEKI 60%`;
  const { tranche } = parseTrancheText(txt);
  near(tranche.couponPa, 0.10, 1e-9, "interest: 10% → coupon");
}
// 5. Tenure → tenor
{
  const txt = `MSI\nUSD\nTranche code: TEST5\nNVDA\nTrade: 12 May 2026\nCoupon 8% pa\nTenure 9 months\nStrike 100%\nKO 100% stepdown 4%\nEKI 60%`;
  const { tranche } = parseTrancheText(txt);
  eq(tranche.tenorMonths, 9, "tenure → tenor 9M");
}
// 6. Offering end → trade fallback (no Trade line)
{
  const txt = `MSI\nUSD\nTranche code: TEST6\nNVDA\nOffering: 1 May 2026 - 8 May 2026\nCoupon 8% pa\nTenor 12M\nStrike 100%\nKO 100% stepdown 4%\nEKI 60%`;
  const { tranche } = parseTrancheText(txt);
  eq(tranche.tradeDate, "2026-05-08", "offering end → trade date fallback");
  eq(tranche.offeringEnd, "2026-05-08", "offering end preserved");
}
// 7. Bare MRVL / AMZN tickers
{
  const txt = `MSI\nUSD\nTranche code: TEST7\nMRVL\nAMZN\nTrade: 12 May 2026\nCoupon 8% pa\nTenor 12M\nStrike 100%\nKO 100% stepdown 4%\nEKI 60%`;
  const { tranche } = parseTrancheText(txt);
  ok(tranche.underlyings.some(u => u.symbol === "MRVL"), "bare MRVL → MRVL");
  ok(tranche.underlyings.some(u => u.symbol === "AMZN"), "bare AMZN → AMZN");
}
// 8. "Coupon" still works (regression)
{
  const txt = `MSI\nUSD\nTranche code: TEST8\nNVDA\nTrade: 12 May 2026\nCoupon 9% pa\nTenor 12M\nStrike 100%\nKO 100% stepdown 4%\nEKI 60%`;
  const { tranche } = parseTrancheText(txt);
  near(tranche.couponPa, 0.09, 1e-9, "coupon 9% (regression)");
}
// 9. Offering end keeps original tradeDate when Trade IS specified
{
  const txt = `MSI\nUSD\nTranche code: TEST9\nNVDA\nOffering: 1 May 2026 - 8 May 2026\nTrade: 12 May 2026\nCoupon 8% pa\nTenor 12M\nStrike 100%\nKO 100% stepdown 4%\nEKI 60%`;
  const { tranche } = parseTrancheText(txt);
  eq(tranche.tradeDate, "2026-05-12", "explicit Trade overrides offering-end fallback");
}
// 10. User-reported input: slash dates + OFFER abbreviation
{
  const txt = `1️⃣MSI
OFFER: 9/9/2025
trade date: 9/9/2025
Settlement: T+7
Currency: SGD 🇸🇬
MICRON US
BROADCOM US
META US
Strike: 80%
KO: 106% stepdown 3%
EKI: 69%
Coupon: 8%p.a.
Tenor: 9 months`;
  const { tranche } = parseTrancheText(txt);
  eq(tranche.tradeDate, "2025-09-09", "user case: trade date 9/9/2025");
  eq(tranche.offeringEnd, "2025-09-09", "user case: OFFER abbreviation matched");
  eq(tranche.currency, "SGD", "user case: SGD currency");
  near(tranche.couponPa, 0.08, 1e-9, "user case: coupon 8%");
  eq(tranche.tenorMonths, 9, "user case: tenor 9M");
  near(tranche.strikePct, 0.80, 1e-9, "user case: strike 80%");
  near(tranche.koStartPct, 1.06, 1e-9, "user case: KO 106%");
  near(tranche.koStepdownPct, 0.03, 1e-9, "user case: stepdown 3%");
  near(tranche.ekiPct, 0.69, 1e-9, "user case: EKI 69%");
  ok(tranche.underlyings.length === 3, "user case: 3 underlyings");
  ok(tranche.underlyings.some(u => u.symbol === "MU"), "user case: MICRON -> MU");
  ok(tranche.underlyings.some(u => u.symbol === "AVGO"), "user case: BROADCOM -> AVGO");
  ok(tranche.underlyings.some(u => u.symbol === "META"), "user case: META -> META");
}
// 11. Other slash-date variants
{
  const make = (d) => `MSI\nUSD\nTranche code: TEST_X\nNVDA\nTrade: ${d}\nCoupon 8% pa\nTenor 12M\nStrike 100%\nKO 100% stepdown 4%\nEKI 60%`;
  eq(parseTrancheText(make("1/3/2026")).tranche.tradeDate, "2026-03-01", "D/M/Y: 1/3/2026 -> 2026-03-01");
  eq(parseTrancheText(make("15-12-2025")).tranche.tradeDate, "2025-12-15", "D-M-Y: 15-12-2025 -> 2025-12-15");
  eq(parseTrancheText(make("7.6.26")).tranche.tradeDate, "2026-06-07", "D.M.YY: 7.6.26 -> 2026-06-07");
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
