// Parser: free-form tranche text → structured `Tranche`.
// Tolerant of order, line breaks, emoji flags, capitalisation, corporate
// suffixes (Inc / Holdings / Corp), and multi-market listings (Alibaba
// → 9988 HK by default, BABA US if "US" is specified, etc.).

import { addBusinessDays } from "./markets";
import type { Currency, MarketCode, Tranche, Underlying } from "./types";

const CURRENCY_FROM_FLAG: Record<string, Currency> = {
  "🇲🇾": "MYR",
  "🇺🇸": "USD",
  "🇸🇬": "SGD",
  "🇭🇰": "HKD",
  "🇯🇵": "JPY",
  "🇦🇺": "AUD",
};

// ─── Name → multi-market listings ───────────────────────────────────────────
// For each well-known company we list the ticker on each market it trades on,
// plus a `default` market that applies when the user didn't specify one.
// Default is set to where the bank typically books each name.

interface Listing {
  US?: string;
  HK?: string;
  SG?: string;
  JP?: string;
  AU?: string;
  MY?: string;
  default: MarketCode;
}

const NAME_TO_TICKER: Record<string, Listing> = {
  // ─── US tech (NASDAQ default) ───────────────────────────────────────────
  apple: { US: "AAPL", default: "US" },
  microsoft: { US: "MSFT", default: "US" },
  google: { US: "GOOGL", default: "US" },
  alphabet: { US: "GOOGL", default: "US" },
  amazon: { US: "AMZN", default: "US" },
  meta: { US: "META", default: "US" },
  facebook: { US: "META", default: "US" },
  nvidia: { US: "NVDA", default: "US" },
  nvdia: { US: "NVDA", default: "US" },           // common misspelling
  nvida: { US: "NVDA", default: "US" },           // common misspelling
  "nivida": { US: "NVDA", default: "US" },        // common misspelling
  tesla: { US: "TSLA", default: "US" },
  netflix: { US: "NFLX", default: "US" },
  broadcom: { US: "AVGO", default: "US" },
  oracle: { US: "ORCL", default: "US" },
  salesforce: { US: "CRM", default: "US" },
  cisco: { US: "CSCO", default: "US" },
  intel: { US: "INTC", default: "US" },
  amd: { US: "AMD", default: "US" },
  ibm: { US: "IBM", default: "US" },
  adobe: { US: "ADBE", default: "US" },
  qualcomm: { US: "QCOM", default: "US" },
  paypal: { US: "PYPL", default: "US" },
  uber: { US: "UBER", default: "US" },
  airbnb: { US: "ABNB", default: "US" },
  shopify: { US: "SHOP", default: "US" },
  palantir: { US: "PLTR", default: "US" },
  snowflake: { US: "SNOW", default: "US" },
  servicenow: { US: "NOW", default: "US" },
  arista: { US: "ANET", default: "US" },
  amphenol: { US: "APH", default: "US" },
  "western digital": { US: "WDC", default: "US" },
  sandisk: { US: "SNDK", default: "US" },
  micron: { US: "MU", default: "US" },
  "applied materials": { US: "AMAT", default: "US" },
  "lam research": { US: "LRCX", default: "US" },
  asml: { US: "ASML", default: "US" },
  tsmc: { US: "TSM", default: "US" },
  "taiwan semiconductor": { US: "TSM", default: "US" },
  workday: { US: "WDAY", default: "US" },
  intuit: { US: "INTU", default: "US" },

  // ─── US financials / consumer / healthcare ──────────────────────────────
  jpmorgan: { US: "JPM", default: "US" },
  "jp morgan": { US: "JPM", default: "US" },
  "bank of america": { US: "BAC", default: "US" },
  "goldman sachs": { US: "GS", default: "US" },
  "morgan stanley": { US: "MS", default: "US" },
  "wells fargo": { US: "WFC", default: "US" },
  citigroup: { US: "C", default: "US" },
  visa: { US: "V", default: "US" },
  mastercard: { US: "MA", default: "US" },
  berkshire: { US: "BRK.B", default: "US" },
  walmart: { US: "WMT", default: "US" },
  costco: { US: "COST", default: "US" },
  "home depot": { US: "HD", default: "US" },
  mcdonalds: { US: "MCD", default: "US" },
  starbucks: { US: "SBUX", default: "US" },
  "coca cola": { US: "KO", default: "US" },
  pepsi: { US: "PEP", default: "US" },
  pepsico: { US: "PEP", default: "US" },
  disney: { US: "DIS", default: "US" },
  nike: { US: "NKE", default: "US" },
  boeing: { US: "BA", default: "US" },
  caterpillar: { US: "CAT", default: "US" },
  exxon: { US: "XOM", default: "US" },
  exxonmobil: { US: "XOM", default: "US" },
  chevron: { US: "CVX", default: "US" },
  pfizer: { US: "PFE", default: "US" },
  "johnson and johnson": { US: "JNJ", default: "US" },
  "johnson & johnson": { US: "JNJ", default: "US" },
  "eli lilly": { US: "LLY", default: "US" },
  unitedhealth: { US: "UNH", default: "US" },
  "procter and gamble": { US: "PG", default: "US" },
  "procter & gamble": { US: "PG", default: "US" },
  merck: { US: "MRK", default: "US" },
  abbvie: { US: "ABBV", default: "US" },
  verizon: { US: "VZ", default: "US" },

  // ─── HK / China (Hang Seng default) ─────────────────────────────────────
  // Dual-listed names give US ADR alongside HK — bank usually books HK.
  alibaba: { HK: "9988", US: "BABA", default: "HK" },
  tencent: { HK: "0700", default: "HK" },
  meituan: { HK: "3690", default: "HK" },
  jd: { HK: "9618", US: "JD", default: "HK" },
  netease: { HK: "9999", US: "NTES", default: "HK" },
  baidu: { HK: "9888", US: "BIDU", default: "HK" },
  "trip.com": { HK: "9961", US: "TCOM", default: "HK" },
  pinduoduo: { US: "PDD", default: "US" },
  "ping an": { HK: "2318", default: "HK" },
  "ping an insurance": { HK: "2318", default: "HK" },
  "bank of china": { HK: "3988", default: "HK" },
  "agricultural bank of china": { HK: "1288", default: "HK" },
  "agricultural bank": { HK: "1288", default: "HK" },
  icbc: { HK: "1398", default: "HK" },
  "industrial and commercial bank of china": { HK: "1398", default: "HK" },
  "china construction bank": { HK: "0939", default: "HK" },
  ccb: { HK: "0939", default: "HK" },
  "china mobile": { HK: "0941", default: "HK" },
  "china life": { HK: "2628", default: "HK" },
  "china merchants bank": { HK: "3968", default: "HK" },
  hsbc: { HK: "0005", default: "HK" },
  aia: { HK: "1299", default: "HK" },
  "aia group": { HK: "1299", default: "HK" },
  xiaomi: { HK: "1810", default: "HK" },
  byd: { HK: "1211", default: "HK" },
  "byd company": { HK: "1211", default: "HK" },
  nio: { HK: "9866", US: "NIO", default: "HK" },
  xpeng: { HK: "9868", US: "XPEV", default: "HK" },
  "li auto": { HK: "2015", US: "LI", default: "HK" },
  geely: { HK: "0175", default: "HK" },
  "geely auto": { HK: "0175", default: "HK" },
  "great wall motor": { HK: "2333", default: "HK" },
  saic: { HK: "2333", default: "HK" },
  smic: { HK: "0981", default: "HK" },
  "hua hong": { HK: "1347", default: "HK" },
  "kuaishou": { HK: "1024", default: "HK" },
  bilibili: { HK: "9626", US: "BILI", default: "HK" },
  weibo: { HK: "9898", US: "WB", default: "HK" },
  ctrip: { HK: "9961", US: "TCOM", default: "HK" },
  "anta sports": { HK: "2020", default: "HK" },
  "li ning": { HK: "2331", default: "HK" },
  "wharf reic": { HK: "1997", default: "HK" },
  "swire pacific": { HK: "0019", default: "HK" },
  "ck hutchison": { HK: "0001", default: "HK" },
  "henderson land": { HK: "0012", default: "HK" },
  "sun hung kai": { HK: "0016", default: "HK" },
  "shk properties": { HK: "0016", default: "HK" },
  "sands china": { HK: "1928", default: "HK" },
  "galaxy entertainment": { HK: "0027", default: "HK" },
  "wynn macau": { HK: "1128", default: "HK" },
  cnooc: { HK: "0883", default: "HK" },
  petrochina: { HK: "0857", default: "HK" },
  sinopec: { HK: "0386", default: "HK" },

  // ─── Singapore ──────────────────────────────────────────────────────────
  dbs: { SG: "D05", default: "SG" },
  "dbs group": { SG: "D05", default: "SG" },
  uob: { SG: "U11", default: "SG" },
  "united overseas bank": { SG: "U11", default: "SG" },
  ocbc: { SG: "O39", default: "SG" },
  "oversea-chinese banking": { SG: "O39", default: "SG" },
  singtel: { SG: "Z74", default: "SG" },
  capitaland: { SG: "C31", default: "SG" },
  "capitaland investment": { SG: "9CI", default: "SG" },
  "sgx": { SG: "S68", default: "SG" },
  "wilmar": { SG: "F34", default: "SG" },
  "keppel": { SG: "BN4", default: "SG" },
  "city developments": { SG: "C09", default: "SG" },
  "sembcorp": { SG: "U96", default: "SG" },
  "sembcorp industries": { SG: "U96", default: "SG" },
  sia: { SG: "C6L", default: "SG" },
  "singapore airlines": { SG: "C6L", default: "SG" },
  "thai beverage": { SG: "Y92", default: "SG" },
  "yangzijiang": { SG: "BS6", default: "SG" },

  // ─── Malaysia ───────────────────────────────────────────────────────────
  cimb: { MY: "1023", default: "MY" },
  maybank: { MY: "1155", default: "MY" },
  "public bank": { MY: "1295", default: "MY" },
  "tenaga nasional": { MY: "5347", default: "MY" },
  petronas: { MY: "5681", default: "MY" },
  "ihh healthcare": { MY: "5225", default: "MY" },

  // ─── Japan ──────────────────────────────────────────────────────────────
  toyota: { JP: "7203", default: "JP" },
  sony: { JP: "6758", default: "JP" },
  softbank: { JP: "9984", default: "JP" },
  nintendo: { JP: "7974", default: "JP" },
  honda: { JP: "7267", default: "JP" },
  "mitsubishi ufj": { JP: "8306", default: "JP" },
  keyence: { JP: "6861", default: "JP" },

  // ─── Australia ──────────────────────────────────────────────────────────
  bhp: { AU: "BHP", default: "AU" },
  cba: { AU: "CBA", default: "AU" },
  "commonwealth bank": { AU: "CBA", default: "AU" },
  "rio tinto": { AU: "RIO", default: "AU" },
  woolworths: { AU: "WOW", default: "AU" },
  westpac: { AU: "WBC", default: "AU" },
  anz: { AU: "ANZ", default: "AU" },
  nab: { AU: "NAB", default: "AU" },
  fortescue: { AU: "FMG", default: "AU" },
};

