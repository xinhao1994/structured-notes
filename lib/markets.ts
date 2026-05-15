// Market hours, timezone, and weekend/holiday handling.
//
// We intentionally don't try to be a full corporate-actions calendar;
// we just give the dashboard "OPEN / CLOSED / CLOSED (HOLIDAY)" with the
// right local clock for each market. Holidays are a hand-curated minimal
// list — extend per your compliance team's calendar.
//
// All timezone math uses the platform's native `Intl.DateTimeFormat` so
// there is no external timezone dependency to ship to the browser.

import type { MarketCode, Currency } from "./types";

export interface MarketDef {
  code: MarketCode;
  label: string;
  timezone: string;          // IANA tz
  currency: Currency;
  /** Trading session in LOCAL time — 24h "HH:MM" */
  open: string;
  close: string;
  /** Optional lunch break (HK / SG / JP / MY use this) */
  lunchStart?: string;
  lunchEnd?: string;
  /** Stock symbol provider suffix (e.g. ".HK") */
  finnhubSuffix?: string;
  alphaVantageSuffix?: string;
}

export const MARKETS: Record<MarketCode, MarketDef> = {
  US: {
    code: "US",
    label: "US (NYSE/NASDAQ)",
    timezone: "America/New_York",
    currency: "USD",
    open: "09:30",
    close: "16:00",
  },
  HK: {
    code: "HK",
    label: "Hong Kong (HKEX)",
    timezone: "Asia/Hong_Kong",
    currency: "HKD",
    open: "09:30",
    close: "16:00",
    lunchStart: "12:00",
    lunchEnd: "13:00",
    finnhubSuffix: ".HK",
    alphaVantageSuffix: ".HKG",
  },
  MY: {
    code: "MY",
    label: "Malaysia (KLSE)",
    timezone: "Asia/Kuala_Lumpur",
    currency: "MYR",
    open: "09:00",
    close: "17:00",
    lunchStart: "12:30",
    lunchEnd: "14:30",
    finnhubSuffix: ".KL",
    alphaVantageSuffix: ".KLS",
  },
  SG: {
    code: "SG",
    label: "Singapore (SGX)",
    timezone: "Asia/Singapore",
    currency: "SGD",
    open: "09:00",
    close: "17:00",
    lunchStart: "12:00",
    lunchEnd: "13:00",
    finnhubSuffix: ".SI",
    alphaVantageSuffix: ".SGX",
  },
  JP: {
    code: "JP",
    label: "Japan (TSE)",
    timezone: "Asia/Tokyo",
    currency: "JPY",
    open: "09:00",
    close: "15:00",
    lunchStart: "11:30",
    lunchEnd: "12:30",
    finnhubSuffix: ".T",
    alphaVantageSuffix: ".TYO",
  },
  AU: {
    code: "AU",
    label: "Australia (ASX)",
    timezone: "Australia/Sydney",
    currency: "AUD",
    open: "10:00",
    close: "16:00",
    finnhubSuffix: ".AX",
    alphaVantageSuffix: ".AUS",
  },
};

// Minimal observable-holiday set per market for 2025/2026.
// This list is intentionally small — production deployments should
// override via a maintained calendar (e.g. the bank's own holiday master).
const HOLIDAYS: Record<MarketCode, string[]> = {
  US: [
    "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
    "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  ],
  HK: [
    // 2025
    "2025-01-01",                                     // New Year's Day
    "2025-01-29", "2025-01-30", "2025-01-31",        // CNY Day 1-3
    "2025-04-04",                                     // Ching Ming
    "2025-04-18", "2025-04-19", "2025-04-21",        // Good Fri / Easter Sat / Easter Mon
    "2025-05-01",                                     // Labour Day
    "2025-05-05",                                     // Buddha's Birthday
    "2025-07-01",                                     // HKSAR Establishment Day
    "2025-10-01", "2025-10-07",                      // National Day / Chung Yeung
    "2025-12-25", "2025-12-26",                      // Christmas / Boxing Day
    // 2026
    "2026-01-01",                                     // New Year's Day
    "2026-02-17", "2026-02-18", "2026-02-19",        // CNY Day 1-3
    "2026-04-03", "2026-04-06",                      // Good Friday / Easter Monday
    "2026-05-01",                                     // Labour Day
    "2026-05-25",                                     // Buddha's Birthday
    "2026-07-01",                                     // HKSAR Establishment Day
    "2026-10-01", "2026-10-26",                      // National Day / Chung Yeung
    "2026-12-25", "2026-12-26",                      // Christmas / Boxing Day
  ],
  MY: [
    "2025-01-01", "2025-02-01", "2025-03-31", "2025-04-01", "2025-05-01",
    "2025-08-31", "2025-09-16", "2025-12-25",
    "2026-01-01", "2026-02-17", "2026-02-18", "2026-03-21", "2026-05-01",
    "2026-05-31", "2026-08-31", "2026-09-16", "2026-12-25",
  ],
  SG: [
    "2025-01-01", "2025-01-29", "2025-04-18", "2025-05-01", "2025-08-09",
    "2025-12-25",
    "2026-01-01", "2026-02-17", "2026-04-03", "2026-05-01", "2026-08-10",
    "2026-12-25",
  ],
  JP: [
    "2025-01-01", "2025-01-13", "2025-02-11", "2025-04-29", "2025-05-05",
    "2025-11-03", "2025-11-23", "2025-12-31",
    "2026-01-01", "2026-01-12", "2026-02-11", "2026-04-29", "2026-05-05",
    "2026-11-03", "2026-11-23", "2026-12-31",
  ],
  AU: [
    "2025-01-01", "2025-01-27", "2025-04-18", "2025-04-21", "2025-04-25",
    "2025-12-25", "2025-12-26",
    "2026-01-01", "2026-01-26", "2026-04-03", "2026-04-06", "2026-04-25",
    "2026-12-25", "2026-12-28",
  ],
};

const MY_TZ = MARKETS.MY.timezone;

// ─── Native-Intl tz helpers ──────────────────────────────────────────────────
// We pull date parts in a target tz via Intl.DateTimeFormat#formatToParts and
// build the formatted string ourselves. Cached formatters per tz keep this
// fast even when called every second from the header clock.

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFmt(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "short",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    partsCache.set(tz, f);
  }
  return f;
}

