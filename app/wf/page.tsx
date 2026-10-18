"use client";

// Wealth Financing (WF) — side-by-side cash-flow comparison for client
// proposals. User enters a base portfolio in 4 buckets (Cash & FD, Unit
// Trust, Retail Bond, Structured Investment), optionally pledges it as
// collateral to borrow in a chosen currency, reinvests the drawdown
// across the same investment classes, and sees exactly how much extra
// monthly / 6M / 12M income the strategy produces AFTER the cost of
// financing is deducted.
//
// Everything renders in a single mobile-friendly column so the user can
// walk through it on an iPhone and export the summary panel as a PNG to
// WhatsApp directly to the client.

import { useMemo, useRef, useState } from "react";
import {
  Banknote, Download, Share2, Plus, Trash2, Users, AlertTriangle,
  TrendingUp, Wallet, PiggyBank, FileSpreadsheet, Zap,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, CartesianGrid,
} from "recharts";
import * as htmlToImage from "html-to-image";

/* ────────────────────────────────────────────────────────────────────
   Cost-of-Funds table (16 Oct 2026 — update when treasury rate card
   changes). All-in rate = COF + 1% spread.
   ──────────────────────────────────────────────────────────────────── */
const COF_TABLE: Record<string, { "1": number; "3": number; "6": number; "12": number }> = {
  USD: { "1": 4.26, "3": 4.44, "6": 4.66, "12": 4.99 },
  AUD: { "1": 4.85, "3": 4.95, "6": 5.11, "12": 5.30 },
  NZD: { "1": 3.21, "3": 3.40, "6": 3.64, "12": 4.06 },
  GBP: { "1": 4.21, "3": 4.41, "6": 4.66, "12": 5.04 },
  EUR: { "1": 2.82, "3": 2.91, "6": 3.11, "12": 3.38 },
  CHF: { "1": 0.12, "3": 0.13, "6": 0.26, "12": 0.47 },
  CAD: { "1": 2.51, "3": 2.61, "6": 2.85, "12": 3.21 },
  JPY: { "1": 1.43, "3": 1.46, "6": 1.66, "12": 1.93 },
  SGD: { "1": 1.80, "3": 1.87, "6": 1.95, "12": 2.05 },
  HKD: { "1": 3.00, "3": 3.33, "6": 3.65, "12": 4.15 },
};
const COF_SPREAD = 0.01; // 1% p.a. bank spread → all-in = COF/100 + 1%
const COF_AS_OF = "16 Oct 2026";
const MIN_PORTFOLIO = 1_000_000; // RM — minimum to qualify for WF

/* Base component defaults (RM). AR = recognised-as-collateral %. */
type BaseType = "fd" | "ut" | "bond" | "si";
interface BaseRow {
  type: BaseType;
  label: string;
  investment: number;
  returnPa: number;   // 0.02 = 2%
  ar: number;         // 1.0 = 100%
}
const BASE_DEFAULTS: BaseRow[] = [
  { type: "fd",   label: "Savings & Fixed Deposit", investment: 0, returnPa: 0.02, ar: 1.00 },
  { type: "ut",   label: "Unit Trust",              investment: 0, returnPa: 0.06, ar: 0.60 },
  { type: "bond", label: "Retail Bond",             investment: 0, returnPa: 0.05, ar: 0.75 },
  { type: "si",   label: "Structured Investment",   investment: 0, returnPa: 0.08, ar: 0.00 },
];

type WfType = "ut-wf" | "bond-wf" | "si-wf";
interface WfRow {
  id: string;
  type: WfType;
  label: string;
  wfAmount: number;
  returnPa: number;
  currency: string;   // key into COF_TABLE
  tenor: "1" | "3" | "6" | "12";
}
const WF_PRESETS: Array<{ type: WfType; label: string; returnPa: number }> = [
  { type: "ut-wf",   label: "Unit Trust (WF)",            returnPa: 0.06 },
  { type: "bond-wf", label: "Retail Bond (WF)",           returnPa: 0.05 },
  { type: "si-wf",   label: "Structured Investment (WF)", returnPa: 0.08 },
];