const MARKET_TOKENS: Record<string, MarketCode> = {
  US: "US", NYSE: "US", NASDAQ: "US",
  HK: "HK",
  MY: "MY", KL: "MY",
  SG: "SG", SI: "SG",
  JP: "JP", TYO: "JP", T: "JP",
  AU: "AU", ASX: "AU",
};

// 4-digit codes hint Hang Seng listings even without an "HK" tag.
function looksLikeHkCode(s: string): boolean {
  return /^\d{4}$/.test(s);
}

function pct(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) / 100 : undefined;
}

function parseDate(s: string): string | undefined {
  // Accept ordinal suffixes: "1st", "2nd", "3rd", "4th"-"31st" May 2026.
  const m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{2,4})/i);
  if (!m) return undefined;
  const day = parseInt(m[1], 10);
  const monthName = m[2].toLowerCase();
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const idx = months.findIndex((mn) => monthName.startsWith(mn));
  if (idx < 0) return undefined;
  return new Date(Date.UTC(year, idx, day)).toISOString().slice(0, 10);
}

function parseOffering(line: string): { start?: string; end?: string } {
  const trimmed = line.replace(/^[Oo]ffering[:\s]*/, "").trim();
  const range = trimmed.match(
    /(\d{1,2})(?:st|nd|rd|th)?\s*(?:[A-Za-z]{3,9})?\s*(?:\d{2,4})?\s*[-–]\s*(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s+\d{2,4})/i
  );
  if (range) {
    const end = parseDate(range[2]);
    if (!end) return {};
    const endMatch = range[2].match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{2,4})/i)!;
    const startDay = parseInt(range[1], 10);
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const idx = months.findIndex((m) => endMatch[2].toLowerCase().startsWith(m));
    if (idx < 0) return { end };
    let endYear = parseInt(endMatch[3], 10);
    if (endYear < 100) endYear += 2000;
    const start = new Date(Date.UTC(endYear, idx, startDay)).toISOString().slice(0, 10);
    return { start, end };
  }
  const single = parseDate(trimmed);
  return single ? { end: single } : {};
}

