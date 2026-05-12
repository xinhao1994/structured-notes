"use client";
// Resolve the actual close price on every PAST KO observation date.
//
// Rationale: KO triggers at observation #n iff the worst-of underlying's
// official close on date d_n is at or above its KO price for that obs.
// Intraday wicks don't count — autocallable notes observe the official
// close in the underlying's home session (US session for US stocks, HK
// session for HK stocks, etc.). Yahoo's historical chart API already
// returns the local-session close, so /api/trade-close handles this for us.
//
// Returned shape: Record<obsN, Record<symbol, { close, effectiveDate, source }>>
// Future observations are NOT included (they don't have a close yet).
//
// Historical closes are immutable so we cache them in localStorage
// forever, keyed by `${market}:${symbol}@${date}`. The same cache key
// scheme as useTradeDateFixing — they share entries.

import { useEffect, useState } from "react";
import type { MarketCode, Tranche } from "../types";
import { koSchedule } from "../calc";

const LS_KEY = "snd.tradeclose.v1";

interface CacheEntry { close: number; effectiveDate: string; source: string; }

function loadCache(): Record<string, CacheEntry> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(window.localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
}
function saveCache(c: Record<string, CacheEntry>): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch {}
}

export type ObservationCloses = Record<number, Record<string, CacheEntry>>;

export function useObservationCloses(tranche: Tranche | null): {
  closes: ObservationCloses;
  pending: boolean;
  missing: Array<{ obsN: number; symbol: string; date: string }>;
} {
  const [closes, setCloses] = useState<ObservationCloses>({});
  const [pending, setPending] = useState(false);
  const [missing, setMissing] = useState<Array<{ obsN: number; symbol: string; date: string }>>([]);

  useEffect(() => {
    if (!tranche) { setCloses({}); setPending(false); setMissing([]); return; }
    const today = new Date().toISOString().slice(0, 10);
    const sched = koSchedule(tranche);
    const pastObs = sched.filter((o) => o.date < today);
    if (pastObs.length === 0) { setCloses({}); setPending(false); setMissing([]); return; }

    let cancelled = false;
    const cache = loadCache();
    // Build the work list: every (obsN, symbol, market, date) that's not cached.
    const cached: ObservationCloses = {};
    const todo: Array<{ obsN: number; symbol: string; market: MarketCode; date: string; key: string }> = [];
    for (const o of pastObs) {
      cached[o.n] = {};
      for (const u of tranche.underlyings) {
        const key = `${u.market}:${u.symbol}@${o.date}`;
        if (cache[key]) cached[o.n][u.symbol] = cache[key];
        else todo.push({ obsN: o.n, symbol: u.symbol, market: u.market, date: o.date, key });
      }
    }

    if (todo.length === 0) {
      setCloses(cached); setPending(false); setMissing([]);
      return;
    }

    setPending(true);

    (async () => {
      // Group all (market:symbol@date) tuples into a single request — the API
      // route accepts a comma-separated list and parallel-fetches them.
      const url = "/api/trade-close?items=" +
        encodeURIComponent(todo.map((t) => `${t.market}:${t.symbol}@${t.date}`).join(","));
      const fresh: ObservationCloses = JSON.parse(JSON.stringify(cached));
      const miss: typeof todo = [];
      try {
        const r = await fetch(url, { cache: "force-cache" });
        const j = await r.json() as { closes: Array<{
          symbol: string;
          market?: MarketCode;
          requestedDate?: string;
          effectiveDate: string | null;
          close: number | null;
          source: string | null;
        }> };
        // Build a lookup so we can map closes back to (obsN, symbol).
        const byKey: Record<string, CacheEntry> = {};
        for (const c of j.closes) {
          if (c.close != null && c.effectiveDate && c.source && c.requestedDate) {
            const mkt = c.market || "US";
            const k = `${mkt}:${c.symbol}@${c.requestedDate}`;
            byKey[k] = { close: c.close, effectiveDate: c.effectiveDate, source: c.source };
            cache[k] = byKey[k];
          }
        }
        for (const t of todo) {
          const hit = byKey[t.key];
          if (hit) fresh[t.obsN][t.symbol] = hit;
          else miss.push(t);
        }
        saveCache(cache);
      } catch {
        for (const t of todo) miss.push(t);
      }
      if (cancelled) return;
      setCloses(fresh);
      setMissing(miss.map((m) => ({ obsN: m.obsN, symbol: m.symbol, date: m.date })));
      setPending(false);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tranche?.trancheCode,
    tranche?.tradeDate,
    tranche?.tenorMonths,
    tranche?.koStartPct,
    tranche?.koStepdownPct,
    JSON.stringify(tranche?.underlyings.map((u) => `${u.market}:${u.symbol}`) ?? []),
  ]);

  return { closes, pending, missing };
}
