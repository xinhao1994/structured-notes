"use client";
// Resolve the "initial fixing" prices for a tranche.
//
//   • Trade date is TODAY or LATER  → indicative fixing (latest close shown
//     in `quotes.prevClose`). Returns the tranche unchanged; the page-level
//     code already populates indicative fixing from the live feed.
//
//   • Trade date is in the PAST     → ACTUAL fixing. We hit
//     /api/historical-close to get the real closing price on the trade date
//     and patch the tranche.initialFixing accordingly. Aggressively cached
//     in localStorage because historical closes are immutable.

import { useEffect, useState } from "react";
import type { MarketCode, Tranche } from "../types";

const LS_KEY = "snd.histclose.v1";

function loadCache(): Record<string, { close: number; effectiveDate: string; source: string }> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(LS_KEY) || "{}");
  } catch { return {}; }
}
function saveCache(c: Record<string, { close: number; effectiveDate: string; source: string }>) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch {}
}

export interface FixingResolution {
  /** The patched tranche, with initialFixing populated from real history when applicable. */
  tranche: Tranche | null;
  /** Symbols still being fetched. */
  pending: string[];
  /** Symbols where no provider returned data — UI should fall back to indicative. */
  errors: string[];
  /** For each symbol: the date of the close we actually used. */
  effectiveDates: Record<string, string>;
  /** Where each fixing came from (provider name or "live"). */
  sources: Record<string, string>;
}

export function useHistoricalFixings(
  tranche: Tranche | null,
  prevCloses: Record<string, number | undefined>
): FixingResolution {
  const [out, setOut] = useState<Tranche | null>(tranche);
  const [pending, setPending] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [effectiveDates, setEff] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!tranche) { setOut(null); setPending([]); setErrors([]); return; }

    const today = new Date().toISOString().slice(0, 10);
    const isPreTrade = today < tranche.tradeDate;

    if (isPreTrade) {
      // Indicative — use the latest close (prevClose) directly. No API call.
      const fixing: Record<string, number> = {};
      const eff: Record<string, string> = {};
      const src: Record<string, string> = {};
      for (const u of tranche.underlyings) {
        const px = prevCloses[u.symbol];
        if (px != null) {
          fixing[u.symbol] = px;
          eff[u.symbol] = "latest close";
          src[u.symbol] = "live";
        }
      }
      setOut({ ...tranche, initialFixing: fixing, isIndicativeFixing: true });
      setEff(eff); setSources(src);
      setPending([]); setErrors([]);
      return;
    }

    // Post-trade — need historical closes on the trade date.
    let cancelled = false;
    const cache = loadCache();
    const targets = tranche.underlyings;
    const items = targets.map((u) => `${u.market}:${u.symbol}@${tranche.tradeDate}`);
    const cached: Record<string, { close: number; effectiveDate: string; source: string }> = {};
    const todo: { symbol: string; market: MarketCode; date: string; key: string }[] = [];
    for (const u of targets) {
      const k = `${u.market}:${u.symbol}@${tranche.tradeDate}`;
      if (cache[k]) cached[u.symbol] = cache[k];
      else todo.push({ symbol: u.symbol, market: u.market, date: tranche.tradeDate, key: k });
    }
    setPending(todo.map((t) => t.symbol));

    async function fetchMissing() {
      const fresh: Record<string, { close: number; effectiveDate: string; source: string }> = {};
      if (todo.length) {
        const url = "/api/historical-close?items=" + encodeURIComponent(todo.map((t) => `${t.market}:${t.symbol}@${t.date}`).join(","));
        try {
          const r = await fetch(url, { cache: "force-cache" });
          const j = await r.json() as { closes: Array<{ symbol: string; close: number | null; effectiveDate: string | null; source: string | null }> };
          for (const c of j.closes) {
            if (c.close != null && c.effectiveDate && c.source) {
              fresh[c.symbol] = { close: c.close, effectiveDate: c.effectiveDate, source: c.source };
              const k = `${(c as any).market || tranche!.underlyings.find((u) => u.symbol === c.symbol)?.market || "US"}:${c.symbol}@${tranche!.tradeDate}`;
              cache[k] = fresh[c.symbol];
            }
          }
          saveCache(cache);
        } catch { /* swallow — fall through to errors */ }
      }
      if (cancelled || !tranche) return;

      const all = { ...cached, ...fresh };
      const fixing: Record<string, number> = {};
      const eff: Record<string, string> = {};
      const src: Record<string, string> = {};
      const missing: string[] = [];
      for (const u of tranche.underlyings) {
        const hit = all[u.symbol];
        if (hit) {
          fixing[u.symbol] = hit.close;
          eff[u.symbol] = hit.effectiveDate;
          src[u.symbol] = hit.source;
        } else {
          // Provider had nothing — fall back to latest close so the UI
          // still renders, but flag it as indicative.
          const fallback = prevCloses[u.symbol];
          if (fallback != null) {
            fixing[u.symbol] = fallback;
            eff[u.symbol] = "latest close (fallback)";
            src[u.symbol] = "live";
          }
          missing.push(u.symbol);
        }
      }
      const allResolved = missing.length === 0;
      setOut({
        ...tranche,
        initialFixing: fixing,
        // If we got real history for everything, fixing is "actual".
        // If we had to fall back for any symbol, mark the whole thing indicative
        // so users don't trust the calculations blindly.
        isIndicativeFixing: !allResolved,
      });
      setEff(eff); setSources(src);
      setPending([]); setErrors(missing);
    }

    fetchMissing();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tranche?.tradeDate, JSON.stringify(tranche?.underlyings.map((u) => u.symbol)), JSON.stringify(prevCloses)]);

  return { tranche: out, pending, errors, effectiveDates, sources };
}
