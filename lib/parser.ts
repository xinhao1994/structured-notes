// Parser: free-form tranche text (as pasted from Bloomberg / dealer email)
// → structured `Tranche`. Tolerant of order, line breaks, emoji flags, and
// the formatting the user gave us in the spec.
//
// Design notes:
// • Regexes are anchored to keywords (Strike, KO, Coupon, Tenor, EKI, Trade,
//   Settlement, Tranche code, Offering) — order-independent.
// • Tickers are extracted from a stock block: lines that contain a country
//   marker like "US", "HK", "MY", ".SI", ".KL", etc.
// • If a field is missing we fall back to industry defaults (T+7, monthly KO,
//   stepdown 0%) and we surface that to the UI as a warning chip.

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

// Map common name → ticker for well-known issues. This is intentionally tiny —
// production deployments should swap in a proper symbol-master service.
const NAME_TO_TICKER: Record<string, { sym: string; mkt: MarketCode }> = {
  google: { sym: "GOOGL", mkt: "US" },
  alphabet: { sym: "GOOGL", mkt: "US" },
  broadcom: { sym: "AVGO", mkt: "US" },
  apple: { sym: "AAPL", mkt: "US" },
  microsoft: { sym: "MSFT", mkt: "US" },
  nvidia: { sym: "NVDA", mkt: "US" },
  meta: { sym: "META", mkt: "US" },
  amazon: { sym: "AMZN", mkt: "US" },
  tesla: { sym: "TSLA", mkt: "US" },
  netflix: { sym: "NFLX", mkt: "US" },
  tencent: { sym: "0700", mkt: "HK" },
  alibaba: { sym: "9988", mkt: "HK" },
  hsbc: { sym: "0005", mkt: "HK" },
  cimb: { sym: "1023", mkt: "MY" },
  maybank: { sym: "1155", mkt: "MY" },
  dbs: { sym: "D05", mkt: "SG" },
  toyota: { sym: "7203", mkt: "JP" },
  bhp: { sym: "BHP", mkt: "AU" },
  cba: { sym: "CBA", mkt: "AU" },
};

const MARKET_TOKENS: Record<string, MarketCode> = {
  US: "US",
  NYSE: "US",
  NASDAQ: "US",
  HK: "HK",
  MY: "MY",
  KL: "MY",
  SG: "SG",
  SI: "SG",
  JP: "JP",
  TYO: "JP",
  T: "JP",
  AU: "AU",
  ASX: "AU",
};

function pct(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) / 100 : undefined;
}

function parseDate(s: string): string | undefined {
  // Accepts "12 May 2026", "8 - 12 May 2026", "12 May 2026, 4pm",
  // and 2-digit-year forms like "08 May 26".
  const m = s.match(
    /(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})/
  );
  if (!m) return undefined;
  const day = parseInt(m[1], 10);
  const monthName = m[2].toLowerCase();
  let year = parseInt(m[3], 10);
  // 2-digit year: assume current century. "26" → 2026, "99" → 2099.
  if (year < 100) year += 2000;
  const months = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ];
  const idx = months.findIndex((mn) => monthName.startsWith(mn));
  if (idx < 0) return undefined;
  const dt = new Date(Date.UTC(year, idx, day));
  return dt.toISOString().slice(0, 10);
}

function parseOffering(line: string): { start?: string; end?: string } {
  // Patterns:
  //   "8 - 12 May 2026"     (dash range, same month/year)
  //   "8 May - 12 May 2026" (full dates)
  //   "8 May 2026 - 12 May 2026"
  //   2-digit years also accepted (e.g. "8 - 12 May 26")
  const trimmed = line.replace(/^[Oo]ffering[:\s]*/, "").trim();
  const range = trimmed.match(
    /(\d{1,2})\s*(?:[A-Za-z]{3,9})?\s*(?:\d{2,4})?\s*[-–]\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})/
  );
  if (range) {
    const end = parseDate(range[2]);
    if (!end) return {};
    // Pull month/year from end and graft start day onto it
    const endMatch = range[2].match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})/)!;
    const startDay = parseInt(range[1], 10);
    const months = [
      "jan", "feb", "mar", "apr", "may", "jun",
      "jul", "aug", "sep", "oct", "nov", "dec",
    ];
    const idx = months.findIndex((m) => endMatch[2].toLowerCase().startsWith(m));
    if (idx < 0) return { end };
    let endYear = parseInt(endMatch[3], 10);
    if (endYear < 100) endYear += 2000;
    const start = new Date(Date.UTC(endYear, idx, startDay))
      .toISOString().slice(0, 10);
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

