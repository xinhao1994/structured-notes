// Quick verification of valuation date formula against real MSI tranche data.
// Run: npx tsx scripts/verify-valuation.mjs
import { addMonthsThenSnap, addBusinessDays } from "../lib/markets.ts";

console.log("\n=== MSIT250518 (SGD / HK underlyings) — Trade: 2025-05-14 ===");
const e1 = ["2025-06-16","2025-07-14","2025-08-14","2025-09-15","2025-10-14","2025-11-14","2025-12-15","2026-01-14","2026-02-11","2026-03-17","2026-04-14","2026-05-14"];
let hits1 = 0;
for (let i = 1; i <= 12; i++) {
  const d = addMonthsThenSnap("2025-05-14", i, "HK");
  const ok = d === e1[i-1];
  if (ok) hits1++;
  console.log(`  Obs ${String(i).padStart(2)}: computed ${d}  expected ${e1[i-1]}  ${ok ? "OK" : "diff"}`);
}
console.log(`  → ${hits1}/12 match`);

console.log("\n=== MSIT260598 (MYR / MY underlyings) — Trade: 2026-05-11 ===");
const e2 = ["2026-06-11","2026-07-13","2026-08-11","2026-09-11","2026-10-12","2026-11-11","2026-12-11"];
let hits2 = 0;
for (let i = 1; i <= 7; i++) {
  const d = addMonthsThenSnap("2026-05-11", i, "MY");
  const ok = d === e2[i-1];
  if (ok) hits2++;
  console.log(`  Obs ${String(i).padStart(2)}: computed ${d}  expected ${e2[i-1]}  ${ok ? "OK" : "diff"}`);
}
console.log(`  → ${hits2}/7 match`);

console.log("\n=== MSI SGD/US tranche — Trade: 2025-09-08, US underlyings (NVDA/META/AVGO) ===");
console.log("    Initial Val Date = Trade + 2 US biz days = 2025-09-10");
const anchor3 = addBusinessDays("2025-09-08", 2, "US");
console.log(`    Computed anchor: ${anchor3} (expected 2025-09-10)`);
const e3Obs9 = "2026-06-10"; // user-reported expected upcoming valuation
let hits3 = 0;
for (let i = 1; i <= 12; i++) {
  const d = addMonthsThenSnap(anchor3, i, "US");
  const flag = i === 9 ? (d === e3Obs9 ? "OK (matches term sheet)" : "diff vs term sheet") : "";
  if (i === 9 && d === e3Obs9) hits3++;
  console.log(`  Obs ${String(i).padStart(2)}: ${d}  ${flag}`);
}
console.log(`  → Obs 9 ${hits3 === 1 ? "matches" : "DOES NOT match"} expected ${e3Obs9}`);
