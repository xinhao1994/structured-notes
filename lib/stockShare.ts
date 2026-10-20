"use client";

export const STOCK_PREFIX = "[[STOCK]]";

export interface StockSnap {
  symbol: string;
  market: string;
  longName: string;
  price: number | null;
  currency: string | null;
  marketCap: number | null;
  perf30d: number | null;
  forwardPE: number | null;
  sector: string | null;
}

export function encodeStock(s: StockSnap): string {
  if (typeof window === "undefined") return "";
  const json = JSON.stringify(s);
  return STOCK_PREFIX + window.btoa(unescape(encodeURIComponent(json)));
}

export function decodeStock(body: string): StockSnap | null {
  if (typeof window === "undefined") return null;
  if (!body.startsWith(STOCK_PREFIX)) return null;
  try {
    const b64 = body.slice(STOCK_PREFIX.length);
    const json = decodeURIComponent(escape(window.atob(b64)));
    return JSON.parse(json) as StockSnap;
  } catch { return null; }
}
