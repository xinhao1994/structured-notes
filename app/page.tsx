"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ProductParser } from "@/components/ProductParser";
import { ProductTable } from "@/components/ProductTable";
import { Dashboard } from "@/components/Dashboard";
import { KOSchedule } from "@/components/KOSchedule";
import { Analytics } from "@/components/Charts";
import { ParseResult } from "@/lib/parser";
import { useQuotes } from "@/lib/hooks/useQuotes";
import { useSymbolResolver } from "@/lib/hooks/useSymbolResolver";
import { useTradeDateFixing } from "@/lib/hooks/useTradeDateFixing";
import { upsertTranche, getCurrentParsedText, setCurrentParsedText, getFixingOverrides, setFixingOverride } from "@/lib/storage";
import { SAMPLE_TRANCHE_TEXT } from "@/lib/sample";
import { parseTrancheText } from "@/lib/parser";
import type { Tranche } from "@/lib/types";
import { BookmarkPlus, BellRing, AlertTriangle, Wallet, Check } from "lucide-react";

export default function HomePage() {
  // Don't parse anything during SSR (localStorage isn't there). We hydrate the
  // parsed tranche on first client render so the latest paste survives
  // navigating Desk → Pocket → Desk.
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const saved = getCurrentParsedText();
    const text = saved && saved.trim() ? saved : SAMPLE_TRANCHE_TEXT;
    setParsed(parseTrancheText(text));
    if (!saved) setCurrentParsedText(text);   // remember the sample so the calc default is consistent
  }, []);

  const parsedTranche = parsed?.tranche;
  const { resolved: tranche, pending: resolverPending, errors: resolverErrors } =
    useSymbolResolver(parsedTranche ?? null);

  const items = useMemo(
    () => (tranche?.underlyings ?? []).map((u) => ({ symbol: u.symbol, market: u.market })),
    [tranche]
  );
  const { quotes, loading, asOf, refresh } = useQuotes(items, 15_000);

  // Latest available price per underlying.
  // For future-dated tranches (pre-trade), the user wants this to mirror the
  // live trading price — current intraday when market is open, last close
  // when market is closed. q.price already represents exactly that.
  // It's also the fallback when a historical-close lookup fails.
  const liveCloses = useMemo(() => {
    const m: Record<string, number | undefined> = {};
    for (const sym of Object.keys(quotes)) {
      const q = quotes[sym];
      if (q) m[sym] = q.price;
    }
    return m;
  }, [quotes]);

  // Pre-trade → indicative (latest close).
  // Post-trade → ACTUAL close fetched from /api/trade-close on the trade date.
  const fixingResult = useTradeDateFixing(tranche, liveCloses);
  const baseTranche: Tranche | null = fixingResult.tranche;

  // Manual override layer: any value the user has typed in the Initial Fixing
  // column overrides whatever the auto-fetch returned. Re-reads on every
  // render so changes from ProductTable's inline edits are reflected immediately.
  const [overrideTick, setOverrideTick] = useState(0);
  const refreshOverrides = () => setOverrideTick((n) => n + 1);

  const trancheWithFixing: Tranche | null = useMemo(() => {
    if (!baseTranche) return null;
    const overrides = getFixingOverrides(baseTranche.trancheCode);
    if (Object.keys(overrides).length === 0) return baseTranche;
    const fixing = { ...(baseTranche.initialFixing ?? {}) };
    for (const sym of Object.keys(overrides)) {
      if (isFinite(overrides[sym]) && overrides[sym] > 0) fixing[sym] = overrides[sym];
    }
    return { ...baseTranche, initialFixing: fixing };
    // overrideTick included so changes from ProductTable trigger recompute
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseTranche, overrideTick]);

  function handleSetOverride(symbol: string, value: number | null) {
    if (!baseTranche) return;
    setFixingOverride(baseTranche.trancheCode, symbol, value);
    refreshOverrides();
  }

  function handleParsed(r: ParseResult, _rawText: string) {
    setParsed(r);
    setSaved(false);
  }

  function handleSaveToPocket() {
    if (!trancheWithFixing) return;
    upsertTranche(trancheWithFixing);
    setSaved(true);
    setTimeout(() => setSaved(false), 6000);
  }

  return (
    <>
      <ProductParser onParsed={handleParsed} />

      {parsed?.warnings.length ? (
        <div className="card mb-3 border-l-4 border-l-warning p-3 text-[12.5px]">
          <div className="mb-1 flex items-center gap-2 font-semibold text-warning">
            <AlertTriangle size={14} /> Parser warnings
          </div>
          <ul className="list-disc pl-5 text-[var(--text-muted)]">
            {parsed.warnings.map((w, i) => (
              <li key={i}>
                <span className="font-semibold text-[var(--text)]">{w.field}:</span> {w.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {resolverPending > 0 && (
        <div className="card mb-3 border-l-4 border-l-accent p-3 text-[12.5px] text-[var(--text-muted)]">
          Resolving {resolverPending} ticker{resolverPending > 1 ? "s" : ""} via symbol search...
        </div>
      )}
      {resolverErrors.length > 0 && (
        <div className="card mb-3 border-l-4 border-l-danger p-3 text-[12.5px]">
          <div className="mb-1 flex items-center gap-2 font-semibold text-danger">
            <AlertTriangle size={14} /> Could not resolve ticker for: {resolverErrors.join(", ")}
          </div>
          <p className="text-[var(--text-muted)]">
            Use the real ticker (e.g. <code className="font-mono">WDC US</code> instead of <code className="font-mono">Western Digital US</code>).
          </p>
        </div>
      )}

      {fixingResult.pending.length > 0 && (
        <div className="card mb-3 border-l-4 border-l-accent p-3 text-[12.5px] text-[var(--text-muted)]">
          Fetching trade-date close for {fixingResult.pending.join(", ")}...
        </div>
      )}
      {fixingResult.errors.length > 0 && (
        <div className="card mb-3 border-l-4 border-l-warning p-3 text-[12.5px]">
          <div className="mb-1 flex items-center gap-2 font-semibold text-warning">
            <AlertTriangle size={14} /> Trade-date close unavailable for: {fixingResult.errors.join(", ")}
          </div>
          <p className="text-[var(--text-muted)]">
            Falling back to latest close.
          </p>
        </div>
      )}

      {trancheWithFixing && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] text-[var(--text-muted)]">
              {loading ? "Refreshing..." : asOf ? `Last refresh ${new Date(asOf).toLocaleTimeString()}` : "Pulling quotes..."}
            </div>
            <div className="flex gap-2">
              <button onClick={refresh} className="btn h-9 px-3 text-xs">Refresh</button>
              <button onClick={handleSaveToPocket} className="btn btn-primary h-9 px-3 text-xs">
                {saved ? <Check size={14} /> : <BookmarkPlus size={14} />}
                {saved ? "Saved!" : "Save to Pocket"}
              </button>
              <NotifyButton tranche={trancheWithFixing} />
            </div>
          </div>

          {saved && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-success/30 bg-successBg p-3 text-[13px] text-success dark:bg-success/10">
              <div className="flex items-center gap-2">
                <Check size={16} /> Saved to Pocket. You can rename the tranche code from the Pocket card.
              </div>
              <Link href="/pocket" className="btn h-8 px-3 text-xs">
                <Wallet size={14} /> View Pocket
              </Link>
            </div>
          )}

          <ProductTable tranche={trancheWithFixing} quotes={quotes} onOverrideFixing={handleSetOverride} />
          <Dashboard tranche={trancheWithFixing} quotes={quotes} />
          <KOSchedule tranche={trancheWithFixing} quotes={quotes} />
          <Analytics tranche={trancheWithFixing} quotes={quotes} />
        </>
      )}
    </>
  );
}

function NotifyButton({ tranche }: { tranche: Tranche }) {
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) { setGranted(false); return; }
    setGranted(Notification.permission === "granted");
  }, []);
  async function ask() {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const r = await Notification.requestPermission();
    setGranted(r === "granted");
    if (r === "granted") {
      new Notification("Alerts enabled", {
        body: `You'll be notified for ${tranche.trancheCode}: KI, KO, trade date, coupon, maturity.`,
      });
    }
  }
  if (granted === null) return null;
  return (
    <button onClick={ask} className="btn h-9 px-3 text-xs">
      <BellRing size={14} /> {granted ? "Alerts on" : "Enable alerts"}
    </button>
  );
}
