"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, Trash2, Pin, PinOff, Filter } from "lucide-react";
import { listPocket, removePocket, togglePin, type PocketEntry } from "@/lib/storage";
import { useQuotes } from "@/lib/hooks/useQuotes";
import { assessRisk, currentKoLevel, formatPx } from "@/lib/calc";
import type { Currency, MarketCode, RiskBand } from "@/lib/types";
import clsx from "clsx";

const CCYS: Currency[] = ["USD", "HKD", "MYR", "SGD", "JPY", "AUD"];
const RISK_FILTERS: RiskBand[] = ["safe", "moderate", "high-risk", "near-ki", "near-ko", "critical"];

export default function PocketPage() {
  const [list, setList] = useState<PocketEntry[]>([]);
  const [q, setQ] = useState("");
  const [ccy, setCcy] = useState<Currency | "all">("all");
  const [risk, setRisk] = useState<RiskBand | "all">("all");
  const [maturityWithin, setMaturityWithin] = useState<number | "all">("all");

  // refresh every time the page mounts (in case the user just saved a tranche)
  useEffect(() => { setList(listPocket()); }, []);

  // gather every underlying across all saved tranches into a single quote pull
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: { symbol: string; market: MarketCode }[] = [];
    for (const e of list) {
      for (const u of e.tranche.underlyings) {
        const k = `${u.market}:${u.symbol}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push({ symbol: u.symbol, market: u.market });
        }
      }
    }
    return out;
  }, [list]);
  const { quotes, loading, asOf, refresh } = useQuotes(items, 30_000);

  // Compute per-tranche derived values once per render
  const enriched = useMemo(() => {
    return list.map((e) => {
      // synthesise initial fixing from current closes if not set yet
      const t = { ...e.tranche };
      if (!t.initialFixing) {
        const fix: Record<string, number> = {};
        for (const u of t.underlyings) {
          const px = quotes[u.symbol]?.prevClose ?? quotes[u.symbol]?.price;
          if (px != null) fix[u.symbol] = px;
        }
        t.initialFixing = fix;
      }
      const r = assessRisk(t, quotes);
      const ko = currentKoLevel(t);
      const maturity = computeMaturity(t.tradeDate, t.tenorMonths);
      const daysToMat = daysBetween(new Date().toISOString().slice(0, 10), maturity);
      return { entry: { ...e, tranche: t }, risk: r, ko, maturity, daysToMat };
    });
  }, [list, quotes]);

  const filtered = enriched
    .filter(({ entry }) =>
      q
        ? entry.tranche.trancheCode.toLowerCase().includes(q.toLowerCase()) ||
          entry.tranche.underlyings.some((u) =>
            u.symbol.toLowerCase().includes(q.toLowerCase()) ||
            u.rawName.toLowerCase().includes(q.toLowerCase())
          )
        : true
    )
    .filter(({ entry }) => (ccy === "all" ? true : entry.tranche.currency === ccy))
    .filter(({ risk: r }) => (risk === "all" ? true : r?.band === risk))
    .filter(({ daysToMat }) => (maturityWithin === "all" ? true : daysToMat <= maturityWithin && daysToMat >= 0))
    .sort((a, b) => Number(!!b.entry.pinned) - Number(!!a.entry.pinned));

  function handleRemove(id: string) {
    removePocket(id);
    setList(listPocket());
  }
  function handlePin(id: string) {
    togglePin(id);
    setList(listPocket());
  }

  return (
    <>
      <header className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Watchlist
          </div>
          <h1 className="text-xl font-semibold">Pocket</h1>
        </div>
        <div className="text-[11px] text-[var(--text-muted)]">
          {loading ? "Refreshing…" : asOf ? `Last ${new Date(asOf).toLocaleTimeString()}` : ""}
          <button onClick={refresh} className="ml-2 underline">refresh</button>
        </div>
      </header>

      {/* Search + filters */}
      <div className="card mb-3 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Search size={14} className="text-[var(--text-muted)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tranche code or underlying…"
            className="input h-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <Filter size={12} className="text-[var(--text-muted)]" />
          <select className="input h-8 w-auto px-2 text-[12px]" value={ccy} onChange={(e) => setCcy(e.target.value as any)}>
            <option value="all">All ccy</option>
            {CCYS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input h-8 w-auto px-2 text-[12px]" value={risk} onChange={(e) => setRisk(e.target.value as any)}>
            <option value="all">All risk</option>
            {RISK_FILTERS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select
            className="input h-8 w-auto px-2 text-[12px]"
            value={maturityWithin}
            onChange={(e) => setMaturityWithin(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}
          >
            <option value="all">Any maturity</option>
            <option value="30">≤ 30 days</option>
            <option value="90">≤ 90 days</option>
            <option value="180">≤ 6 months</option>
            <option value="365">≤ 1 year</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="card p-6 text-center text-[13px] text-[var(--text-muted)]">
          {list.length === 0 ? (
            <>
              No tranches saved yet.{" "}
              <Link href="/" className="text-accent underline">
                Parse one and tap Save to Pocket
              </Link>{" "}
              to start tracking.
            </>
          ) : (
            "No tranches match your filters."
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {filtered.map(({ entry, risk: r, ko, maturity, daysToMat }) => {
          const t = entry.tranche;
          const symbols = t.underlyings.map((u) => u.symbol).join(" · ");
          return (
            <article key={entry.id} className="card p-3">
              <header className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {t.issuer || "Tranche"} · {t.currency}
                    {entry.pinned && <Pin size={11} className="text-accent" />}
                  </div>
                  <div className="truncate font-mono text-[14px] font-semibold">{t.trancheCode}</div>
                  <div className="truncate text-[12px] text-[var(--text-muted)]">{symbols}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => handlePin(entry.id)} className="btn h-8 px-2" title="Pin">
                    {entry.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                  </button>
                  <button onClick={() => handleRemove(entry.id)} className="btn h-8 px-2" title="Remove">
                    <Trash2 size={14} />
                  </button>
                </div>
              </header>

              <dl className="grid grid-cols-3 gap-2 text-[11.5px]">
                <Field label="Coupon" value={`${(t.couponPa * 100).toFixed(2)}% p.a.`} />
                <Field label="Tenor"  value={`${t.tenorMonths}M`} />
                <Field label="Maturity" value={maturity} sub={daysToMat >= 0 ? `${daysToMat} days` : "matured"} />
                <Field label="Strike" value={`${(t.strikePct * 100).toFixed(0)}%`} />
                <Field label="EKI"    value={`${(t.ekiPct * 100).toFixed(0)}%`} />
                <Field label="Next KO" value={ko ? `${(ko.koPct * 100).toFixed(0)}%` : "—"} sub={ko?.date} />
              </dl>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className={clsx("badge", r?.band || "moderate")}>
                  {r ? bandLabel(r.band) : "Loading…"}
                </span>
                <div className="text-[11px] text-[var(--text-muted)]">
                  {t.underlyings.map((u) => {
                    const q = quotes[u.symbol];
                    return (
                      <span key={u.symbol} className="ml-2 first:ml-0">
                        <span className="text-[var(--text)] font-medium">{u.symbol}</span>{" "}
                        {formatPx(q?.price, q?.currency)}
                      </span>
                    );
                  })}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

function Field({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className="tabular font-semibold">{value}</div>
      {sub && <div className="text-[10px] text-[var(--text-muted)]">{sub}</div>}
    </div>
  );
}

function bandLabel(b: RiskBand) {
  return ({
    safe: "Safe zone",
    moderate: "Moderate",
    "near-ki": "Near KI",
    "near-ko": "Near KO",
    "high-risk": "High risk",
    critical: "Critical",
  } as Record<RiskBand, string>)[b];
}

function computeMaturity(tradeDate: string, months: number): string {
  const [y, m, d] = tradeDate.split("-").map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}
