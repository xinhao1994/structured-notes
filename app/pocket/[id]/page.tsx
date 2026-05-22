"use client";

// Pocket > Tranche detail.
// One-click drill-in from a saved tranche card. The page answers a single
// question quickly: "Where do my stocks need to be for this tranche to KO,
// and how far away from that are we right now — live?"
//
// Layout, mobile-first:
//   1. Slim header bar — back link + tranche identity + live "as of" refresh.
//   2. Snapshot card — next obs date, current KO %, worst-of, coupon. The
//      4-stat row that orients the user in two seconds.
//   3. Live stock tracker — one big card per underlying, BIG live ticking
//      price, "needs to reach" KO price for the next observation, and the
//      gap % vs current price (green if at/above, red if below).
//   4. Full KO valuation schedule — cards (not a cramped table). Upcoming
//      observations first (with the immediate next one highlighted in
//      accent), then past observations dimmed underneath.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, CalendarClock, Clock, RefreshCw, Repeat, Target, TrendingUp, TrendingDown,
  AlertTriangle, Circle, CheckCircle2,
} from "lucide-react";
import clsx from "clsx";

import { listPocket, type PocketEntry } from "@/lib/storage";
import { useQuotes } from "@/lib/hooks/useQuotes";
import { TickingPrice } from "@/components/TickingPrice";
import {
  assessRisk, currentKoLevel, koSchedule, formatPx,
} from "@/lib/calc";
import { isMarketOpen, MARKETS } from "@/lib/markets";
import type { MarketCode, RiskBand, Tranche } from "@/lib/types";

