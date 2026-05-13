// Memorised-KO behavioural tests.
//
// Scenario the user described:
//   Tranche with 3 stocks A, B, C.
//   Obs 1: A and B close ABOVE KO, C closes BELOW.   → A & B memorised.
//   Obs 5: A and B close BELOW KO (drop back).       C closes ABOVE KO.
//                                                     → tranche KO'd at obs 5.
//
// Plus a few edge cases for completeness.

import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("./ts-resolver.mjs", import.meta.url);

const { memorisedKOCheck } = await import("../lib/calc.ts");

let pass = 0, fail = 0;
const eq = (a, b, n) => (a === b ? (pass++, console.log(`✓ ${n}`)) : (fail++, console.log(`✗ ${n} — expected ${b}, got ${a}`)));
const ok = (c, n) => (c ? (pass++, console.log(`✓ ${n}`)) : (fail++, console.log(`✗ ${n}`)));

/** Build a minimal tranche with N underlyings + a flat KO schedule for testing. */
function tranche(symbols, koPct, initial) {
  return {
    issuer: "TEST",
    trancheCode: "TEST_MEMO",
    currency: "USD",
    tradeDate: "2024-01-15",  // far enough in the past to have observations
    settlementOffset: 7,
    couponPa: 0.08,
    tenorMonths: 12,
    strikePct: 1.0,
    koStartPct: koPct,
    koStepdownPct: 0,         // flat KO so we can reason easily
    ekiPct: 0.6,
    koObsFreqMonths: 1,
    underlyings: symbols.map((s) => ({ rawName: s, symbol: s, market: "US", resolved: true })),
    initialFixing: Object.fromEntries(symbols.map((s) => [s, initial[s] ?? 100])),
    isIndicativeFixing: false,
    createdAt: "2024-01-15T00:00:00.000Z",
  };
}

function close(p) { return { close: p, effectiveDate: "", source: "test" }; }

// ─── TEST 1: The user's exact scenario ─────────────────────────────────
{
  const t = tranche(["A", "B", "C"], 1.0, { A: 100, B: 100, C: 100 });
  // Obs 1: A=110, B=110, C=90 (A, B touch; C below)
  // Obs 5: A=80, B=80, C=120 (C touches; A, B drop back below)
  const closes = {
    1: { A: close(110), B: close(110), C: close(90) },
    2: { A: close(95),  B: close(95),  C: close(95) },
    3: { A: close(85),  B: close(80),  C: close(95) },
    4: { A: close(80),  B: close(75),  C: close(98) },
    5: { A: close(80),  B: close(80),  C: close(120) },
  };
  const r = memorisedKOCheck(t, closes);
  eq(r.firstTouchedAt["A"], 1, "TEST 1: A first touched at obs 1");
  eq(r.firstTouchedAt["B"], 1, "TEST 1: B first touched at obs 1");
  eq(r.firstTouchedAt["C"], 5, "TEST 1: C first touched at obs 5");
  ok(r.fullyMemorised, "TEST 1: all three underlyings memorised");
  eq(r.memorisedKOAtObs, 5, "TEST 1: memorised KO at obs 5 (when C finally touched)");
}

// ─── TEST 2: One underlying never touches → not memorised ──────────────
{
  const t = tranche(["A", "B", "C"], 1.0, { A: 100, B: 100, C: 100 });
  const closes = {
    1: { A: close(110), B: close(110), C: close(80) },
    2: { A: close(80),  B: close(80),  C: close(82) },
    3: { A: close(70),  B: close(70),  C: close(85) },
    4: { A: close(70),  B: close(70),  C: close(88) },
    5: { A: close(70),  B: close(70),  C: close(95) },
  };
  const r = memorisedKOCheck(t, closes);
  eq(r.firstTouchedAt["A"], 1, "TEST 2: A first touched at obs 1");
  eq(r.firstTouchedAt["B"], 1, "TEST 2: B first touched at obs 1");
  eq(r.firstTouchedAt["C"], null, "TEST 2: C never touched");
  ok(!r.fullyMemorised, "TEST 2: NOT fully memorised");
  eq(r.memorisedKOAtObs, null, "TEST 2: no memorised KO");
}

// ─── TEST 3: All three touch at same obs → memorised at that obs ──────
{
  const t = tranche(["A", "B", "C"], 1.0, { A: 100, B: 100, C: 100 });
  const closes = {
    1: { A: close(110), B: close(110), C: close(110) },
  };
  const r = memorisedKOCheck(t, closes);
  eq(r.memorisedKOAtObs, 1, "TEST 3: all touch at obs 1 → KO at obs 1");
}

// ─── TEST 4: One underlying tranche (degenerate) ───────────────────────
{
  const t = tranche(["A"], 1.0, { A: 100 });
  const closes = { 1: { A: close(110) } };
  const r = memorisedKOCheck(t, closes);
  eq(r.memorisedKOAtObs, 1, "TEST 4: single underlying touches → KO");
}

// ─── TEST 5: Exact threshold (close == KO) counts as a touch ───────────
{
  const t = tranche(["A", "B"], 1.0, { A: 100, B: 100 });
  const closes = {
    1: { A: close(100), B: close(100) }, // exactly at KO
  };
  const r = memorisedKOCheck(t, closes);
  eq(r.memorisedKOAtObs, 1, "TEST 5: close == KO counts as touch");
}

// ─── TEST 6: Missing data for one underlying → not memorised yet ──────
{
  const t = tranche(["A", "B", "C"], 1.0, { A: 100, B: 100, C: 100 });
  const closes = {
    1: { A: close(110), B: close(110) /* C missing */ },
    2: { A: close(95),  B: close(95),  C: close(95) },
  };
  const r = memorisedKOCheck(t, closes);
  eq(r.firstTouchedAt["C"], null, "TEST 6: missing-data underlying not touched");
  ok(!r.fullyMemorised, "TEST 6: not fully memorised when one is missing");
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
