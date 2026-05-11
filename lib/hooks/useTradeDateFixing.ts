"use client";
// Resolve initial fixing prices for a tranche.
//   • Trade date in the past   → fetch close on trade date from /api/trade-close
//   • Trade date today/future  → use latest close (indicative) from live quotes
// Historical closes cached in localStorage permanently — they never change.

import { useEffect, useState } from "react";
import type { MarketCode, Tranche } from "../types";

const LS_KEY = "snd.tradeclose.v1";

function loadCache(): Record<string, { close: number; effectiveDate: string; source: string }> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(window.localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
}
function saveCache(c: Record<string, { close: number; effectiveDate: string; source: string }>) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch {}
}

export interface FixingResult {
  tranche: Tranche | null;
  pending: string[];
  errors: string[];
  effectiveDates: Record<string, string>;
}

export function useTradeDateFixing(
  tranche: Tranche | null,
  liveCloses: Record<string, number | undefined>
): FixingResult {
  const [out, setOut] = useState<Tranche | null>(tranche);
  const [pending, setPending] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [eff, setEff] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!tranche) { setOut(null); return; }

    const today = new Date().toISOString().slice(0, 10);
    const isPreTrade = today < tranche.tradeDate;

    if (isPreTrade) {
      // Pre-trade: indicative fixing = latest available close.
      const fixing: Record<string, number> = {};
      const effDates: Record<string, string> = {};
      for (const u of tranche.underlyings) {
        const px = liveCloses[u.symbol];
        if (px != null) {
          fixing[u.symbol] = px;
          effDates[u.symbol] = "latest close";
        }
      }
      setOut({ ...tranche, initialFixing: fixing, isIndicativeFixing: true });
      setEff(effDates);
      setPending([]); setErrors([]);
      return;
    }

    // Post-trade: fetch the actual close on tranche.tradeDate.
    let cancelled = false;
    const cache = loadCache();
    const targets = tranche.underlyings;
    const cached: Record<string, { close: number; effectiveDate: string; source: string }> = {};
    const todo: { symbol: string; market: MarketCode; date: string; key: string }[] = [];
    for (const u of targets) {
      const k = `${u.market}:${u.symbol}@${tranche.tradeDate}`;
      if (cache[k]) cached[u.symbol] = cache[k];
      else todo.push({ symbol: u.symbol, market: u.market, date: tranche.tradeDate, key: k });
    }
    setPending(todo.map((t) => t.symbol));

    (async () => {
      const fresh: Record<string, { close: number; effectiveDate: string; source: string }> = {};
      if (todo.length) {
        const url = "/api/trade-close?items=" +
          encodeURIComponent(todo.map((t) => `${t.market}:${t.symbol}@${t.date}`).join(","));
        try {
          const r = await fetch(url, { cache: "force-cache" });
          const j = await r.json() as { closes: Array<{ symbol: string; market?: MarketCode; close: number | null; effectiveDate: string | null; source: string | null }> };
          for (const c of j.closes) {
            if (c.close != null && c.effectiveDate && c.source) {
              fresh[c.symbol] = { close: c.close, effectiveDate: c.effectiveDate, source: c.source };
              const market = c.market || tranche!.underlyings.find((u) => u.symbol === c.symbol)?.market || "US";
              cache[`${market}:${c.symbol}@${tranche!.tradeDate}`] = fresh[c.symbol];
            }
          }
          saveCache(cache);
        } catch {}
      }
      if (cancelled || !tranche) return;

      const all = { ...cached, ...fresh };
      const fixing: Record<string, number> = {};
      const effDates: Record<string, string> = {};
      const missing: string[] = [];
      for (const u of tranche.underlyings) {
        const hit = all[u.symbol];
        if (hit) { fixing[u.symbol] = hit.close; effDates[u.symbol] = hit.effectiveDate; }
        else {
          const fb = liveCloses[u.symbol];
          if (fb != null) { fixing[u.symbol] = fb; effDates[u.symbol] = "latest close (fallback)"; }
          missing.push(u.symbol);
        }
      }
      const allResolved = missing.length === 0;
      setOut({
        ...tranche,
        initialFixing: fixing,
        isIndicativeFixing: !allResolved,
      });
      setEff(effDates);
      setPending([]); setErrors(missing);
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tranche?.tradeDate, JSON.stringify(tranche?.underlyings.map(u => u.symbol)), JSON.stringify(liveCloses)]);

  return { tranche: out, pending, errors, effectiveDates: eff };
}