export default function PocketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = decodeURIComponent(String(params?.id ?? ""));

  const [entry, setEntry] = useState<PocketEntry | null | undefined>(undefined);

  // Re-read on mount; localStorage is the source of truth.
  useEffect(() => {
    const list = listPocket();
    setEntry(list.find((e) => e.id === id) ?? null);
  }, [id]);

  // Items to poll for live prices.
  const items = useMemo(() => {
    if (!entry) return [] as { symbol: string; market: MarketCode }[];
    const seen = new Set<string>();
    const out: { symbol: string; market: MarketCode }[] = [];
    for (const u of entry.tranche.underlyings) {
      const k = `${u.market}:${u.symbol}`;
      if (!seen.has(k)) { seen.add(k); out.push({ symbol: u.symbol, market: u.market }); }
    }
    return out;
  }, [entry]);

  // Live polling — 15s on this page (we want it lively, this is the
  // dedicated detail view). Pauses automatically when tab is hidden.
  const { quotes, loading, asOf, refresh } = useQuotes(items, 15_000);

  // Build a working copy of the tranche with initial-fixing auto-filled from
  // prevClose if missing — so KO prices can be displayed even pre-fixing.
  // Always call useMemo (even when entry is null) so hook order is stable.
  const t: Tranche | null = useMemo(() => {
    if (!entry) return null;
    const next: Tranche = { ...entry.tranche };
    if (!next.initialFixing) {
      const fix: Record<string, number> = {};
      for (const u of next.underlyings) {
        const px = quotes[u.symbol]?.prevClose ?? quotes[u.symbol]?.price;
        if (px != null) fix[u.symbol] = px;
      }
      next.initialFixing = fix;
    }
    return next;
  }, [entry, quotes]);

  // Loading / not-found states.
  if (entry === undefined) {
    return <div className="card p-6 text-[13px] text-[var(--text-muted)]">Loading...</div>;
  }
  if (entry === null || !t) {
    return (
      <div className="card p-6 text-center">
        <div className="mb-2 text-[13px] text-[var(--text-muted)]">Tranche not found in Pocket.</div>
        <Link href="/pocket" className="btn h-9 text-[12.5px]"><ArrowLeft size={14} /> Back to Pocket</Link>
      </div>
    );
  }

  const risk = assessRisk(t, quotes);
  const sched = koSchedule(t);
  const today = new Date().toISOString().slice(0, 10);
  const nextObs = currentKoLevel(t);
  const upcoming = sched.filter((o) => o.date >= today);
  const past = sched.filter((o) => o.date < today);
  const maturity = computeMaturity(t.tradeDate, t.tenorMonths);
  const daysToMaturity = daysBetween(today, maturity);
  const daysToNextObs = nextObs ? daysBetween(today, nextObs.date) : null;

  return (
    <>
      {/* ── Header row ─────────────────────────────────────────────── */}
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <button
            onClick={() => router.back()}
            className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-accent"
          >
            <ArrowLeft size={12} /> Pocket
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-[20px] font-semibold leading-tight">{t.trancheCode}</h1>
            <span className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider">
              {t.currency}
            </span>
            {t.issuer && (
              <span className="text-[11px] text-[var(--text-muted)]">{t.issuer}</span>
            )}
            {risk && (
              <span className={clsx("badge", risk.band)}>{bandLabel(risk.band)}</span>
            )}
          </div>
        </div>
        <button
          onClick={refresh}
          className="btn h-8 px-2.5 text-[11.5px]"
          title="Refresh live prices"
        >
          <RefreshCw size={12} className={clsx(loading && "animate-spin")} />
          {asOf ? new Date(asOf).toLocaleTimeString() : "Refresh"}
        </button>
      </header>

      {/* ── Snapshot stat row ─────────────────────────────────────── */}
      <section className="card mb-3 p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SnapshotStat
            icon={<CalendarClock size={13} />}
            label="Next observation"
            primary={nextObs?.date ?? "—"}
            sub={
              daysToNextObs != null
                ? daysToNextObs === 0 ? "today"
                : daysToNextObs > 0 ? `in ${daysToNextObs} days`
                : "passed"
                : undefined
            }
          />
          <SnapshotStat
            icon={<Target size={13} />}
            label="Current KO level"
            primary={nextObs ? `${(nextObs.koPct * 100).toFixed(0)}%` : "—"}
            sub={`start ${(t.koStartPct * 100).toFixed(0)}% · step -${(t.koStepdownPct * 100).toFixed(0)}%`}
          />
          <SnapshotStat
            icon={<Repeat size={13} />}
            label="Coupon"
            primary={`${(t.couponPa * 100).toFixed(2)}% p.a.`}
            sub={`${(t.couponPa / 12 * 100).toFixed(3)}% / month`}
          />
          <SnapshotStat
            icon={<Clock size={13} />}
            label="Matures"
            primary={maturity}
            sub={daysToMaturity >= 0 ? `${daysToMaturity} days left` : "matured"}
          />
        </div>
        {risk && (
          <div className="mt-2 border-t border-[var(--line)] pt-2 text-[11.5px] text-[var(--text-muted)]">
            <strong className="text-[var(--text)]">Worst-of:</strong>{" "}
            <span className="font-mono">{risk.worstSymbol}</span> — {risk.rationale}
          </div>
        )}
      </section>

      {/* ── Per-underlying live tracker — the headline view ─────── */}
      <section className="mb-3">
        <div className="mb-1.5 flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Live price vs next KO trigger
          </h2>
          {nextObs && (
            <span className="text-[11px] text-[var(--text-muted)]">
              obs #{nextObs.n} · {nextObs.date}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {t.underlyings.map((u) => {
            const q = quotes[u.symbol];
            const init = t.initialFixing?.[u.symbol];
            const koPx = nextObs && init ? init * nextObs.koPct : undefined;
            const live = q?.price;
            const gapPct = live != null && koPx ? ((live - koPx) / koPx) * 100 : undefined;
            const mkt = isMarketOpen(u.market);
            const triggered = gapPct != null && gapPct >= 0;
            return (
              <article
                key={u.symbol}
                className={clsx(
                  "card p-3",
                  triggered
                    ? "border-2 border-success/40"
                    : gapPct != null && gapPct > -5
                    ? "border-2 border-warning/40"
                    : "",
                )}
              >
                <header className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      <span>{MARKETS[u.market].label}</span>
                      <span className={clsx(
                        "inline-flex h-1.5 w-1.5 rounded-full",
                        mkt.open ? "bg-success" : "bg-[var(--text-muted)] opacity-50",
                      )} title={mkt.open ? "market open" : `market ${mkt.reason}`} />
                    </div>
                    <Link
                      href={`/analyze?symbol=${encodeURIComponent(u.symbol)}&market=${u.market}`}
                      className="flex items-baseline gap-1.5 hover:text-accent"
                      title="Open in Stock Analyze"
                    >
                      <span className="font-mono text-[15px] font-semibold">{u.symbol}</span>
                      <span className="truncate text-[11px] text-[var(--text-muted)]">{u.rawName}</span>
                    </Link>
                  </div>
                  {triggered ? (
                    <CheckCircle2 size={16} className="text-success flex-shrink-0" />
                  ) : (
                    <Circle size={16} className="text-[var(--text-muted)] opacity-50 flex-shrink-0" />
                  )}
                </header>

                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Live price
                    </div>
                    <TickingPrice
                      price={live}
                      currency={q?.currency}
                      marketOpen={mkt.open}
                      className="text-[22px] font-semibold leading-none"
                    />
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Needs to KO
                    </div>
                    <div className="tabular text-[15px] font-semibold">{formatPx(koPx, q?.currency)}</div>
                  </div>
                </div>

                <div className="mt-2 border-t border-[var(--line)] pt-2">
                  {gapPct != null ? (
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-[var(--text-muted)]">
                        {triggered ? "Above trigger" : "Below trigger"}
                      </span>
                      <span
                        className={clsx(
                          "tabular inline-flex items-center gap-1 font-semibold",
                          triggered ? "text-success" : gapPct > -5 ? "text-warning" : "text-danger",
                        )}
                      >
                        {triggered ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                        {gapPct >= 0 ? "+" : ""}{gapPct.toFixed(2)}%
                      </span>
                    </div>
                  ) : (
                    <div className="text-[11px] text-[var(--text-muted)]">
                      Waiting for live price…
                    </div>
                  )}
                  {init != null && (
                    <div className="mt-1 flex items-center justify-between text-[10.5px] text-[var(--text-muted)]">
                      <span>Initial fixing</span>
                      <span className="tabular">{formatPx(init, q?.currency)}</span>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* ── Full KO valuation schedule ────────────────────────────── */}
      <section className="mb-3">
        <div className="mb-1.5 flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Full KO valuation schedule
          </h2>
          <span className="text-[11px] text-[var(--text-muted)]">
            {sched.length} observations · {upcoming.length} upcoming
          </span>
        </div>

        {/* Upcoming */}
        {upcoming.length > 0 && (
          <div className="mb-3 space-y-2">
            {upcoming.map((o, idx) => (
              <ObsCard
                key={o.n}
                tranche={t}
                obs={o}
                quotes={quotes}
                kind={idx === 0 ? "next" : "future"}
              />
            ))}
          </div>
        )}

        {/* Past — dim, smaller heading */}
        {past.length > 0 && (
          <details className="card p-3" open={past.length <= 3}>
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text)]">
              Past observations ({past.length})
            </summary>
            <div className="mt-2 space-y-2">
              {past.map((o) => (
                <ObsCard
                  key={o.n}
                  tranche={t}
                  obs={o}
                  quotes={quotes}
                  kind="past"
                />
              ))}
            </div>
          </details>
        )}
      </section>

      {/* Footnote */}
      <p className="text-[10.5px] leading-relaxed text-[var(--text-muted)]">
        KO trigger steps down by <strong>{(t.koStepdownPct * 100).toFixed(0)}%</strong> per observation
        from a start of <strong>{(t.koStartPct * 100).toFixed(0)}%</strong>. Each stock&apos;s &ldquo;Needs to KO&rdquo;
        price is its <em>initial fixing × current KO %</em>. Live prices refresh every 15s while this tab is open.
        Past observations show a would-have-KO&apos;d indicator based on live spot — for the authoritative call,
        the Desk uses the official close on the observation date.
      </p>
    </>
  );
}

/** Stat tile used in the snapshot row. */
function SnapshotStat({
  icon, label, primary, sub,
}: {
  icon?: React.ReactNode;
  label: string;
  primary: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-2.5">
      <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {icon}
        <span>{label}</span>
      </div>
      <div className="tabular text-[14px] font-semibold leading-tight">{primary}</div>
      {sub && <div className="mt-0.5 text-[10.5px] text-[var(--text-muted)]">{sub}</div>}
    </div>
  );
}

/** One observation row, rendered as a card with per-underlying rows inside.
 *  `kind` controls visual treatment — "next" = highlighted, "past" = dimmed. */
function ObsCard({
  tranche, obs, quotes, kind,
}: {
  tranche: Tranche;
  obs: ReturnType<typeof koSchedule>[number];
  quotes: Record<string, { price?: number; currency?: string } | undefined>;
  kind: "next" | "future" | "past";
}) {
  // Compute per-underlying gap. For future observations and the "next" obs,
  // gap = (live - koPrice) / koPrice. For past, also use live spot as a quick
  // "would-have-KO'd" view (the detailed historical closes live in the
  // dedicated Desk schedule).
  const rows = tranche.underlyings.map((u) => {
    const init = tranche.initialFixing?.[u.symbol];
    const koPx = init != null ? init * obs.koPct : undefined;
    const live = quotes[u.symbol]?.price;
    const gap = live != null && koPx ? ((live - koPx) / koPx) * 100 : undefined;
    return { u, koPx, live, gap, ccy: quotes[u.symbol]?.currency };
  });
  // Worst-of for status badge.
  const valid = rows.filter((r) => r.gap != null) as Array<typeof rows[number] & { gap: number }>;
  const worst = valid.length ? valid.reduce((a, b) => (a.gap < b.gap ? a : b)) : null;
  const dateObj = parseDate(obs.date);

  return (
    <article
      className={clsx(
        "rounded-xl border p-2.5 transition-colors",
        kind === "next" && "border-accent/50 bg-accent-50/40 dark:bg-accent-900/20",
        kind === "future" && "border-[var(--line)] bg-[var(--surface)]",
        kind === "past" && "border-[var(--line)] bg-[var(--surface-2)] opacity-80",
      )}
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Obs #{obs.n}
          </span>
          <span className="tabular text-[13px] font-semibold">{obs.date}</span>
          {dateObj && (
            <span className="text-[11px] text-[var(--text-muted)]">{formatDow(dateObj)}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-md bg-[var(--surface)] border border-[var(--line)] px-1.5 py-0.5 text-[11px] font-semibold tabular">
            {(obs.koPct * 100).toFixed(0)}%
          </span>
          {kind === "next" && (
            <span className="badge near-ko whitespace-nowrap !py-0.5 !px-2 !text-[10px]">Next up</span>
          )}
          {worst && kind !== "past" && (
            <span
              className={clsx(
                "badge whitespace-nowrap !py-0.5 !px-2 !text-[10px]",
                worst.gap >= 0 ? "safe" : worst.gap > -5 ? "near-ko" : worst.gap > -15 ? "moderate" : "high-risk",
              )}
              title={worst.gap >= 0
                ? `Worst-of (${worst.u.symbol}) is already above KO trigger.`
                : `Worst-of (${worst.u.symbol}) is ${Math.abs(worst.gap).toFixed(2)}% below KO trigger.`
              }
            >
              {worst.gap >= 0
                ? <>Would KO <TrendingUp size={10} /></>
                : <>Short {Math.abs(worst.gap).toFixed(1)}%</>}
            </span>
          )}
          {kind === "past" && (
            <span className="badge moderate whitespace-nowrap !py-0.5 !px-2 !text-[10px]">Passed</span>
          )}
        </div>
      </header>

      {/* Per-underlying mini-table — easy on the eye, no scrollbar */}
      <div className="overflow-hidden rounded-lg border border-[var(--line)]">
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 gap-y-0 bg-[var(--surface-2)] px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          <div>Stock</div>
          <div className="text-right">Needs</div>
          <div className="text-right">Live</div>
          <div className="text-right">Gap</div>
        </div>
        <div className="divide-y divide-[var(--line)] bg-[var(--surface)]">
          {rows.map(({ u, koPx, live, gap, ccy }) => (
            <div
              key={u.symbol}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 px-2.5 py-1.5 text-[12px]"
            >
              <div className="min-w-0 truncate">
                <span className="font-mono font-semibold">{u.symbol}</span>
              </div>
              <div className="tabular text-right text-[var(--text)]">{formatPx(koPx, ccy)}</div>
              <div className="tabular text-right">
                {kind === "next" ? (
                  <TickingPrice price={live ?? null} currency={ccy} compact className="text-[12px] !px-1" />
                ) : (
                  <span className="tabular">{formatPx(live, ccy)}</span>
                )}
              </div>
              <div className={clsx(
                "tabular text-right font-semibold",
                gap == null ? "text-[var(--text-muted)]"
                : gap >= 0 ? "text-success"
                : gap > -5 ? "text-warning"
                : "text-danger",
              )}>
                {gap == null ? "—" : `${gap >= 0 ? "+" : ""}${gap.toFixed(2)}%`}
              </div>
            </div>
          ))}
        </div>
      </div>

      {!tranche.initialFixing && (
        <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-warning">
          <AlertTriangle size={12} /> Initial fixing not yet set — KO prices use yesterday&apos;s close as a placeholder.
        </div>
      )}
    </article>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────

function bandLabel(b: RiskBand) {
  return ({
    safe: "Safe", moderate: "Moderate", "near-ki": "Near KI",
    "near-ko": "Near KO", "high-risk": "High risk", critical: "Critical",
  } as Record<RiskBand, string>)[b];
}

function computeMaturity(tradeDate: string, months: number): string {
  const [y, m, d] = tradeDate.split("-").map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}
function parseDate(yyyymmdd: string): Date | null {
  const [y, m, d] = yyyymmdd.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}
function formatDow(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}
