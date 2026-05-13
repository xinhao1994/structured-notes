"use client";

// Daily observation alert.
//
// Loads Pocket on mount, computes which (if any) tranches have a KO
// observation falling on today's MALAYSIA date, and:
//   • Shows an in-app banner with "X needs +Y% to reach $Z" per underlying.
//   • Fires a Notification once per day (gated by Notification permission
//     + a localStorage day-marker so we don't re-spam on every reload).
//
// True scheduled 9am Malaysia-time push requires a backend (Vercel cron +
// VAPID keys + server-side push subscription store). This is documented in
// the README as a follow-on; what we do here is the practical-without-
// backend version: the user sees the alert the moment they open the app,
// and once their phone is signed into push, the notification mirrors that.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BellRing, AlertTriangle, Calendar, X } from "lucide-react";
import { listPocket, type PocketEntry } from "@/lib/storage";
import { koSchedule } from "@/lib/calc";
import { useQuotes } from "@/lib/hooks/useQuotes";
import type { MarketCode, Tranche } from "@/lib/types";

const NOTIFIED_KEY = "snd.dailyObs.notifiedFor";

/** Today's date in YYYY-MM-DD on the Malaysia clock (UTC+8). */
function malaysiaTodayISO(): string {
  const now = new Date();
  // Convert to UTC+8 by adding 8h then formatting as UTC.
  const my = new Date(now.getTime() + 8 * 3600_000);
  return my.toISOString().slice(0, 10);
}

interface ObsToday {
  entry: PocketEntry;
  obsN: number;
  koByUnderlying: Record<string, number>; // symbol → koPx for this obs
}

export function DailyObsBanner() {
  const [pocket, setPocket] = useState<PocketEntry[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => { setPocket(listPocket()); }, []);

  // Find tranches with an obs falling today (Malaysia date).
  const todays: ObsToday[] = useMemo(() => {
    const my = malaysiaTodayISO();
    const out: ObsToday[] = [];
    for (const entry of pocket) {
      const sched = koSchedule(entry.tranche);
      const todayObs = sched.find((o) => o.date === my);
      if (todayObs) out.push({ entry, obsN: todayObs.n, koByUnderlying: todayObs.koPriceBySymbol });
    }
    return out;
  }, [pocket]);

  // Collect all unique symbols across today's tranches so useQuotes can
  // fetch live spot for the distance calculation.
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: { symbol: string; market: MarketCode }[] = [];
    for (const t of todays) {
      for (const u of t.entry.tranche.underlyings) {
        const k = `${u.market}:${u.symbol}`;
        if (!seen.has(k)) { seen.add(k); out.push({ symbol: u.symbol, market: u.market }); }
      }
    }
    return out;
  }, [todays]);
  const { quotes } = useQuotes(items, 60_000);

  // Fire a Notification at most once per day (per device). Mirrors the banner.
  useEffect(() => {
    if (todays.length === 0) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const my = malaysiaTodayISO();
    let notifiedFor: string;
    try { notifiedFor = window.localStorage.getItem(NOTIFIED_KEY) || ""; } catch { notifiedFor = ""; }
    if (notifiedFor === my) return;
    try { window.localStorage.setItem(NOTIFIED_KEY, my); } catch {}
    const title = todays.length === 1
      ? `Observation tonight: ${todays[0].entry.tranche.trancheCode}`
      : `${todays.length} tranches have observations tonight`;
    const body = todays.map((t) => {
      const code = t.entry.tranche.trancheCode;
      const underlyings = t.entry.tranche.underlyings.map((u) => u.symbol).join(" · ");
      return `${code}: obs #${t.obsN} · ${underlyings}`;
    }).join("\n");
    try { new Notification(title, { body, tag: `daily-obs-${my}` }); } catch {}
  }, [todays]);

  if (todays.length === 0 || dismissed) return null;

  return (
    <div className="card mb-3 border-l-4 border-l-warning p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-warning">
          <BellRing size={14} /> Observation today ({todays.length} tranche{todays.length > 1 ? "s" : ""})
        </div>
        <button onClick={() => setDismissed(true)} className="text-[var(--text-muted)] hover:text-[var(--text)]" title="Dismiss for this session">
          <X size={14} />
        </button>
      </div>
      <p className="text-[11.5px] text-[var(--text-muted)]">
        These tranches have a knock-out observation falling on today&apos;s Malaysia date.
        Watch the closing prices in each underlying&apos;s home market session tonight.
      </p>

      <div className="mt-2 space-y-2">
        {todays.map(({ entry, obsN, koByUnderlying }) => (
          <TodayCard
            key={entry.id}
            tranche={entry.tranche}
            obsN={obsN}
            koByUnderlying={koByUnderlying}
            quotes={quotes}
          />
        ))}
      </div>
    </div>
  );
}