function extractTickers(text: string): Underlying[] {
  // Look in the body, after "Tranche code" and before "Strike".
  // We grab non-empty lines that contain a market token OR look ticker-like.
  // Strip leading/trailing emoji and ad-hoc decoration so a line like
  // "💡 ANET US (Arista Networks) ⭐"
  // still parses as ticker=ANET, market=US, name="ANET (Arista Networks)".
  const lines = text.split(/\r?\n/)
    .map((l) => stripDecor(l).trim())
    .filter(Boolean);
  const out: Underlying[] = [];
  for (const raw of lines) {
    if (/^(Strike|KO|Coupon|Tenor|EKI|Offering|Trade|Settlement|Tranche|MYR|USD|HKD|SGD|JPY|AUD)\b/i.test(raw)) {
      continue;
    }
    // Allow optional "(Company Name)" after the market token, e.g.
    //   "ANET US (Arista Networks)"
    //   "0700 HK"
    //   "1155.KL (Maybank)"
    const m = raw.match(/^([A-Za-z0-9.&\- ]+?)\s+([A-Z]{1,4}|\.[A-Z]{1,3})(?:\s*\((.*?)\))?\s*$/);
    if (m) {
      const ticker = m[1].trim();
      const tok = m[2].replace(/^\./, "");
      const mkt: MarketCode | undefined = MARKET_TOKENS[tok];
      if (!mkt) continue;
      const longName = m[3]?.trim();
      const upper = ticker.toUpperCase();
      const known = NAME_TO_TICKER[ticker.toLowerCase()] || (longName ? NAME_TO_TICKER[longName.toLowerCase()] : undefined);
      const symbol = known?.sym || (/^[A-Z0-9.&-]{1,8}$/.test(upper) ? upper : upper);
      const rawName = longName ? `${ticker} (${longName})` : ticker;
      out.push({ rawName, symbol, market: mkt });
      continue;
    }
    const known = NAME_TO_TICKER[raw.toLowerCase()];
    if (known) {
      out.push({ rawName: raw, symbol: known.sym, market: known.mkt });
    }
  }
  // Dedupe
  const seen = new Set<string>();
  return out.filter((u) => {
    const k = u.symbol + ":" + u.market;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Remove emojis and other decorative symbols. Keeps letters, numbers,
 * common punctuation, and spaces. Used so that lines like "💡MSI 👶🏻🦥"
 * or "ANET US (Arista Networks) ⭐" parse cleanly.
 */
function stripDecor(s: string): string {
  // Strip everything in Symbol / Other-Symbol / Modifier_Symbol Unicode
  // categories plus the regional-indicator pair used for flag emoji.
  return s.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Emoji_Component}]+/gu, "")
          .replace(/[\u{1F1E6}-\u{1F1FF}]+/gu, "")
          .replace(/\s+/g, " ");
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

  // Strip decorative emojis from each line for issuer detection so a header
  // like "💡 MSI 🦥" still resolves to "MSI".
  const lines = text.split(/\r?\n/).map((l) => stripDecor(l).trim()).filter(Boolean);
  const issuer = lines.find((l) => /^[A-Z]{2,8}$/.test(l));

  const trancheCode =
    parseField(text, /Tranche\s*code[:\s]+([A-Z0-9-]+)/i) ||
    `T${Date.now().toString().slice(-7)}`;

  const offeringLine =
    parseField(text, /Offering[:\s]+([^\n]+?)(?=\s+Trade[:\s]|\n|$)/i) ||
    parseField(text, /Offering[:\s]+([^\n]+)/i) || "";
  const { start: offeringStart, end: offeringEnd } = parseOffering(offeringLine);

  // Capture "Trade: 12 May 2026, 4pm" up to next field or newline.
  const tradeRaw =
    parseField(text, /Trade[:\s]+([^\n]+?)(?=\s+(?:Settlement|Tranche|Offering)\b|$)/i) ||
    parseField(text, /Trade[:\s]+([^\n]+)/i) ||
    "";
  const tradeDate = parseDate(tradeRaw);
  const tradeCutoffMatch = tradeRaw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  let tradeCutoff: string | undefined;
  if (tradeCutoffMatch) {
    const rawHour = parseInt(tradeCutoffMatch[1], 10);
    const isPm = tradeCutoffMatch[3].toLowerCase() === "pm";
    const hour24 = (rawHour % 12) + (isPm ? 12 : 0);
    const hh = String(hour24).padStart(2, "0");
    const mm = (tradeCutoffMatch[2] || "00").padStart(2, "0");
    tradeCutoff = `${hh}:${mm}`;
  }

  const settleRaw = parseField(text, /Settlement[:\s]+([^\n]+)/i) || "T+7";
  const settleMatch = settleRaw.match(/T\s*\+\s*(\d+)/i);
  const settlementOffset = settleMatch ? parseInt(settleMatch[1], 10) : 7;

  const couponMatch = text.match(/Coupon\s+(\d+(?:\.\d+)?)\s*%(?:\s*p\.?a\.?)?/i);
  const couponPa = couponMatch ? parseFloat(couponMatch[1]) / 100 : 0;
  if (!couponMatch) warnings.push({ field: "coupon", message: "Coupon not found — defaulted to 0%." });

  const tenorMatch = text.match(/Tenor\s+(\d+(?:\.\d+)?)\s*(M|Y|months|years|month|year)/i);
  let tenorMonths = 12;
  if (tenorMatch) {
    const n = parseFloat(tenorMatch[1]);
    const u = tenorMatch[2].toLowerCase();
    tenorMonths = u.startsWith("y") ? Math.round(n * 12) : Math.round(n);
  } else {
    warnings.push({ field: "tenor", message: "Tenor not found — defaulted to 12M." });
  }

  const strikePct = pct(parseField(text, /Strike\s+([0-9.]+\s*%)/i)) ?? 1.0;
  const ekiPct = pct(parseField(text, /EKI\s+([0-9.]+\s*%)/i)) ?? 0.6;

  const koLine = parseField(text, /KO\s+([^\n]+)/i) || "";
  const koStartPct = pct(koLine.match(/([0-9.]+\s*%)/)?.[1]) ?? 1.0;
  const stepdownPct = pct(koLine.match(/stepdown\s+([0-9.]+\s*%)/i)?.[1]) ?? 0;

  const koObsFreqMonths = 1; // industry default; overridable later

  const currency = detectCurrency(text) || "USD";
  if (!detectCurrency(text)) {
    warnings.push({ field: "currency", message: "Currency not found — defaulted to USD." });
  }

  const underlyings = extractTickers(text);
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
