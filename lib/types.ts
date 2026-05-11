// Domain types for the structured-notes desk.

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
  issuer?: string;
  trancheCode: string;
  currency: Currency;

  offeringStart?: string;
  offeringEnd?: string;

  tradeDate: string;
  tradeCutoff?: string;
  settlementOffset: number;
  settlementDate?: string;

  couponPa: number;
  tenorMonths: number;
  strikePct: number;
  koStartPct: number;
  koStepdownPct: number;
  ekiPct: number;
  koObsFreqMonths: number;

  underlyings: Underlying[];

  initialFixing?: Record<string, number>;
  isIndicativeFixing: boolean;

  /** Free-form notes — clients, allocation breakdown, follow-ups. */
  notes?: string;

  createdAt: string;
}

export interface PriceQuote {
  symbol: string;
  market: MarketCode;
  price: number;
  prevClose?: number;
  high52?: number;
  low52?: number;
  currency?: string;
  asOf: string;
  marketOpen: boolean;
  source: "polygon" | "finnhub" | "yahoo" | "stooq" | "alphavantage" | "cache" | "mock";
  cached?: boolean;
  delayed?: boolean;
}

export interface KoObservation {
  n: number;
  date: string;
  koPct: number;
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
  worstSymbol: string;
  pctAboveKi: number;
  pctToKo: number;
  rationale: string;
}