function TodayCard({
  tranche, obsN, koByUnderlying, quotes,
}: {
  tranche: Tranche; obsN: number;
  koByUnderlying: Record<string, number>;
  quotes: Record<string, any>;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[13px] font-semibold">{tranche.trancheCode}</div>
          <div className="text-[10.5px] text-[var(--text-muted)]">
            <Calendar size={10} className="mr-0.5 inline" /> Obs #{obsN} · KO level {((koByUnderlying[tranche.underlyings[0]?.symbol] && tranche.initialFixing?.[tranche.underlyings[0]?.symbol]) ? ((koByUnderlying[tranche.underlyings[0]?.symbol] / tranche.initialFixing[tranche.underlyings[0]?.symbol]) * 100).toFixed(0) : "—")}%
          </div>
        </div>
        <Link href="/pocket" className="btn h-7 px-2 text-[10.5px]">View</Link>
      </div>
      <div className="mt-2 space-y-1">
        {tranche.underlyings.map((u) => {
          const koPx = koByUnderlying[u.symbol];
          const spot = quotes[u.symbol]?.price;
          if (koPx == null) return null;
          const gap = spot != null ? ((koPx - spot) / spot) * 100 : null;
          // Positive `gap` = stock still needs to rise to reach KO.
          // Negative `gap` = stock is already above KO.
          const aboveKo = gap != null && gap <= 0;
          const formatPx = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
          return (
            <div key={u.symbol} className="grid grid-cols-3 items-center gap-2 text-[11.5px]">
              <div className="truncate font-medium">{u.symbol}</div>
              <div className="tabular text-center text-[var(--text-muted)]">
                spot {spot != null ? formatPx(spot) : "—"}
              </div>
              <div className="tabular text-right">
                {gap == null ? (
                  <span className="text-[var(--text-muted)]">—</span>
                ) : aboveKo ? (
                  <span className="text-success font-semibold" title={`Already ${Math.abs(gap).toFixed(2)}% above KO ${formatPx(koPx)}`}>
                    ✓ above KO
                  </span>
                ) : (
                  <span className="text-warning font-semibold" title={`Needs +${gap.toFixed(2)}% to reach KO ${formatPx(koPx)}`}>
                    +{gap.toFixed(1)}% → {formatPx(koPx)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Small helper for surfaces that don't have notification permission yet —
 * shows a one-tap button to enable. Used in the bottom of the banner or
 * standalone in settings.
 */
export function EnableDailyAlertsButton() {
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) { setGranted(false); return; }
    setGranted(Notification.permission === "granted");
  }, []);
  if (granted === null || granted === true) return null;
  return (
    <button
      onClick={async () => {
        try {
          const r = await Notification.requestPermission();
          setGranted(r === "granted");
          if (r === "granted") new Notification("Daily alerts enabled", {
            body: "You'll get a notification each morning when your Pocket has a KO observation that day.",
          });
        } catch {}
      }}
      className="btn h-8 px-3 text-[11px]"
    >
      <AlertTriangle size={12} /> Enable daily KO alerts
    </button>
  );
}
