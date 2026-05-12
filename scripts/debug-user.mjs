import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("./ts-resolver.mjs", import.meta.url);
const { parseTrancheText } = await import("../lib/parser.ts");

const txt = `1⃣MSI
OFFER: 9/9/2025
trade date: 9/9/2025
Settlement: T+7
Currency: SGD \u{1F1F8}\u{1F1EC}
MICRON US
BROADCOM US
META US
Strike: 80%
KO: 106% stepdown 3%
EKI: 69%
Coupon: 8%p.a.
Tenor: 9 months`;

const { tranche, warnings } = parseTrancheText(txt);
console.log("issuer:", tranche.issuer);
console.log("trancheCode:", tranche.trancheCode);
console.log("tradeDate:", tranche.tradeDate);
console.log("currency:", tranche.currency);
console.log("underlyings:", tranche.underlyings);
console.log("warnings:", warnings);
