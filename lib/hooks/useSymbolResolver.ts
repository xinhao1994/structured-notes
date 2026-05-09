"use client";
// Auto-resolve underlying tickers via /api/symbol-search.
//
// When the parser flags an underlying with `resolved: false` (e.g. user
// pasted "Western Digital US" instead of "WDC US"), this hook calls the
// Finnhub-backed search route once per unresolved name and returns a
// patched Tranche. Cached in-memory per session to avoid repeat lookups.

import { useEffect, useState } from "react";
import type { Tranche, Underlying } from "../types";

const cache = new Map<string, string | null>();

export function useSymbolResolver(tranche: Tranche | null): {
  resolved: Tranche | null;
  pending: number;
  errors: string[];
} {
  const [out, setOut] = useState<Tranche | null>(tranche);
  const [pending, setPending] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!tranche) { setOut(null); return; }
    const needs = tranche.underlyings.filter((u) => u.resolved === false);
    if (!needs.length) { setOut(tranche); setPending(0); setErrors([]); return; }

    let cancelled = false;
    setPending(needs.length);
    setErrors([]);

    const promises = needs.map(async (u) => {
      const key = `${u.market}:${u.rawName.toLowerCase()}`;
      if (cache.has(key)) return { u, sym: cache.get(key) };
      try {
        const r = await fetch(
          `/api/symbol-search?q=${encodeURIComponent(stripParens(u.rawName))}&market=${u.market}`,
          { cache: "force-cache" }
        );
        const j = await r.json();
        const sym = j?.symbol || null;
        cache.set(key, sym);
        return { u, sym };
      } catch {
        return { u, sym: null as string | null };
      }
    });

    Promise.all(promises).then((results) => {
      if (cancelled) return;
      const newErrors: string[] = [];
      const patched: Underlying[] = tranche.underlyings.map((u) => {
        const hit = results.find((r) => r.u.symbol === u.symbol && r.u.market === u.market);
        if (!hit) return u;
        if (hit.sym) {
          return { ...u, symbol: hit.sym, resolved: true };
        }
        newErrors.push(u.rawName);
        return u;
      });
      setOut({ ...tranche, underlyings: patched });
      setPending(0);
      setErrors(newErrors);
    });

    return () => { cancelled = true; };
  }, [tranche]);

  return { resolved: out, pending, errors };
}

function stripParens(s: string): string {
  return s.replace(/\([^)]*\)/g, "").trim();
}
