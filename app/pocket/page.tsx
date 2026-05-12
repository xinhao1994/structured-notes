"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search, Trash2, Pin, PinOff, Filter, Pencil, Check, X,
  Shield, AlertTriangle, ShieldAlert, Activity, Wallet, Calendar, StickyNote,
  Download, Upload, Cloud,
} from "lucide-react";
import {
  listPocket, removePocket, togglePin, updateTrancheFields, savePocket, type PocketEntry,
} from "@/lib/storage";
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [notesEditingId, setNotesEditingId] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState<string>("");

  useEffect(() => { setList(listPocket()); }, []);

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: { symbol: string; market: MarketCode }[] = [];
    for (const e of list) {
      for (const u of e.tranche.underlyings) {
        const k = `${u.market}:${u.symbol}`;
        if (!seen.has(k)) { seen.add(k); out.push({ symbol: u.symbol, market: u.market }); }
      }
    }
    return out;
  }, [list]);
  const { quotes, loading, asOf, refresh } = useQuotes(items, 30_000);

  const enriched = useMemo(() => {
    return list.map((e) => {
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

  const summary = useMemo(() => {
    const counts: Record<RiskBand | "unknown", number> = {
      safe: 0, moderate: 0, "high-risk": 0, "near-ki": 0, "near-ko": 0, critical: 0, unknown: 0,
    };
    let nextKo: { date: string; trancheCode: string } | null = null;
    let withinMonth = 0;
    for (const { entry, risk: r, ko, daysToMat } of enriched) {
      counts[r?.band ?? "unknown"] += 1;
      if (ko && (!nextKo || ko.date < nextKo.date)) {
        nextKo = { date: ko.date, trancheCode: entry.tranche.trancheCode };
      }
      if (daysToMat >= 0 && daysToMat <= 30) withinMonth += 1;
    }
    return { total: enriched.length, counts, nextKo, withinMonth };
  }, [enriched]);

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
    if (!confirm("Remove this tranche from Pocket?")) return;
    removePocket(id); setList(listPocket());
  }
  function handlePin(id: string) { togglePin(id); setList(listPocket()); }
  function startEdit(id: string, currentCode: string) { setEditingId(id); setEditingValue(currentCode); }
  function commitEdit(id: string) {
    const v = editingValue.trim();
    if (v) updateTrancheFields(id, { trancheCode: v });
    setEditingId(null); setList(listPocket());
  }
  function startNotesEdit(id: string, current?: string) { setNotesEditingId(id); setNotesValue(current ?? ""); }
  function commitNotes(id: string) {
    updateTrancheFields(id, { notes: notesValue.trim() || undefined });
    setNotesEditingId(null); setList(listPocket());
  }

  // ─── backup / restore ────────────────────────────────────────────────────
  // Until full cloud sync (Supabase + Google + WebAuthn) ships, the user can
  // back up their Pocket as a JSON file and re-import it if their browser
  // data gets cleared. Round-trips the exact PocketEntry shape — including
  // pinned state, notes, and timestamps — so nothing is lost.
  function handleExport() {
    const data = listPocket();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `pocket-backup-${stamp}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed)) throw new Error("not an array");
        // Merge by id — imported entries replace existing ones with the same
        // id, otherwise are prepended. Keeps the user's most recent saves on
        // top while not losing local work.
        const existing = listPocket();
        const byId = new Map<string, PocketEntry>(existing.map((x) => [x.id, x]));
        for (const e of parsed as PocketEntry[]) {
          if (e && typeof e.id === "string" && e.tranche) byId.set(e.id, e);
        }
        const merged = Array.from(byId.values());
        savePocket(merged);
        setList(merged);
        alert(`Imported ${parsed.length} tranche${parsed.length === 1 ? "" : "s"}. Total now: ${merged.length}.`);
      } catch (err) {
        alert("Could not read backup file — please pick a valid pocket-backup-*.json file.");
      }
    };
    reader.readAsText(file);
    // Reset the input so re-selecting the same file fires onChange again.
    e.target.value = "";
  }

  return (
    <>
      <header className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Watchlist - {summary.total} saved
          </div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Wallet size={18} /> Pocket
          </h1>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
          <span className="hidden sm:inline">
            {loading ? "Refreshing..." : asOf ? `Last ${new Date(asOf).toLocaleTimeString()}` : ""}
          </span>
          <button onClick={refresh} className="underline">refresh</button>
        </div>
      </header>

      {/* Backup / restore controls — interim until cloud sync (Supabase auth +
          Google login + biometric) is wired. Lets the user survive a browser
          data clear by downloading a JSON snapshot and re-importing it. */}
      <section className="card mb-3 flex flex-wrap items-center justify-between gap-2 p-3 text-[12px]">
        <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
          <Cloud size={14} />
          <span>
            <strong className="text-[var(--text)]">Backup &amp; restore.</strong>{" "}
            Cloud sync with Google + biometric is on the roadmap — for now,
            export to file so a browser clear doesn&apos;t lose your Pocket.
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleExport}
            className="btn h-8 px-3 text-[12px]"
            disabled={summary.total === 0}
            title={summary.total === 0 ? "Nothing to export yet" : "Download Pocket as JSON"}
          >
            <Download size={13} /> Export
          </button>
          <label className="btn h-8 cursor-pointer px-3 text-[12px]">
            <Upload size={13} /> Import
            <input type="file" accept="application/json,.json" onChange={handleImport} className="hidden" />
          </label>
        </div>
      </section>

      {summary.total === 0 && (
        <div className="card p-6 text-center text-[13px] text-[var(--text-muted)]">
          No tranches saved yet.{" "}
          <Link href="/" className="text-accent underline">Parse one and tap Save to Pocket</Link>{" "}
          to start tracking.
        </div>
      )}

      {summary.total > 0 && (
        <>
          <section className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SummaryCard icon={<Shield size={14} />} label="Safe / Moderate"
              value={summary.counts.safe + summary.counts.moderate} total={summary.total} tone="success" />
            <SummaryCard icon={<AlertTriangle size={14} />} label="High risk"
              value={summary.counts["high-risk"] + summary.counts["near-ki"]} total={summary.total} tone="warning" />
            <SummaryCard icon={<ShieldAlert size={14} />} label="Critical / Near KO"
              value={summary.counts.critical + summary.counts["near-ko"]} total={summary.total} tone="danger" />
            <SummaryCard icon={<Calendar size={14} />} label="Maturing <= 30 days"
              value={summary.withinMonth} total={summary.total} tone="accent" />
          </section>

          <section className="card mb-3 p-3">
            <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
              <span className="font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <Activity size={12} /> Risk distribution
              </span>
              {summary.nextKo && (
                <span className="tabular">
                  Next KO observation: <strong className="text-[var(--text)]">{summary.nextKo.date}</strong>{" "}
                  <span className="text-[var(--text-muted)]">({summary.nextKo.trancheCode})</span>
                </span>
              )}
            </div>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-[var(--line)]">
              <RiskSeg n={summary.counts.safe} total={summary.total} className="bg-success" />
              <RiskSeg n={summary.counts.moderate} total={summary.total} className="bg-warning" />
              <RiskSeg n={summary.counts["near-ko"]} total={summary.total} className="bg-accent-500" />
              <RiskSeg n={summary.counts["high-risk"] + summary.counts["near-ki"]} total={summary.total} className="bg-danger/80" />
              <RiskSeg n={summary.counts.critical} total={summary.total} className="bg-danger" />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-[var(--text-muted)]">
              <Legend dot="bg-success" label="Safe" n={summary.counts.safe} />
              <Legend dot="bg-warning" label="Moderate" n={summary.counts.moderate} />
              <Legend dot="bg-accent-500" label="Near KO" n={summary.counts["near-ko"]} />
              <Legend dot="bg-danger/80" label="High risk / near KI" n={summary.counts["high-risk"] + summary.counts["near-ki"]} />
              <Legend dot="bg-danger" label="Critical" n={summary.counts.critical} />
            </div>
          </section>

          <div className="card mb-3 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Search size={14} className="text-[var(--text-muted)]" />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search tranche code or underlying..." className="input h-9" />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <Filter size={12} className="text-[var(--text-muted)]" />
              <select className="input h-8 w-auto px-2 text-[12px]" value={ccy} onChange={(e) => setCcy(e.target.value as any)}>
                <option value="all">All ccy</option>
                {CCYS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className="input h-8 w-auto px-2 text-[12px]" value={risk} onChange={(e) => setRisk(e.target.value as any)}>
                <option value="all">All risk</option>
                {RISK_FILTERS.map((r) => <option key={r} value={r}>{bandLabel(r)}</option>)}
              </select>
              <select className="input h-8 w-auto px-2 text-[12px]" value={maturityWithin}
                onChange={(e) => setMaturityWithin(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}>
                <option value="all">Any maturity</option>
                <option value="30">≤ 30 days</option>
                <option value="90">≤ 90 days</option>
                <option value="180">≤ 6 months</option>
                <option value="365">≤ 1 year</option>
              </select>
            </div>
          </div>
        </>
      )}

      {summary.total > 0 && filtered.length === 0 && (
        <div className="card p-6 text-center text-[13px] text-[var(--text-muted)]">
          No tranches match your filters.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {filtered.map(({ entry, risk: r, ko, maturity, daysToMat }) => {
          const t = entry.tranche;
          const symbols = t.underlyings.map((u) => u.symbol).join(" - ");
          const editing = editingId === entry.id;
          return (
            <article key={entry.id} className="card p-3">
              <header className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {t.issuer || "Tranche"} - {t.currency}
                    {entry.pinned && <Pin size={11} className="text-accent" />}
                  </div>
                  {editing ? (
                    <div className="mt-0.5 flex items-center gap-1">
                      <input autoFocus value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value.toUpperCase())}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit(entry.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="input h-7 w-44 px-2 font-mono text-[13px]" />
                      <button onClick={() => commitEdit(entry.id)} className="btn h-7 px-2" title="Save"><Check size={13} /></button>
                      <button onClick={() => setEditingId(null)} className="btn h-7 px-2" title="Cancel"><X size={13} /></button>
                    </div>
                  ) : (
                    <button onClick={() => startEdit(entry.id, t.trancheCode)}
                      className="group flex items-center gap-1 truncate text-left font-mono text-[14px] font-semibold hover:text-accent"
                      title="Click to rename">
                      {t.trancheCode}
                      <Pencil size={11} className="opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  )}
                  <div className="truncate text-[12px] text-[var(--text-muted)]">{symbols}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => handlePin(entry.id)} className="btn h-8 px-2" title={entry.pinned ? "Unpin" : "Pin"}>
                    {entry.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                  </button>
                  <button onClick={() => handleRemove(entry.id)} className="btn h-8 px-2" title="Remove">
                    <Trash2 size={14} />
                  </button>
                </div>
              </header>

              <dl className="grid grid-cols-3 gap-2 text-[11.5px]">
                <Field label="Coupon" value={`${(t.couponPa * 100).toFixed(2)}% p.a.`} />
                <Field label="Tenor" value={`${t.tenorMonths}M`} />
                <Field label="Maturity" value={maturity} sub={daysToMat >= 0 ? `${daysToMat} days` : "matured"} />
                <Field label="Strike" value={`${(t.strikePct * 100).toFixed(0)}%`} />
                <Field label="EKI" value={`${(t.ekiPct * 100).toFixed(0)}%`} />
                <Field label="Next KO" value={ko ? `${(ko.koPct * 100).toFixed(0)}%` : "-"} sub={ko?.date} />
              </dl>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className={clsx("badge", r?.band || "moderate")}>
                  {r ? bandLabel(r.band) : "Loading..."}
                </span>
                <div className="text-[11px] text-[var(--text-muted)]">
                  {t.underlyings.map((u) => {
                    const q = quotes[u.symbol];
                    return (
                      // Each underlying symbol is a deep link → /analyze.
                      // Tap the symbol on a Pocket card to jump straight to
                      // that stock's research dashboard.
                      <Link
                        key={u.symbol}
                        href={`/analyze?symbol=${encodeURIComponent(u.symbol)}&market=${u.market}`}
                        className="ml-2 inline-block hover:text-accent first:ml-0"
                        title="Open in Stock Analyze"
                      >
                        <span className="text-[var(--text)] font-medium hover:underline">{u.symbol}</span>{" "}
                        <span className="text-[var(--text-muted)]">{formatPx(q?.price, q?.currency)}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 border-t border-[var(--line)] pt-2 text-[11.5px]">
                {notesEditingId === entry.id ? (
                  <div className="flex flex-col gap-1.5">
                    <textarea autoFocus value={notesValue}
                      onChange={(e) => setNotesValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitNotes(entry.id);
                        if (e.key === "Escape") setNotesEditingId(null);
                      }}
                      placeholder="Client(s), ticket #, follow-ups, allocation breakdown..."
                      className="input min-h-[60px] py-2 text-[12px] leading-snug" rows={3} />
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => setNotesEditingId(null)} className="btn h-7 px-2 text-[11px]"><X size={12} /> Cancel</button>
                      <button onClick={() => commitNotes(entry.id)} className="btn btn-primary h-7 px-2 text-[11px]"><Check size={12} /> Save</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => startNotesEdit(entry.id, t.notes)}
                    className="group flex w-full items-start gap-1.5 text-left text-[var(--text-muted)] hover:text-[var(--text)]"
                    title="Click to edit notes">
                    <StickyNote size={12} className="mt-0.5 flex-shrink-0" />
                    <span className="flex-1">
                      {t.notes
                        ? <span className="whitespace-pre-wrap">{t.notes}</span>
                        : <span className="italic opacity-70">Add notes - clients, allocation, follow-ups...</span>}
                    </span>
                    <Pencil size={10} className="mt-1 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

function SummaryCard({ icon, label, value, total, tone }: {
  icon: React.ReactNode; label: string; value: number; total: number; tone: "success" | "warning" | "danger" | "accent";
}) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  const toneCls = { success: "border-l-success", warning: "border-l-warning", danger: "border-l-danger", accent: "border-l-accent" }[tone];
  return (
    <div className={clsx("card p-3 border-l-4", toneCls)}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {icon}{label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <div className="tabular text-2xl font-semibold leading-none">{value}</div>
        <div className="text-[11px] text-[var(--text-muted)]">/ {total} ({pct}%)</div>
      </div>
    </div>
  );
}

function RiskSeg({ n, total, className }: { n: number; total: number; className: string }) {
  if (!n || !total) return null;
  return <div className={clsx("h-full", className)} style={{ width: `${(n / total) * 100}%` }} />;
}

function Legend({ dot, label, n }: { dot: string; label: string; n: number }) {
  if (n === 0) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={clsx("inline-block h-2 w-2 rounded-full", dot)} />
      {label} <span className="tabular text-[var(--text)] font-semibold">{n}</span>
    </span>
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
  return ({ safe: "Safe zone", moderate: "Moderate", "near-ki": "Near KI", "near-ko": "Near KO", "high-risk": "High risk", critical: "Critical" } as Record<RiskBand, string>)[b];
}

function computeMaturity(tradeDate: string, months: number): string {
  const [y, m, d] = tradeDate.split("-").map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}
