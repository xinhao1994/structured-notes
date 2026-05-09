"use client";

import { useEffect, useMemo, useState } from "react";
import { ProductParser } from "@/components/ProductParser";
import { ProductTable } from "@/components/ProductTable";
import { Dashboard } from "@/components/Dashboard";
import { KOSchedule } from "@/components/KOSchedule";
import { Analytics } from "@/components/Charts";
import { ParseResult } from "@/lib/parser";
import { useQuotes } from "@/lib/hooks/useQuotes";
import { upsertTranche } from "@/lib/storage";
import { SAMPLE_TRANCHE_TEXT } from "@/lib/sample";
import { parseTrancheText } from "@/lib/parser";
import type { Tranche } from "@/lib/types";
import Link from "next/link";
import { BookmarkPlus, BellRing, AlertTriangle, Wallet, Check } from "lucide-react";

export default function HomePage() {
  // Auto-load the sample on first render so the dashboard is alive immediately.
  const [parsed, setParsed] = useState<ParseResult | null>(() => parseTrancheText(SAMPLE_TRANCHE_TEXT));
  const [saved, setSaved] = useState(false);

  const tranche = parsed?.tranche;

  // Live quotes for parsed underlyings (15s while open, longer when closed via API cache)
  const items = useMemo(
    () => (tranche?.underlyings ?? []).map((u) => ({ symbol: u.symbol, market: u.market })),
    [tranche]
  );
  const { quotes, loading, asOf, refresh } = useQuotes(items, 15_000);

  // Apply indicative initial fixing (use latest close until trade date passes)
  // and switch to actual fixing automatically once trade date is reached.
  const trancheWithFixing: Tranche | null = useMemo(() => {
    if (!tranche) return null;
    const today = new Date().toISOString().slice(0, 10);
    const isPreTrade = today < tranche.tradeDate;
    if (!Object.keys(quotes).length) return tranche;

    const fixing: Record<string, number> = {};
    for (const u of tranche.underlyings) {
      const q = quotes[u.symbol];
      if (q?.price != null) {
        // Pre-trade: indicative = latest available close (prevClose preferred,
        // else live). On/after trade date: actual = whatever the live price is
        // at fixing time (the desk would override this with the official fix).
        fixing[u.symbol] = isPreTrade ? (q.prevClose ?? q.price) : q.price;
      }
    }
    return { ...tranche, initialFixing: fixing, isIndicativeFixing: isPreTrade };
  }, [tranche, quotes]);

  function handleParsed(r: ParseResult) {
    setParsed(r);
    setSaved(false);
  }

  function handleSaveToPocket() {
    if (!trancheWithFixing) return;
    upsertTranche(trancheWithFixing);
    setSaved(true);
    // Keep the success banner visible long enough that the user can spot the
    // "View Pocket" link and click it without it disappearing on them.
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

      {trancheWithFixing && (
        <>
          {/* Action bar */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] text-[var(--text-muted)]">
              {loading ? "Refreshing…" : asOf ? `Last refresh ${new Date(asOf).toLocaleTimeString()}` : "Pulling quotes…"}
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
                <Check size={16} />
                Saved to Pocket. You can rename the tranche code from the Pocket card.
              </div>
              <Link href="/pocket" className="btn h-8 px-3 text-xs">
                <Wallet size={14} /> View Pocket
              </Link>
            </div>
          )}

          <ProductTable tranche={trancheWithFixing} quotes={quotes} />
          <Dashboard tranche={trancheWithFixing} quotes={quotes} />
          <KOSchedule tranche={trancheWithFixing} />
          <Analytics tranche={trancheWithFixing} quotes={quotes} />
        </>
      )}
    </>
  );
}

/**
 * Lightweight notify button — uses the browser Notifications API.
 * On real deployments, hook this up to your push provider (web-push, OneSignal,
 * APNs/FCM via Capacitor) using the VAPID keys in .env.local.
 */
function NotifyButton({ tranche }: { tranche: Tranche }) {
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setGranted(false);
      return;
    }
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
