"use client";

import clsx from "clsx";
import Link from "next/link";
import { ArrowDown, ArrowUp, CalendarClock, CircleDollarSign, Clock, Hash, Landmark, Repeat, LineChart } from "lucide-react";
import type { PriceQuote, Tranche } from "@/lib/types";
import { assessRisk, currentKoLevel, formatPx } from "@/lib/calc";
import { TickingPrice } from "@/components/TickingPrice";
import { isMarketOpen, MARKETS } from "@/lib/markets";

interface Props {
  tranche: Tranche;
  quotes: Record<string, PriceQuote | undefined>;
}

export function Dashboard({ tranche, quotes }: Props) {
  const ko = currentKoLevel(tranche);
  const risk = assessRisk(tranche, quotes);

  return (
    <section className="card mt-4 p-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Live monitoring
          </div>
          <h3 className="text-base font-semibold">Tranche dashboard</h3>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={clsx("badge", tranche.isIndicativeFixing ? "moderate" : "safe")}>
            {tranche.isIndicativeFixing ? "Indicative fixing" : "Actual fixed"}
          </span>
          {risk && <span className={clsx("badge", risk.band)}>{labelBand(risk.band)}</span>}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tranche code" icon={<Hash size={14} />} value={tranche.trancheCode} mono />
        <Stat label="Currency" icon={<CircleDollarSign size={14} />} value={tranche.currency} />
        <Stat label="Coupon" icon={<Repeat size={14} />} value={`${(tranche.couponPa * 100).toFixed(2)}% p.a.`} />
        <Stat label="Tenor" icon={<Clock size={14} />} value={`${tranche.tenorMonths} months`} />
        <Stat label="Trade date" icon={<CalendarClock size={14} />} value={tranche.tradeDate} sub={tranche.tradeCutoff && `cut-off ${tranche.tradeCutoff}`} />
        <Stat label="Settlement" icon={<CalendarClock size={14} />} value={tranche.settlementDate ?? "-"} sub={`T+${tranche.settlementOffset}`} />
        <Stat
          label="Offering"
          icon={<CalendarClock size={14} />}
          value={tranche.offeringStart && tranche.offeringEnd ? `${tranche.offeringStart} -> ${tranche.offeringEnd}` : tranche.offeringEnd ?? "-"}
        />
        <Stat label="Issuer" icon={<Landmark size={14} />} value={tranche.issuer ?? "-"} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tranche.underlyings.map((u) => {
          const q = quotes[u.symbol];
          const init = tranche.initialFixing?.[u.symbol];
          const strike = init ? init * tranche.strikePct : undefined;
          const ki = init ? init * tranche.ekiPct : undefined;
          const koPx = ko && init ? init * ko.koPct : undefined;
          const dailyPct = q?.price != null && q.prevClose ? ((q.price - q.prevClose) / q.prevClose) * 100 : undefined;
          const aboveStrikePct = q?.price != null && strike ? ((q.price - strike) / strike) * 100 : undefined;
          // All three metrics use the same convention: positive value = spot is
          // that % above the level. So "Above KO" = (spot − KO) / KO, positive
          // when spot would trigger autocall. "Dist to EKI" = (spot − EKI) / EKI,
          // positive = cushion above the knock-in barrier (safer).
          const distToEkiPct = q?.price != null && ki ? ((q.price - ki) / ki) * 100 : undefined;
          const aboveKoPct = q?.price != null && koPx ? ((q.price - koPx) / koPx) * 100 : undefined;
          const mktState = isMarketOpen(u.market);
          return (
            <article key={u.symbol} className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
              <header className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{MARKETS[u.market].label}</div>
                  {/* Tap-target: opens /analyze with this underlying pre-loaded.
                      Lets the RM jump from a tranche underlying into deep stock research. */}
                  <Link
                    href={`/analyze?symbol=${encodeURIComponent(u.symbol)}&market=${u.market}`}
                    className="group inline-flex items-center gap-1 truncate font-semibold hover:text-accent"
                    title="Open in Stock Analyze"
                  >
                    <span className="truncate underline-offset-2 group-hover:underline">{u.rawName}</span>
                    <span className="text-[var(--text-muted)] text-xs">{u.symbol}</span>
                    <LineChart size={11} className="opacity-0 transition-opacity group-hover:opacity-70" />
                  </Link>
                </div>
                <div className="flex flex-shrink-0 flex-col items-end gap-1">
                  <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", mktState.open ? "bg-successBg text-success dark:bg-success/15 dark:text-[#6dd49a]" : "bg-ink-100 text-ink-600 dark:bg-ink-700 dark:text-ink-300")}>
                    {mktState.open ? "Live" : "Delayed"}
                  </span>
                  <SourceBadge source={q?.source} />
                </div>
              </header>
              <div className="flex items-end justify-between gap-2">
                <TickingPrice
                  price={q?.price}
                  currency={q?.currency}
                  marketOpen={mktState.open}
                  className="text-2xl font-semibold leading-none"
                />
                {dailyPct !== undefined && (
                  <div className={clsx("tabular flex items-center gap-1 text-sm font-semibold", dailyPct >= 0 ? "text-success" : "text-danger")}>
                    {dailyPct >= 0 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}{dailyPct.toFixed(2)}%
                  </div>
                )}
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                <Mini label="Above strike" value={pctOrDash(aboveStrikePct)} positive={aboveStrikePct} />
                <Mini label="Dist. to EKI" value={pctOrDash(distToEkiPct)} positive={distToEkiPct} />
                <Mini label="Above KO" value={pctOrDash(aboveKoPct)} positive={aboveKoPct} />
              </dl>
            </article>
          );
        })}
      </div>

      {risk && (
        <p className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 text-[12.5px] text-[var(--text-muted)]">
          <strong className="font-semibold text-[var(--text)]">Risk note - </strong>{risk.rationale}
        </p>
      )}
    </section>
  );
}

function Stat({ label, value, icon, sub, mono }: { label: string; value: React.ReactNode; icon?: React.ReactNode; sub?: React.ReactNode; mono?: boolean; }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{icon}{label}</div>
      <div className={clsx("mt-1 truncate font-semibold", mono && "font-mono text-[14px]")}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{sub}</div>}
    </div>
  );
}

function Mini({ label, value, positive }: { label: string; value: string; positive?: number }) {
  return (
    <div>
      <div className="text-[var(--text-muted)]">{label}</div>
      <div className={clsx("tabular font-semibold", positive == null ? "" : positive >= 0 ? "text-success" : "text-danger")}>{value}</div>
    </div>
  );
}

function SourceBadge({ source }: { source?: string }) {
  if (!source) return null;
  const isMock = source === "mock";
  const label = source === "polygon" ? "Polygon" : source === "finnhub" ? "Finnhub" : source === "alphavantage" ? "Alpha Vtg" : source === "cache" ? "Cached" : isMock ? "Mock data" : source;
  return (
    <span className={clsx("rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide", isMock ? "bg-dangerBg text-danger dark:bg-danger/15 dark:text-[#ff8b85]" : "bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300")} title={isMock ? "Simulated price - ticker not recognised by data provider." : `Source: ${source}`}>
      {label}
    </span>
  );
}

function pctOrDash(n?: number) {
  if (n == null) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function labelBand(b: string) {
  return ({ safe: "Safe zone", moderate: "Moderate risk", "near-ki": "Near knock-in", "near-ko": "Near knock-out", "high-risk": "High risk", critical: "Critical - KI breached" } as Record<string, string>)[b] || b;
}