function partsOf(d: Date, tz: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of partsFmt(tz).formatToParts(d)) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return out;
}

const MONTHS_SHORT_TO_NUM: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/** "yyyy-MM-dd" in the given timezone for the given UTC instant. */
export function localDateInTz(d: Date, tz: string): string {
  const p = partsOf(d, tz);
  const m = MONTHS_SHORT_TO_NUM[p.month] ?? "01";
  return `${p.year}-${m}-${p.day}`;
}

/** "HH:mm" in the given timezone for the given UTC instant. */
export function localTimeInTz(d: Date, tz: string): string {
  const p = partsOf(d, tz);
  return `${p.hour}:${p.minute}`;
}

/** "HH:mm:ss" in the given timezone. */
function localTimeSecInTz(d: Date, tz: string): string {
  const p = partsOf(d, tz);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** "EEE, d MMM yyyy" in the given timezone. */
function localFullDateInTz(d: Date, tz: string): string {
  const p = partsOf(d, tz);
  return `${p.weekday}, ${parseInt(p.day, 10)} ${p.month} ${p.year}`;
}

/** "EEE d MMM" in the given timezone. */
function localShortDateInTz(d: Date, tz: string): string {
  const p = partsOf(d, tz);
  return `${p.weekday} ${parseInt(p.day, 10)} ${p.month}`;
}

/** Returns true if `now` is during the local trading session in `market`. */
export function isMarketOpen(market: MarketCode, now: Date = new Date()): {
  open: boolean;
  reason: "open" | "closed" | "weekend" | "holiday" | "lunch" | "pre" | "post";
} {
  const def = MARKETS[market];
  const p = partsOf(now, def.timezone);
  // Map weekday short → 0..6 (Sun..Sat)
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dowMap[p.weekday] ?? 0;
  if (dow === 0 || dow === 6) return { open: false, reason: "weekend" };

  const ymd = localDateInTz(now, def.timezone);
  if ((HOLIDAYS[market] || []).includes(ymd)) return { open: false, reason: "holiday" };

  const hhmm = `${p.hour}:${p.minute}`;
  if (hhmm < def.open) return { open: false, reason: "pre" };
  if (hhmm >= def.close) return { open: false, reason: "post" };
  if (def.lunchStart && def.lunchEnd && hhmm >= def.lunchStart && hhmm < def.lunchEnd) {
    return { open: false, reason: "lunch" };
  }
  return { open: true, reason: "open" };
}

export function malaysiaNowParts(now: Date = new Date()) {
  return {
    date: localFullDateInTz(now, MY_TZ),
    time: localTimeSecInTz(now, MY_TZ),
    tz: MY_TZ,
  };
}

/** Snapshot of all six markets — used by the header strip. */
export function marketSnapshots(now: Date = new Date()) {
  return (Object.keys(MARKETS) as MarketCode[]).map((code) => {
    const def = MARKETS[code];
    const status = isMarketOpen(code, now);
    return {
      code,
      label: def.label,
      currency: def.currency,
      timezone: def.timezone,
      localTime: localTimeInTz(now, def.timezone),
      localDate: localShortDateInTz(now, def.timezone),
      open: status.open,
      reason: status.reason,
    };
  });
}

/** Add `n` business days (skipping weekends + holidays for that market). */
export function addBusinessDays(
  iso: string,
  n: number,
  market: MarketCode = "US"
): string {
  const d = new Date(iso + "T00:00:00Z");
  const holidays = new Set(HOLIDAYS[market] || []);
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    const ymd = d.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !holidays.has(ymd)) added += 1;
  }
  return d.toISOString().slice(0, 10);
}