function detectCurrency(text: string): Currency | undefined {
  for (const k of Object.keys(CURRENCY_FROM_FLAG)) {
    if (text.includes(k)) return CURRENCY_FROM_FLAG[k];
  }
  const m = text.match(/\b(USD|HKD|MYR|SGD|JPY|AUD)\b/);
  return (m?.[1] as Currency) || undefined;
}

/** Strip emojis and other decorative symbols from a line. */
function stripDecor(s: string): string {
  // Strip emoji pictographs, skin-tone modifiers, regional-indicator flags,
  // and the FE0F variation selector. CRITICAL: do NOT strip \p{Emoji_Component}
  // because that Unicode class includes plain digits 0-9 (they\'re part of
  // keycap emojis like 1\u{FE0F}\u{20E3}), which would mangle tranche codes
  // like "MSIT260582" into "MSIT".
  return s.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE0F}\u{200D}\u{20E3}]+/gu, "")
          .replace(/[\u{1F1E6}-\u{1F1FF}]+/gu, "")
          .replace(/\s+/g, " ");
}

/**
 * Normalise a company name for dictionary lookup. Strips common corporate
 * suffixes (Inc, Corp, Holdings, Ltd, Group, etc.) so "Applied Materials Inc"
 * matches the "applied materials" entry, "ASML Holdings" matches "asml", etc.
 */
