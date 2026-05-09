"use client";
// Client hook: poll /api/prices on a configurable interval.
// Pauses when the tab is hidden, resumes on focus — saves API calls.

import { useEffect, useRef, useState } from "react";
import type { MarketCode, PriceQuote } from "../types";

export function useQuotes(
  items: { symbol: string; market: MarketCode }[],
  intervalMs = 15_000
): {
  quotes: Record<string, PriceQuote | undefined>;
  loading: boolean;
  asOf: string | null;
  refresh: () => void;
} {
  const [quotes, setQuotes] = useState<Record<string, PriceQuote | undefined>>({});
  const [loading, setLoading] = useState(false);
  const [asOf, setAsOf] = useState<string | null>(null);
  const aborter = useRef<AbortController | null>(null);

  const key = items.map((i) => `${i.market}:${i.symbol}`).join(",");

  async function pull() {
    if (!key) return;
    aborter.current?.abort();
    const ctl = new AbortController();
    aborter.current = ctl;
    try {
      setLoading(true);
      const r = await fetch(`/api/prices?items=${encodeURIComponent(key)}`, {
        signal: ctl.signal,
        cache: "no-store",
      });
      const j = (await r.json()) as { quotes: PriceQuote[] };
      const map: Record<string, PriceQuote> = {};
      for (const q of j.quotes) map[q.symbol] = q;
      setQuotes(map);
      setAsOf(new Date().toISOString());
    } catch {
      /* swallow — UI shows last good values */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    pull();
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      stop();
      timer = setInterval(pull, intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVis = () => (document.hidden ? stop() : (pull(), start()));
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
      aborter.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, intervalMs]);

  return { quotes, loading, asOf, refresh: pull };
}