/* Helpers */
const fmt0 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const fmt2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number, d = 2) => `${(n * 100).toFixed(d)}%`;
const uid = () => Math.random().toString(36).slice(2, 10);
function allInRate(ccy: string, tenor: "1" | "3" | "6" | "12"): number {
  const cof = COF_TABLE[ccy]?.[tenor];
  if (cof == null) return COF_SPREAD;
  return cof / 100 + COF_SPREAD;
}

/* Colours for the chart segments */
const COLORS = {
  fd:    "#60a5fa", // blue-400
  ut:    "#a78bfa", // purple-400
  bond:  "#34d399", // emerald-400
  si:    "#f59e0b", // amber-500
  "ut-wf":   "#c084fc",
  "bond-wf": "#6ee7b7",
  "si-wf":   "#fbbf24",
  before: "#64748b",
  after:  "#6366f1",
  uplift: "#10b981",
};

export default function WFPage() {
  const [clientName, setClientName] = useState("");
  const [base, setBase] = useState<BaseRow[]>(BASE_DEFAULTS);
  const [wfs, setWfs] = useState<WfRow[]>([]);
  const [proposalDate] = useState(() => new Date().toISOString().slice(0, 10));

  // ─── Derived numbers ────────────────────────────────────────────────
  const beforeTotalInvest = base.reduce((s, r) => s + r.investment, 0);
  const totalCollateral   = base.reduce((s, r) => s + r.investment * r.ar, 0);
  const baseMonthly       = base.reduce((s, r) => s + (r.investment * r.returnPa) / 12, 0);
  const base12M           = baseMonthly * 12;
  const base6M            = baseMonthly * 6;

  const wfTotalAmount = wfs.reduce((s, r) => s + r.wfAmount, 0);
  const wfMonthlyGross = wfs.reduce((s, r) => s + (r.wfAmount * r.returnPa) / 12, 0);
  const wfMonthlyCost  = wfs.reduce((s, r) => s + (r.wfAmount * allInRate(r.currency, r.tenor)) / 12, 0);
  const wfMonthlyNet   = wfMonthlyGross - wfMonthlyCost;

  const afterTotalInvest = beforeTotalInvest + wfTotalAmount;
  const afterMonthly     = baseMonthly + wfMonthlyNet;
  const after12M         = afterMonthly * 12;
  const after6M          = afterMonthly * 6;

  const monthlyUplift = afterMonthly - baseMonthly;
  const upliftPct     = baseMonthly > 0 ? monthlyUplift / baseMonthly : 0;
  const returnOnCapital = beforeTotalInvest > 0 ? after12M / beforeTotalInvest : 0;
  const baseReturnOnCapital = beforeTotalInvest > 0 ? base12M / beforeTotalInvest : 0;

  // Validation
  const underMin = beforeTotalInvest > 0 && beforeTotalInvest < MIN_PORTFOLIO;
  const overCollateral = wfTotalAmount > totalCollateral;
  const availableCollateral = Math.max(0, totalCollateral - wfTotalAmount);

  // ─── Chart data ─────────────────────────────────────────────────────
  const comparisonBarData = [
    { label: "Monthly",   Before: baseMonthly,  After: afterMonthly },
    { label: "6 months",  Before: base6M,       After: after6M      },
    { label: "12 months", Before: base12M,      After: after12M     },
  ];
  const beforePieData = base
    .filter((r) => r.investment > 0)
    .map((r) => ({ name: r.label, value: r.investment, color: COLORS[r.type] }));
  const afterPieData = [
    ...beforePieData,
    ...wfs.filter((r) => r.wfAmount > 0).map((r) => ({ name: r.label, value: r.wfAmount, color: COLORS[r.type] })),
  ];
  const timelineData = Array.from({ length: 13 }, (_, m) => ({
    month: m,
    Before: baseMonthly * m,
    After: afterMonthly * m,
  }));

  // ─── Setters ────────────────────────────────────────────────────────
  const updateBase = (idx: number, patch: Partial<BaseRow>) => {
    setBase((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const addWf = (preset?: { type: WfType; label: string; returnPa: number }) => {
    const p = preset ?? WF_PRESETS[0];
    setWfs((prev) => [...prev, {
      id: uid(), type: p.type, label: p.label,
      wfAmount: 0, returnPa: p.returnPa,
      currency: "USD", tenor: "12",
    }]);
  };
  const updateWf = (id: string, patch: Partial<WfRow>) => {
    setWfs((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const removeWf = (id: string) => setWfs((prev) => prev.filter((r) => r.id !== id));

  // ─── Export (PNG) ───────────────────────────────────────────────────
  const summaryRef = useRef<HTMLDivElement>(null);
  const beforeRef  = useRef<HTMLDivElement>(null);
  const afterRef   = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState<"none" | "summary" | "before" | "after">("none");

  async function exportPng(which: "summary" | "before" | "after") {
    const el = which === "summary" ? summaryRef.current : which === "before" ? beforeRef.current : afterRef.current;
    if (!el) return;
    setExporting(which);
    try {
      const dataUrl = await htmlToImage.toPng(el, {
        pixelRatio: 2,
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--bg") || "#0d111c",
      });
      const label = clientName ? clientName.replace(/[^A-Za-z0-9_-]/g, "_") : "WF";
      const filename = `WF-${label}-${which}-${proposalDate}.png`;

      // Web Share API first (iPhone)
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        try {
          const blob = await (await fetch(dataUrl)).blob();
          const file = new File([blob], filename, { type: "image/png" });
          const canShare = typeof (navigator as any).canShare === "function"
            ? (navigator as any).canShare({ files: [file] })
            : true;
          if (canShare) {
            await navigator.share({
              files: [file],
              title: `Wealth Financing Proposal — ${clientName || "Client"}`,
              text: `WF proposal (${which}) · uplift ${pct(upliftPct)}`,
            });
            setExporting("none");
            return;
          }
        } catch (e: any) {
          if (e?.name === "AbortError") { setExporting("none"); return; }
          // Fall through to download
        }
      }
      const a = document.createElement("a");
      a.href = dataUrl; a.download = filename; a.click();
    } catch (e) {
      alert("Export failed: " + String((e as any)?.message || e));
    } finally {
      setExporting("none");
    }
  }

  return (
    <div className="pb-24">
      <style>{`
        .wf-input {
          width: 100%; min-width: 0;
          padding: 6px 8px;
          border-radius: 6px;
          background: var(--surface-2);
          border: 1px solid var(--line);
          font-size: 13px;
          font-variant-numeric: tabular-nums;
        }
        .wf-input:focus { outline: 2px solid rgb(99 102 241 / .4); outline-offset: -1px; }
        .wf-input-sm { font-size: 12px; padding: 4px 6px; }
        .wf-card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px; }
        .wf-metric { font-variant-numeric: tabular-nums; }
        @keyframes wf-rise { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform: translateY(0); } }
        .wf-rise { animation: wf-rise .4s ease-out both; }
      `}</style>

      {/* HERO */}
      <section className="mb-4 rounded-2xl border border-[var(--line)] bg-gradient-to-br from-emerald-500/10 via-sky-500/5 to-indigo-500/10 p-4">
        <div className="flex items-center gap-2">
          <Banknote size={22} className="text-emerald-400" />
          <h1 className="text-[20px] font-bold tracking-tight">Wealth Financing</h1>
        </div>
        <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">
          Compare client cash flow before and after wealth financing. Enter the base portfolio,
          add WF drawdowns in any currency, see the net income uplift after cost of financing.
        </p>
      </section>

      {/* CLIENT NAME + DATE */}
      <section className="wf-card mb-4">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              <Users size={10} className="mr-1 inline" /> Client name
            </label>
            <input
              className="wf-input mt-1"
              placeholder="e.g. Mr ABC"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Proposal date
            </label>
            <input className="wf-input mt-1" value={proposalDate} readOnly />
          </div>
        </div>
      </section>

      {/* ─── BEFORE WF ─── */}
      <section ref={beforeRef} className="wf-card mb-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              A · Before wealth financing
            </div>
            <h2 className="text-[15px] font-bold">Current portfolio & cash flow</h2>
          </div>
          <PiggyBank size={18} className="text-slate-400" />
        </div>

        <div className="space-y-2">
          {base.map((r, i) => {
            const monthly = (r.investment * r.returnPa) / 12;
            const collat = r.investment * r.ar;
            return (
              <div key={r.type} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/40 p-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                    <span className="h-2 w-2 rounded-full" style={{ background: COLORS[r.type] }} />
                    {r.label}
                  </span>
                  <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[9.5px] font-mono text-[var(--text-muted)]">
                    AR {pct(r.ar, 0)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[9.5px] uppercase tracking-wider text-[var(--text-muted)]">Investment (RM)</span>
                    <input
                      className="wf-input wf-input-sm mt-0.5"
                      type="number" inputMode="decimal" min={0}
                      value={r.investment || ""}
                      placeholder="0"
                      onChange={(e) => updateBase(i, { investment: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </label>
                  <label className="block">
                    <span className="text-[9.5px] uppercase tracking-wider text-[var(--text-muted)]">Return p.a.</span>
                    <div className="relative">
                      <input
                        className="wf-input wf-input-sm mt-0.5 pr-6"
                        type="number" inputMode="decimal" step="0.1" min={0}
                        value={(r.returnPa * 100).toFixed(2)}
                        onChange={(e) => updateBase(i, { returnPa: Math.max(0, (Number(e.target.value) || 0) / 100) })}
                      />
                      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">%</span>
                    </div>
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-[10.5px]">
                  <span className="text-[var(--text-muted)]">Collateral</span>
                  <span className="wf-metric font-semibold">{fmt0(collat)}</span>
                  <span className="text-[var(--text-muted)]">·</span>
                  <span className="text-[var(--text-muted)]">Monthly</span>
                  <span className="wf-metric font-semibold text-emerald-400">{fmt0(monthly)}</span>
                  <span className="text-[var(--text-muted)]">·</span>
                  <span className="text-[var(--text-muted)]">12M</span>
                  <span className="wf-metric font-semibold text-emerald-400">{fmt0(monthly * 12)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Base totals */}
        <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-3">
          <div className="grid grid-cols-2 gap-2 text-[11.5px] sm:grid-cols-4">
            <TotalCell label="Total invested" value={fmt0(beforeTotalInvest)} />
            <TotalCell label="Collateral" value={fmt0(totalCollateral)} />
            <TotalCell label="Monthly income" value={fmt0(baseMonthly)} accent />
            <TotalCell label="12M income" value={fmt0(base12M)} accent />
          </div>
          <div className="mt-2 text-[10px] text-[var(--text-muted)]">
            Return on capital: <b className="text-[var(--text)]">{pct(baseReturnOnCapital)}</b> p.a.
          </div>
        </div>

        {/* Min warning */}
        {underMin && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-200 wf-rise">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              Minimum portfolio of RM 1,000,000 required to qualify for Wealth Financing.
              Currently RM {fmt0(beforeTotalInvest)} — short by RM {fmt0(MIN_PORTFOLIO - beforeTotalInvest)}.
            </span>
          </div>
        )}

        <div className="mt-3">
          <button
            onClick={() => exportPng("before")}
            disabled={exporting !== "none"}
            className="btn h-9 w-full px-3 text-xs"
          >
            <Download size={13} />
            {exporting === "before" ? "Preparing…" : "Download Before (PNG)"}
          </button>
        </div>
      </section>

      {/* ─── AFTER WF ─── */}
      <section ref={afterRef} className="wf-card mb-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              B · After wealth financing
            </div>
            <h2 className="text-[15px] font-bold">With WF drawdowns reinvested</h2>
          </div>
          <Zap size={18} className="text-indigo-400" />
        </div>

        {/* Base is inherited verbatim — show as a compact row */}
        <div className="mb-3 rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface-2)]/30 p-2 text-[10.5px] text-[var(--text-muted)]">
          Base portfolio inherited from above (unchanged): <b className="text-[var(--text)]">{fmt0(beforeTotalInvest)}</b>,
          monthly <b className="text-emerald-400">{fmt0(baseMonthly)}</b>.
        </div>

        {/* WF additions */}
        <div className="space-y-2">
          {wfs.map((r) => {
            const monthlyGross = (r.wfAmount * r.returnPa) / 12;
            const rate = allInRate(r.currency, r.tenor);
            const monthlyCost = (r.wfAmount * rate) / 12;
            const monthlyNet = monthlyGross - monthlyCost;
            return (
              <div key={r.id} className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-2.5 wf-rise">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <select
                    className="wf-input wf-input-sm max-w-[180px]"
                    value={r.type}
                    onChange={(e) => {
                      const preset = WF_PRESETS.find((p) => p.type === e.target.value);
                      if (preset) updateWf(r.id, { type: preset.type, label: preset.label, returnPa: preset.returnPa });
                    }}
                  >
                    {WF_PRESETS.map((p) => <option key={p.type} value={p.type}>{p.label}</option>)}
                  </select>
                  <button
                    onClick={() => removeWf(r.id)}
                    className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-danger"
                    title="Remove"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[9.5px] uppercase tracking-wider text-[var(--text-muted)]">WF amount (RM-eq.)</span>
                    <input
                      className="wf-input wf-input-sm mt-0.5"
                      type="number" inputMode="decimal" min={0}
                      value={r.wfAmount || ""}
                      placeholder="0"
                      onChange={(e) => updateWf(r.id, { wfAmount: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </label>
                  <label className="block">
                    <span className="text-[9.5px] uppercase tracking-wider text-[var(--text-muted)]">Return p.a.</span>
                    <div className="relative">
                      <input
                        className="wf-input wf-input-sm mt-0.5 pr-6"
                        type="number" inputMode="decimal" step="0.1" min={0}
                        value={(r.returnPa * 100).toFixed(2)}
                        onChange={(e) => updateWf(r.id, { returnPa: Math.max(0, (Number(e.target.value) || 0) / 100) })}
                      />
                      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-muted)]">%</span>
                    </div>
                  </label>
                  <label className="block">
                    <span className="text-[9.5px] uppercase tracking-wider text-[var(--text-muted)]">Drawdown currency</span>
                    <select
                      className="wf-input wf-input-sm mt-0.5"
                      value={r.currency}
                      onChange={(e) => updateWf(r.id, { currency: e.target.value })}
                    >
                      {Object.keys(COF_TABLE).map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[9.5px] uppercase tracking-wider text-[var(--text-muted)]">Tenor</span>
                    <select
                      className="wf-input wf-input-sm mt-0.5"
                      value={r.tenor}
                      onChange={(e) => updateWf(r.id, { tenor: e.target.value as any })}
                    >
                      <option value="1">1 month</option>
                      <option value="3">3 months</option>
                      <option value="6">6 months</option>
                      <option value="12">12 months</option>
                    </select>
                  </label>
                </div>
                <div className="mt-2 rounded bg-[var(--surface)] p-2 text-[10.5px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--text-muted)]">All-in cost ({r.currency} {r.tenor}M)</span>
                    <span className="wf-metric font-semibold">{pct(rate)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="text-[var(--text-muted)]">Gross / mo · Cost / mo</span>
                    <span className="wf-metric">
                      {fmt0(monthlyGross)} <span className="text-[var(--text-muted)]">·</span> <span className="text-danger">−{fmt0(monthlyCost)}</span>
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 border-t border-dashed border-[var(--line)] pt-1">
                    <span className="font-semibold">Net monthly</span>
                    <span className={`wf-metric font-bold ${monthlyNet >= 0 ? "text-emerald-400" : "text-danger"}`}>
                      {fmt0(monthlyNet)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add WF button(s) */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {WF_PRESETS.map((p) => (
            <button
              key={p.type}
              onClick={() => addWf(p)}
              className="flex items-center gap-1 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-2 py-1.5 text-[11px] font-semibold text-indigo-200 hover:bg-indigo-500/20"
              disabled={underMin}
              title={underMin ? "Portfolio under RM 1M — WF not available" : `Add ${p.label}`}
            >
              <Plus size={11} /> {p.label.replace(" (WF)", "")}
            </button>
          ))}
        </div>

        {/* After totals */}
        <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-3">
          <div className="grid grid-cols-2 gap-2 text-[11.5px] sm:grid-cols-4">
            <TotalCell label="Total invested" value={fmt0(afterTotalInvest)} />
            <TotalCell label="WF drawdown" value={fmt0(wfTotalAmount)} />
            <TotalCell label="Monthly income" value={fmt0(afterMonthly)} accent />
            <TotalCell label="12M income" value={fmt0(after12M)} accent />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 text-[10px] text-[var(--text-muted)]">
            <span>Return on capital: <b className="text-[var(--text)]">{pct(returnOnCapital)}</b> p.a.</span>
            <span>· Collateral available: <b className={`text-[var(--text)] ${overCollateral ? "text-danger" : ""}`}>{fmt0(availableCollateral)}</b></span>
          </div>
        </div>

        {/* Over-collateral warning */}
        {overCollateral && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-2.5 text-[11px] text-danger wf-rise">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              WF drawdown ({fmt0(wfTotalAmount)}) exceeds recognised collateral ({fmt0(totalCollateral)}).
              Reduce WF amount by RM {fmt0(wfTotalAmount - totalCollateral)}.
            </span>
          </div>
        )}

        <div className="mt-3">
          <button
            onClick={() => exportPng("after")}
            disabled={exporting !== "none"}
            className="btn h-9 w-full px-3 text-xs"
          >
            <Download size={13} />
            {exporting === "after" ? "Preparing…" : "Download After (PNG)"}
          </button>
        </div>
      </section>

      {/* ─── SUMMARY + CHARTS ─── */}
      <section ref={summaryRef} className="wf-card mb-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              C · Side-by-side summary
            </div>
            <h2 className="text-[15px] font-bold">
              {clientName ? `${clientName} — ` : ""}Before vs After
            </h2>
          </div>
          <FileSpreadsheet size={18} className="text-sky-400" />
        </div>

        {/* Big uplift display */}
        <div className="mb-3 rounded-lg bg-gradient-to-br from-emerald-500/15 to-sky-500/10 p-4 text-center">
          <div className="text-[10.5px] uppercase tracking-wider text-[var(--text-muted)]">
            Monthly income uplift
          </div>
          <div className="mt-1 flex items-end justify-center gap-2">
            <span className="wf-metric text-[28px] font-bold text-emerald-400">
              +RM {fmt0(monthlyUplift)}
            </span>
            <span className="wf-metric mb-1 text-[13px] font-semibold text-emerald-400">
              ({monthlyUplift >= 0 ? "+" : ""}{pct(upliftPct)})
            </span>
          </div>
          <div className="mt-1 text-[10.5px] text-[var(--text-muted)]">
            RM {fmt0(baseMonthly)} <TrendingUp size={10} className="mx-1 inline" /> RM {fmt0(afterMonthly)} per month
          </div>
        </div>

        {/* 3-tenor comparison bars */}
        <div className="mb-3 h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={comparisonBarData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
              <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(v: any) => `RM ${fmt0(Number(v))}`}
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", fontSize: 11, borderRadius: 8 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Before" fill={COLORS.before} radius={[4, 4, 0, 0]} />
              <Bar dataKey="After"  fill={COLORS.after}  radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Cumulative income over 12 months */}
        <div className="mb-3 h-[180px]">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Cumulative income — month by month
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={timelineData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickFormatter={(v) => `M${v}`} />
              <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(v: any) => `RM ${fmt0(Number(v))}`}
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", fontSize: 11, borderRadius: 8 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Before" stroke={COLORS.before} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="After"  stroke={COLORS.after}  strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Portfolio composition pie charts */}
        <div className="grid grid-cols-2 gap-2">
          <PieBlock title="Before" data={beforePieData} total={beforeTotalInvest} />
          <PieBlock title="After"  data={afterPieData}  total={afterTotalInvest} />
        </div>

        {/* Numeric summary row */}
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <SummaryKV label="Monthly income"  before={baseMonthly} after={afterMonthly} />
          <SummaryKV label="6-month income"  before={base6M}      after={after6M}      />
          <SummaryKV label="12-month income" before={base12M}     after={after12M}     />
          <SummaryKV label="Return on capital"
            before={baseReturnOnCapital} after={returnOnCapital} asPct />
        </div>

        <p className="mt-3 border-t border-dashed border-[var(--line)] pt-2 text-[9.5px] leading-snug text-[var(--text-muted)]">
          IMPORTANT: Returns are illustrative, not guaranteed. Actual financing availability,
          collateral recognition, FX impact and prevailing rates remain subject to bank approval
          and documentation. COF rate card as of {COF_AS_OF}; all-in = COF + {pct(COF_SPREAD, 0)} spread.
        </p>
      </section>

      {/* ─── EXPORT BUTTONS ─── */}
      <section className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          onClick={() => exportPng("summary")}
          disabled={exporting !== "none"}
          className="btn btn-primary h-10 px-3 text-xs"
        >
          {exporting === "summary" ? <Download size={14} className="animate-pulse" /> : <Share2 size={14} />}
          Share Summary PNG
        </button>
        <button onClick={() => exportPng("before")} disabled={exporting !== "none"} className="btn h-10 px-3 text-xs">
          <Download size={14} /> Before PNG
        </button>
        <button onClick={() => exportPng("after")} disabled={exporting !== "none"} className="btn h-10 px-3 text-xs">
          <Download size={14} /> After PNG
        </button>
      </section>

      {/* COF rate card reference */}
      <details className="wf-card">
        <summary className="cursor-pointer text-[11.5px] font-semibold">
          <Wallet size={12} className="mr-1 inline" /> COF rate card — {COF_AS_OF}
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[10.5px]">
            <thead className="text-[9.5px] uppercase tracking-wider text-[var(--text-muted)]">
              <tr>
                <th className="p-1 text-left">Ccy</th>
                <th className="p-1 text-right">1M</th>
                <th className="p-1 text-right">3M</th>
                <th className="p-1 text-right">6M</th>
                <th className="p-1 text-right">12M</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(COF_TABLE).map(([ccy, rates]) => (
                <tr key={ccy} className="border-t border-[var(--line)]">
                  <td className="p-1 font-semibold">{ccy}</td>
                  <td className="p-1 tabular text-right">{fmt2(rates["1"])}</td>
                  <td className="p-1 tabular text-right">{fmt2(rates["3"])}</td>
                  <td className="p-1 tabular text-right">{fmt2(rates["6"])}</td>
                  <td className="p-1 tabular text-right">{fmt2(rates["12"])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[9.5px] text-[var(--text-muted)]">
            All-in rate = COF + {pct(COF_SPREAD, 0)} spread. COF captured at drawdown & rollover.
          </p>
        </div>
      </details>
    </div>
  );
}

/* ─── Helper sub-components ─────────────────────────────────────────── */

function TotalCell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className={`wf-metric mt-0.5 text-[14px] font-bold ${accent ? "text-emerald-400" : ""}`}>
        RM {value}
      </div>
    </div>
  );
}

function SummaryKV({ label, before, after, asPct }: {
  label: string; before: number; after: number; asPct?: boolean;
}) {
  const diff = after - before;
  const fmt = (n: number) => asPct ? pct(n) : `RM ${fmt0(n)}`;
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--surface-2)]/50 p-2">
      <div className="text-[9.5px] uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className="mt-0.5 flex items-baseline justify-between gap-1">
        <span className="wf-metric text-[11px] text-[var(--text-muted)]">{fmt(before)}</span>
        <span className="wf-metric text-[11px] font-bold text-indigo-400">→ {fmt(after)}</span>
      </div>
      {diff > 0 && !asPct && (
        <div className="mt-0.5 text-right text-[10px] font-semibold text-emerald-400">
          +RM {fmt0(diff)}
        </div>
      )}
    </div>
  );
}

function PieBlock({ title, data, total }: { title: string; data: Array<{ name: string; value: number; color: string }>; total: number }) {
  if (data.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--line)] p-3 text-center">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{title}</div>
        <div className="mt-2 text-[11px] text-[var(--text-muted)]">no data yet</div>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--surface-2)]/50 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{title}</span>
        <span className="wf-metric text-[10px] font-semibold">RM {fmt0(total)}</span>
      </div>
      <div className="h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%" cy="50%"
              outerRadius={48}
              innerRadius={22}
              paddingAngle={1}
            >
              {data.map((e, i) => <Cell key={i} fill={e.color} />)}
            </Pie>
            <Tooltip
              formatter={(v: any, n: any) => [`RM ${fmt0(Number(v))}`, n]}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", fontSize: 10, borderRadius: 6 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
