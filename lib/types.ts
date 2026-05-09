// Domain types for the structured-notes desk.
// Kept narrow on purpose — every field is something the parser, calc engine,
// or UI actually reads. If you add a field here, plumb it through both sides.

export type MarketCode =
  | "US"
  | "HK"
  | "MY"
  | "SG"
  | "JP"
  | "AU";

export type Currency = "USD" | "HKD" | "MYR" | "SGD" | "JPY" | "AUD";

export interface Underlying {
  /** Display ticker as parsed (e.g. "TSM", "Broadcom", "Google") */
  rawName: string;
  /** Provider symbol used for price lookups (e.g. "TSM", "AVGO", "GOOGL") */
  symbol: string;
  /** Market this stock trades on — drives timezone & holiday calendar */
  market: MarketCode;
  /**
   * False if the parser had to guess (e.g. user pasted the company name
   * "Western Digital" instead of the ticker "WDC"). The client side will
   * try /api/symbol-search to upgrade it; until then the dashboard shows
   * a warning chip and the price source is "mock" or empty.
   */
  resolved?: boolean;
}

export interface Tranche {
  /** Issuer/desk code, e.g. "MSI" */
  issuer?: string;
  /** Tranche identifier, e.g. "MSIT260592" */
  trancheCode: string;
  /** Settlement currency */
  currency: Currency;

  /** Offering window */
  offeringStart?: string; // ISO date
  offeringEnd?: string;   // ISO date

  /** Trade (initial fixing) date — usually a market close cutoff */
  tradeDate: string;     // ISO date
  tradeCutoff?: string;  // optional time-of-day, e.g. "16:00"
  /** T+N business-day settlement */
  settlementOffset: number;
  /** Computed settlement date (ISO) */
  settlementDate?: string;

  /** Coupon p.a. (decimal, 0.09 = 9%) */
  couponPa: number;
  /** Tenor in months */
  tenorMonths: number;
  /** Strike level vs. initial (1.00 = 100%) */
  strikePct: number;
  /** Initial KO level vs. initial (1.08 = 108%) */
  koStartPct: number;
  /** Stepdown applied each KO observation (0.04 = 4%) */
  koStepdownPct: number;
  /** EKI / barrier (0.60 = 60%) */
  ekiPct: number;
  /** Observation frequency in months (default 1 = monthly) */
  koObsFreqMonths: number;

  /** Underlying baskets */
  underlyings: Underlying[];

  /** Initial fixing — null until trade date passes */
  initialFixing?: Record<string, number>;
  /** True if the initialFixing dictionary holds INDICATIVE values (pre-trade) */
  isIndicativeFixing: boolean;

  /** Free-form notes */
  notes?: string;

  /** ISO timestamp the tranche was first parsed */
  createdAt: string;
}

export interface PriceQuote {
  symbol: string;
  market: MarketCode;
  /** Last traded / latest available price */
  price: number;
  /** Previous close (for daily change %) */
  prevClose?: number;
  /** 52-week high/low */
  high52?: number;
  low52?: number;
  /** Currency the price is quoted in */
  currency?: string;
  /** ISO timestamp of the quote */
  asOf: string;
  /** Was this quote returned during local market hours? */
  marketOpen: boolean;
  /** Provider that satisfied the request */
  source: "polygon" | "finnhub" | "alphavantage" | "cache" | "mock";
  /** True if served from server cache */
  cached?: boolean;
  /** True if the underlying market was closed when we last fetched */
  delayed?: boolean;
}

export interface KoObservation {
  /** 1-based index */
  n: number;
  /** ISO date */
  date: string;
  /** KO trigger (1.08 = 108%) for this observation */
  koPct: number;
  /** Implied KO price for each underlying */
  koPriceBySymbol: Record<string, number>;
}

export type RiskBand =
  | "safe"
  | "moderate"
  | "near-ko"
  | "near-ki"
  | "high-risk"
  | "critical";

export interface RiskAssessment {
  band: RiskBand;
  // Worst-of underlying — the tranche's actual risk driver.
  worstSymbol: string;
  // Distance from spot to KI as a percent of spot (positive = above KI).
  pctAboveKi: number;
  // Distance from spot to current KO trigger as a percent of spot.
  pctToKo: number;
  // Free-text reasoning for the operator.
  rationale: string;
}