function normaliseName(s: string): string {
  return s
    .replace(/[.,]/g, " ")
    .replace(/\b(inc|incorporated|corp|corporation|company|co|ltd|limited|plc|holdings?|holding|group|grp|sa|ag|gmbh|nv|spa|llc|sarl|berhad|bhd|kk|kabushiki kaisha)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Levenshtein edit distance — minimum number of single-character insertions,
 * deletions, or substitutions to turn `a` into `b`. Used for typo-tolerant
 * dictionary lookup so "applie material" → "applied materials" → AMAT.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * Find the dictionary entry closest to `query` within `maxDistance` edits.
 * Returns the matched listing or undefined if no entry is close enough.
 * Threshold scales with query length so short names need exact match.
 */
function findFuzzyMatch(query: string): { listing: Listing; matchedKey: string } | undefined {
  const norm = normaliseName(query);
  if (norm.length < 4) return undefined;                 // too short to fuzzy
  // ceil(len/3) gives sensible thresholds: 4-6 chars → 2 edits, 7-9 → 3,
  // 10+ → 3 (capped). Catches typos like "googel"/"alibba" while not
  // collapsing distinct names into each other.
  const maxDistance = Math.min(3, Math.max(1, Math.ceil(norm.length / 3)));
  let best: { key: string; distance: number } | undefined;
  for (const key of Object.keys(NAME_TO_TICKER)) {
    // Cheap reject — skip entries with wildly different length
    if (Math.abs(key.length - norm.length) > maxDistance) continue;
    const d = levenshtein(norm, key);
    if (d <= maxDistance && (!best || d < best.distance)) {
      best = { key, distance: d };
      if (d === 0) break;
    }
  }
  return best ? { listing: NAME_TO_TICKER[best.key], matchedKey: best.key } : undefined;
}

/**
 * Resolve a free-form name (and optional market hint) to {symbol, market}.
 * Lookup order:
 *   1. exact match in NAME_TO_TICKER
 *   2. normalised-name match (suffixes stripped)
 *   3. fall back to using the input as the ticker on the hinted market
 */
function resolveListing(name: string, marketHint?: MarketCode): {
  symbol: string;
  market: MarketCode;
  resolved: boolean;
} {
  const exact = NAME_TO_TICKER[name.toLowerCase()];
  const normalised = NAME_TO_TICKER[normaliseName(name)];
  // Fuzzy fallback catches typos like "applie material" → "applied materials"
  // and "arista net" → "arista". Threshold scales with name length so short
  // queries don't match unrelated short entries.
  // Try the full-name fuzzy first, then fall back to the first significant
  // word — that handles "arista net" → "arista" → ANET.
  let fuzzy = undefined as ReturnType<typeof findFuzzyMatch>;
  if (!exact && !normalised) {
    fuzzy = findFuzzyMatch(name);
    if (!fuzzy) {
      const firstWord = normaliseName(name).split(" ")[0];
      if (firstWord && firstWord.length >= 4) {
        fuzzy = NAME_TO_TICKER[firstWord]
          ? { listing: NAME_TO_TICKER[firstWord], matchedKey: firstWord }
          : findFuzzyMatch(firstWord);
      }
    }
  }
  const hit = exact || normalised || fuzzy?.listing;

  if (hit) {
    const targetMkt: MarketCode = marketHint && (hit as any)[marketHint] ? marketHint : hit.default;
    const sym = (hit as any)[targetMkt] as string | undefined;
    if (sym) return { symbol: sym, market: targetMkt, resolved: true };
    // Fallback: use default listing.
    const def = (hit as any)[hit.default] as string;
    return { symbol: def, market: hit.default, resolved: true };
  }

  // No dictionary match. Use the raw name as the ticker on the hinted market
  // (or US by default). The post-parse symbol-search hook will try to upgrade
  // it via Finnhub.
  const upper = name.toUpperCase();
  const looksLikeTicker = /^[A-Z0-9.&\-]{1,8}$/.test(upper);
  return {
    symbol: looksLikeTicker ? upper : upper,
    market: marketHint ?? "US",
    resolved: looksLikeTicker,
  };
}

function extractTickers(text: string, exclude: Set<string>): Underlying[] {
  // Lines that aren't fields are candidate underlyings. We strip emojis
  // first so "💡 Alibaba HK ⭐" parses cleanly. The `exclude` set holds
  // strings (issuer abbreviation, tranche code) that the caller has already
  // identified — they must not be treated as underlyings.
  const lines = text
    .split(/\r?\n/)
    .map((l) => stripDecor(l).trim())
    .filter(Boolean)
    .filter((l) => !exclude.has(l) && !exclude.has(l.toUpperCase()));

  const out: Underlying[] = [];
  for (const raw of lines) {
    if (/^(Strike|KO|Coupon|Tenor|EKI|Offering|Trade|Settlement|Tranche|MYR|USD|HKD|SGD|JPY|AUD)\b/i.test(raw)) continue;

    // Format A: "TICKER MARKET" or "TICKER MARKET (Company Name)"
    //   e.g. "TSM US", "0700 HK", "ASML US (ASML Holdings)"
    const withMarket = raw.match(/^([A-Za-z0-9.&\- ]+?)\s+([A-Z]{1,4}|\.[A-Z]{1,3})(?:\s*\((.*?)\))?\s*$/);
    if (withMarket) {
      const left = withMarket[1].trim();
      const tok = withMarket[2].replace(/^\./, "");
      const market = MARKET_TOKENS[tok];
      if (market) {
        const longName = withMarket[3]?.trim();
        // Try dictionary lookup first (so "Alibaba US" -> BABA, not ALIBABA).
        // If no dict match AND the left side already looks like a real ticker,
        // use it as-is.
        const dictHit = resolveListing(longName ? longName : left, market);
        const upperLeft = left.toUpperCase();
        const looksLikeTicker = /^[A-Z0-9.&\-]{1,8}$/.test(upperLeft);
        const final = dictHit.resolved
          ? dictHit
          : looksLikeTicker
            ? { symbol: upperLeft, market, resolved: true }
            : dictHit;
        const rawName = longName ? `${left} (${longName})` : left;
        out.push({ rawName, symbol: final.symbol, market: final.market, resolved: final.resolved });
        continue;
      }
    }

    // Format B: bare 4-digit code → Hang Seng listing
    if (looksLikeHkCode(raw)) {
      out.push({ rawName: raw, symbol: raw, market: "HK", resolved: true });
      continue;
    }

    // Format C: bare company name → look up default listing
    //   e.g. "Applied Materials Inc", "Alibaba", "ASML Holdings"
    const looked = resolveListing(raw);
    if (looked.resolved) {
      out.push({ rawName: raw, symbol: looked.symbol, market: looked.market, resolved: true });
    }
  }

  // Dedupe by (symbol, market)
  const seen = new Set<string>();
  return out.filter((u) => {
    const k = u.symbol + ":" + u.market;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function parseField(text: string, key: RegExp): string | undefined {
  const m = text.match(key);
  return m ? m[1].trim() : undefined;
}

export interface ParseWarning {
  field: string;
  message: string;
}

export interface ParseResult {
  tranche: Tranche;
  warnings: ParseWarning[];
}

export function parseTrancheText(input: string): ParseResult {
  const warnings: ParseWarning[] = [];
  const text = input.trim();

  const issuerLines = text.split(/\r?\n/).map((l) => stripDecor(l).trim()).filter(Boolean);
  const issuer = issuerLines.find((l) => /^[A-Z]{2,8}$/.test(l));

  const trancheCode =
    parseField(text, /Tranche\s*code[:\s]+([A-Z0-9-]+)/i) ||
    parseField(text, /\b(MSIT\d+|[A-Z]{2,4}\d{6,})\b/) ||
    `T${Date.now().toString().slice(-7)}`;

  const offeringLine =
    parseField(text, /Offering[:\s]+([^\n]+?)(?=\s+Trade[:\s]|\n|$)/i) ||
    parseField(text, /Offering[:\s]+([^\n]+)/i) ||
    "";
  let { start: offeringStart, end: offeringEnd } = parseOffering(offeringLine);

  // "Offering & Trade 8 May 2026" — single-day window where offering = trade
  const combined = parseField(text, /Offering\s*&\s*Trade[:\s]+([^\n]+)/i);
  const tradeRaw =
    combined ||
    parseField(text, /Trade[:\s]+([^\n]+?)(?=\s+(?:Settlement|Tranche|Offering)\b|$)/i) ||
    parseField(text, /Trade[:\s]+([^\n]+)/i) ||
    "";
  const tradeDate = parseDate(tradeRaw);
  if (combined && tradeDate && !offeringEnd) offeringEnd = tradeDate;

  const tradeCutoffMatch = tradeRaw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  let tradeCutoff: string | undefined;
  if (tradeCutoffMatch) {
    const rawHour = parseInt(tradeCutoffMatch[1], 10);
    const isPm = tradeCutoffMatch[3].toLowerCase() === "pm";
    const hour24 = (rawHour % 12) + (isPm ? 12 : 0);
    tradeCutoff = `${String(hour24).padStart(2, "0")}:${(tradeCutoffMatch[2] || "00").padStart(2, "0")}`;
  }

  const settleRaw = parseField(text, /Settlement[:\s]+([^\n]+)/i) || "T+7";
  const settleMatch = settleRaw.match(/T\s*\+\s*(\d+)/i);
  const settlementOffset = settleMatch ? parseInt(settleMatch[1], 10) : 7;

  const couponMatch = text.match(/Coupon\s*:?\s+(\d+(?:\.\d+)?)\s*%(?:\s*p\.?a\.?)?/i);
  const couponPa = couponMatch ? parseFloat(couponMatch[1]) / 100 : 0;
  if (!couponMatch) warnings.push({ field: "coupon", message: "Coupon not found — defaulted to 0%." });

  const tenorMatch = text.match(/Tenor\s*:?\s+(\d+(?:\.\d+)?)\s*(M|Y|months|years|month|year|m|y)/i);
  let tenorMonths = 12;
  if (tenorMatch) {
    const n = parseFloat(tenorMatch[1]);
    const u = tenorMatch[2].toLowerCase();
    tenorMonths = u.startsWith("y") ? Math.round(n * 12) : Math.round(n);
  } else {
    warnings.push({ field: "tenor", message: "Tenor not found — defaulted to 12M." });
  }

  const strikePct = pct(parseField(text, /Strike\s*:?\s+([0-9.]+\s*%)/i)) ?? 1.0;
  const ekiPct = pct(parseField(text, /EKI\s*:?\s+([0-9.]+\s*%)/i)) ?? 0.6;

  const koLine = parseField(text, /KO\s*:?\s+([^\n]+)/i) || "";
  const koStartPct = pct(koLine.match(/([0-9.]+\s*%)/)?.[1]) ?? 1.0;
  // Stepdown can be written as "stepdown 4%" OR "4% stepdown" OR "4 stepdown".
  const stepdownPct =
    pct(koLine.match(/stepdown\s*:?\s+([0-9.]+\s*%)/i)?.[1]) ??
    pct(koLine.match(/([0-9.]+\s*%)\s+stepdown/i)?.[1]) ??
    0;

  const koObsFreqMonths = 1;

  const currency = detectCurrency(text) || "USD";
  if (!detectCurrency(text)) {
    warnings.push({ field: "currency", message: "Currency not found — defaulted to USD." });
  }

  const underlyings = extractTickers(text, new Set([
    issuer ?? "",
    trancheCode,
  ].filter(Boolean) as string[]));
  if (!underlyings.length) {
    warnings.push({ field: "underlyings", message: "No underlyings detected — please verify." });
  }

  if (!tradeDate) {
    warnings.push({ field: "tradeDate", message: "Trade date missing — settlement will be wrong." });
  }

  const settlementDate = tradeDate
    ? addBusinessDays(tradeDate, settlementOffset, "US")
    : undefined;

  const tranche: Tranche = {
    issuer,
    trancheCode,
    currency,
    offeringStart,
    offeringEnd,
    tradeDate: tradeDate || new Date().toISOString().slice(0, 10),
    tradeCutoff,
    settlementOffset,
    settlementDate,
    couponPa,
    tenorMonths,
    strikePct,
    koStartPct,
    koStepdownPct: stepdownPct,
    ekiPct,
    koObsFreqMonths,
    underlyings,
    isIndicativeFixing: true,
    createdAt: new Date().toISOString(),
  };

  return { tranche, warnings };
}