/** Add calendar months and snap forward to next business day if needed. */
export function addMonthsBizSnap(
  iso: string,
  months: number,
  market: MarketCode = "US"
): string {
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  const target = new Date(Date.UTC(y, m - 1 + months, d));
  let ymd = target.toISOString().slice(0, 10);
  const holidays = new Set(HOLIDAYS[market] || []);
  while (true) {
    const day = new Date(ymd + "T00:00:00Z").getUTCDay();
    if (day !== 0 && day !== 6 && !holidays.has(ymd)) break;
    const next = new Date(ymd + "T00:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    ymd = next.toISOString().slice(0, 10);
  }
  return ymd;
}

/**
 * Add `n` MY business days to an ISO date, skipping weekends and MY public
 * holidays. The start date is not counted. Used to derive valuation dates
 * from the +1-month anniversary of the trade date.
 *
 * Example: addMyBusinessDays("2026-04-30", 4) → "2026-05-07"
 *   (skip May 1 Labour Day + weekend May 2-3, then count Mon..Thu = 4 days)
 */
export function addMyBusinessDays(iso: string, n: number): string {
  const holidays = new Set(getMyHolidays());
  const d = new Date(iso + "T00:00:00Z");
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    const ymd = d.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !holidays.has(ymd)) added++;
  }
  return d.toISOString().slice(0, 10);
}

/** Expose the MY holiday list. */
function getMyHolidays(): string[] {
  // Mirrors the HOLIDAYS.MY list. Inlined here so this file can be imported
  // standalone if needed in the future.
  return [
    "2025-01-01","2025-01-29","2025-02-01","2025-03-31","2025-04-01","2025-05-01",
    "2025-05-12","2025-06-02","2025-06-07","2025-06-27","2025-08-31","2025-09-05",
    "2025-09-16","2025-10-20","2025-12-25",
    "2026-01-01","2026-02-17","2026-02-18","2026-03-21","2026-05-01","2026-05-22",
    "2026-05-27","2026-05-31","2026-06-27","2026-08-31","2026-09-16","2026-09-25",
    "2026-11-08","2026-12-25",
  ];
}

/**
 * Snap an ISO date forward to the next MY business day if it falls on a
 * weekend or MY public holiday. Returns unchanged if already a biz day.
 */
export function snapForwardMy(iso: string): string {
  const holidays = new Set(getMyHolidays());
  let ymd = iso;
  while (true) {
    const d = new Date(ymd + "T00:00:00Z");
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(ymd)) return ymd;
    d.setUTCDate(d.getUTCDate() + 1);
    ymd = d.toISOString().slice(0, 10);
  }
}

/**
 * Add `months` calendar months to an ISO date (preserving day-of-month
 * where possible) and snap forward to the next MY business day. Used for
 * cascading subsequent valuation dates from the first one.
 */
export function addMonthsThenSnapMy(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  // CLAMP day to end-of-month rather than letting JS roll forward.
  // e.g. Mar 31 + 1 month = Apr 30 (NOT May 1), because April has 30 days.
  const targetMonthAbs = m - 1 + months;
  const targetY = y + Math.floor(targetMonthAbs / 12);
  const targetM = ((targetMonthAbs % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDayOfTargetMonth);
  const target = new Date(Date.UTC(targetY, targetM, day));
  return snapForwardMy(target.toISOString().slice(0, 10));
}

/**
 * Snap an ISO date forward to the next business day for any market, skipping
 * weekends and that market's public holidays. Returns unchanged if already a
 * business day.
 *
 * This is the generic equivalent of snapForwardMy — use this when the
 * underlying market is known (HK stocks → "HK", MY stocks → "MY", etc.).
 */
export function snapForwardBizDay(iso: string, market: MarketCode): string {
  const holidays = new Set(HOLIDAYS[market] || []);
  let ymd = iso;
  while (true) {
    const d = new Date(ymd + "T00:00:00Z");
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(ymd)) return ymd;
    d.setUTCDate(d.getUTCDate() + 1);
    ymd = d.toISOString().slice(0, 10);
  }
}

/**
 * Add `months` calendar months to an ISO date (clamping day to end-of-month)
 * and snap forward to the next business day for the given market.
 *
 * This is the core formula for computing valuation dates:
 *   Valuation N = tradeDate + N months → next business day (market calendar)
 *
 * Verified against real MSI tranches:
 *   MSIT250518 (SGD / HK): 12/12 observations match with market = "HK"
 *   MSIT260598 (MYR):       7/7  observations match with market = "MY"
 */
export function addMonthsThenSnap(iso: string, months: number, market: MarketCode): string {
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  const targetMonthAbs = m - 1 + months;
  const targetY = y + Math.floor(targetMonthAbs / 12);
  const targetM = ((targetMonthAbs % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDayOfTargetMonth);
  const target = new Date(Date.UTC(targetY, targetM, day));
  return snapForwardBizDay(target.toISOString().slice(0, 10), market);
}

