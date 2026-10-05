"use client";

// Wayne tab — the DCF-based intrinsic-value model named after the treasury
// specialist whose launches knock out early. User types a ticker, hits
// "See what Wayne's thinking", watches a theatrical calculation reveal,
// gets a 12-month target price. Powered by /api/wayne/analyze.

import { useEffect, useRef, useState } from "react";
import { Brain, Loader2, Search, TrendingUp, TrendingDown, ShieldAlert, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { MarketCode } from "@/lib/types";

interface Projection { year: number; fcf: number; pv: number; }
interface Analysis {
  symbol: string;
  market: string;
  ySymbol: string;
  longName: string | null;
  currency: string | null;
  price: number;
  marketCap: number | null;
  inputs: {
    beta: number | null;
    forwardPE: number | null;
    trailingPE: number | null;
    epsForward: number | null;
    epsTrailing: number | null;
    freeCashFlow: number | null;
    operatingCashFlow: number | null;
    capex: number | null;
    sharesOut: number | null;
    totalDebt: number | null;
    totalCash: number | null;
    totalEquity: number | null;
    earningsGrowth: number | null;
    revenueGrowth: number | null;
  };
  assumptions: {
    riskFree: number; equityPremium: number; terminalGrowth: number;
    waynePEHaircut: number; explicitYears: number;
    growthUsed: number; growthSource: string;
    fcfSource: string;
    netDebtToFCFBan: number; netDebtToEquityBan: number;
  };
  computed: {
    discountRate: number;
    growth: number;
    ourPE: number | null;
    waynesPE: number | null;
    nextYearEPS: number | null;
    ourIntrinsicValue: number | null;
    waynesIntrinsicValue: number | null;
    ourFutureValue: number | null;
    waynesFutureValue: number | null;
    ourEvSalesIV: number | null;
    waynesEvSalesIV: number | null;
    evSalesMarketMultiple: number;
    evSalesWayneMultiple: number;
    evSalesUsed: boolean;
    peMethodFailed: boolean;
    intrinsicPerShare: number | null; // legacy alias
    futureValue12m: number | null;    // legacy alias
    waynesTarget: number | null;
    fcfIntrinsicValue: number | null;
    projections: Projection[];
    terminalValue: number | null;
    terminalPV: number | null;
    enterpriseValue: number | null;
    netDebt: number;
    debtToFCF: number | null;
    debtToEquity: number | null;
    debtToEquitySource: "yahoo-normalized" | "raw-computed" | "unavailable";
    cashRich: boolean;
    banned: boolean;
    banReasons: string[];
    eliLevels: {
      strikePct: number;
      ekiPct: number;
      strikePrice: number;
      ekiPrice: number;
      strikeVsOurIV: number | null;
      strikeVsWaynesIV: number | null;
      ekiVsOurIV: number | null;
      ekiVsWaynesIV: number | null;
    };
    verdict: "LAUNCH" | "WATCH" | "AVOID" | "SKIP";
    upsidePct: number | null;
  };
  warnings?: string[];
  generatedAt: string;
}

const STEPS = [
  "Pulling market data…",
  "Reading beta & risk premiums…",
  "Running CAPM for discount rate…",
  "Projecting 5-year free cash flow…",
  "Computing terminal value…",
  "Adjusting for net cash…",
  "Blending forward multiple…",
  "Applying Wayne's safety margin…",
  "Done.",
];

// Smooth number ticker — counts from 0 → target over ms
function AnimatedNumber({ value, format, duration = 900 }: { value: number; format: (n: number) => string; duration?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const from = 0;
    const to = value;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3); // easeOutCubic
      setN(from + (to - from) * eased);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span>{format(n)}</span>;
}

function fmtMoney(n: number, ccy = "$") {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000_000) return `${ccy}${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `${ccy}${(n / 1_000_000).toFixed(2)}M`;
  return `${ccy}${n.toFixed(2)}`;
}
function fmtPrice(n: number, ccy = "$") { return `${ccy}${n.toFixed(2)}`; }
function fmtPct(n: number) { return `${(n * 100).toFixed(1)}%`; }

const MARKETS: { code: MarketCode; label: string }[] = [
  { code: "US", label: "US" },
  { code: "HK", label: "HK" },
  { code: "SG", label: "SG" },
  { code: "MY", label: "MY" },
  { code: "JP", label: "JP" },
  { code: "AU", label: "AU" },
];

export default function WaynePage() {
  const [symbol, setSymbol] = useState("");
  const [market, setMarket] = useState<MarketCode>("US");
  const [analyzing, setAnalyzing] = useState(false);
  const [stepIdx, setStepIdx] = useState(-1);
  const [result, setResult] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Animate the step list sequentially while the fetch runs in parallel.
  useEffect(() => {
    if (!analyzing) return;
    setStepIdx(0);
    let i = 0;
    const id = window.setInterval(() => {
      i++;
      if (i >= STEPS.length) { window.clearInterval(id); return; }
      setStepIdx(i);
    }, 480);
    return () => window.clearInterval(id);
  }, [analyzing]);

  async function ask() {
    const s = symbol.trim().toUpperCase();
    if (!s) { inputRef.current?.focus(); return; }
    setError(null);
    setResult(null);
    setAnalyzing(true);
    try {
      // Minimum theatrical delay so the animation is visible even on fast nets
      const theatrical = new Promise((res) => setTimeout(res, 4000));
      const r = await fetch(`/api/wayne/analyze?symbol=${encodeURIComponent(s)}&market=${market}`, { cache: "no-store" });
      await theatrical;
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const data = (await r.json()) as Analysis;
      setResult(data);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setAnalyzing(false);
      setStepIdx(-1);
    }
  }

  function onKey(e: React.KeyboardEvent) { if (e.key === "Enter") ask(); }

  const c = result?.computed;
  const i = result?.inputs;
  const a = result?.assumptions;
  const ccy = result?.currency === "USD" ? "$" : (result?.currency === "HKD" ? "HK$" : "$");

  return (
    <div className="pb-20">
      <style>{`
        @keyframes brain-glow { 0%,100% { filter: drop-shadow(0 0 2px rgba(99,102,241,.6)); } 50% { filter: drop-shadow(0 0 14px rgba(99,102,241,.9)); } }
        @keyframes slide-up { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes formula-pop { from { opacity: 0; transform: translateY(6px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes line-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes grid-pan { from { background-position: 0 0; } to { background-position: 40px 40px; } }
        .brain-glow { animation: brain-glow 2.4s ease-in-out infinite; }
        .slide-up { animation: slide-up .5s ease-out both; }
        .formula-pop { animation: formula-pop .55s ease-out both; }
        .line-grow { transform-origin: left; animation: line-grow .6s ease-out both; }
        .wayne-grid { background-image:
          linear-gradient(var(--line) 1px, transparent 1px),
          linear-gradient(90deg, var(--line) 1px, transparent 1px);
          background-size: 40px 40px; opacity: .12;
          animation: grid-pan 8s linear infinite;
        }
      `}</style>

      {/* HERO */}
      <section className="relative mb-5 overflow-hidden rounded-2xl border border-[var(--line)] bg-gradient-to-br from-indigo-600/10 via-purple-600/5 to-sky-500/10 p-5 sm:p-7">
        <div className="pointer-events-none absolute inset-0 wayne-grid" />
        <div className="relative">
          <div className="mb-2 flex items-center gap-2">
            <Brain size={26} className="brain-glow text-indigo-400" />
            <h1 className="text-[22px] font-bold tracking-tight">Ask Wayne</h1>
          </div>
          <p className="max-w-xl text-[12.5px] leading-relaxed text-[var(--text-muted)]">
            Two-stage DCF with CAPM-derived discount rate, blended with a forward-earnings multiple
            and a 5% safety margin. Wayne skips over-leveraged names (D/E &gt; 1.0).
            Pure Yahoo fundamentals, no analyst sell-side input.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-1">
              {MARKETS.map((m) => (
                <button
                  key={m.code}
                  onClick={() => setMarket(m.code)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded ${market === m.code ? "bg-indigo-600 text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}
                >{m.label}</button>
              ))}
            </div>
            <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
              <Search size={16} className="text-[var(--text-muted)]" />
              <input
                ref={inputRef}
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                onKeyDown={onKey}
                placeholder="e.g. MRVL, NVDA, 9988"
                className="w-full bg-transparent text-[14px] font-semibold uppercase tracking-wide outline-none placeholder:text-[var(--text-muted)] placeholder:font-normal placeholder:normal-case"
                autoComplete="off"
                autoCapitalize="characters"
              />
            </div>
            <button
              onClick={ask}
              disabled={analyzing || !symbol.trim()}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {analyzing ? <Loader2 size={15} className="animate-spin" /> : <Brain size={15} />}
              See what Wayne's thinking
            </button>
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </section>

      {/* THEATRICAL CALCULATION STREAM */}
      {analyzing && (
        <section className="mb-5 slide-up rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <Loader2 size={13} className="animate-spin text-indigo-400" />
            Running Wayne's model
          </div>
          <ol className="space-y-1.5 font-mono text-[11.5px]">
            {STEPS.map((s, k) => (
              <li
                key={k}
                className={`flex items-center gap-2 ${k <= stepIdx ? "text-[var(--text)]" : "text-[var(--text-muted)] opacity-40"}`}
              >
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${k < stepIdx ? "bg-success" : k === stepIdx ? "bg-indigo-400 brain-glow" : "bg-[var(--line)]"}`} />
                <span className="truncate">{s}</span>
                {k < stepIdx && <CheckCircle2 size={11} className="ml-auto text-success" />}
              </li>
            ))}
          </ol>
          <div className="mt-3 overflow-hidden rounded bg-[var(--surface-2)]">
            <div className="h-1 bg-indigo-500 line-grow" style={{ width: `${Math.max(0, (stepIdx + 1) / STEPS.length) * 100}%`, transition: "width 480ms ease-out" }} />
          </div>
        </section>
      )}

      {/* RESULTS */}
      {result && !analyzing && c && i && a && (
        <>
          {/* 1. DEBT GATE — runs first, visible first */}
          <DebtGate
            banned={c.banned}
            reasons={c.banReasons}
            debtToFCF={c.debtToFCF}
            debtToEquity={c.debtToEquity}
            debtToEquitySource={c.debtToEquitySource}
            cashRich={c.cashRich}
            netDebt={c.netDebt}
            fcf={i.freeCashFlow}
            equity={i.totalEquity}
            fcfBan={a.netDebtToFCFBan}
            equityBan={a.netDebtToEquityBan}
          />

          {/* Warnings (growth-stage exemption, missing data flags, etc.) */}
          {result.warnings && result.warnings.length > 0 && (
            <div className="mb-4 slide-up rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              {result.warnings.map((w, idx) => (
                <div key={idx} className="flex items-start gap-2 text-[11.5px] text-amber-200">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-400" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* 2. Verdict banner */}
          <VerdictBanner verdict={c.verdict} upsidePct={c.upsidePct} banned={c.banned} />

          {/* 3. Current price + name */}
          <section className="mb-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <div className="text-[10.5px] uppercase tracking-wider text-[var(--text-muted)]">{result.ySymbol} · {result.market}</div>
                <div className="text-[16px] font-bold">{result.longName || result.symbol}</div>
              </div>
              <div className="text-right">
                <div className="text-[10.5px] uppercase tracking-wider text-[var(--text-muted)]">Current</div>
                <div className="text-[24px] font-bold tabular">{fmtPrice(result.price, ccy)}</div>
              </div>
            </div>
          </section>

          {/* 4. The 4-value matrix — Our vs Wayne's, Intrinsic vs Future */}
          <section className="mb-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Dual-model valuation
                {c.evSalesUsed && <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] text-amber-400">EV/Sales fallback — pre-profit name</span>}
              </h2>
              <span className="text-[10px] text-[var(--text-muted)]">
                {c.evSalesUsed ? (
                  <>Our multiple: <b className="text-[var(--text)]">{c.evSalesMarketMultiple.toFixed(1)}x</b> EV/Sales · Wayne's: <b className="text-[var(--text)]">{c.evSalesWayneMultiple.toFixed(1)}x</b></>
                ) : (
                  <>Our PE: <b className="text-[var(--text)]">{c.ourPE?.toFixed(1) ?? "—"}x</b> · Wayne's PE: <b className="text-[var(--text)]">{c.waynesPE?.toFixed(1) ?? "—"}x</b> ({(a.waynePEHaircut * 100).toFixed(0)}% haircut)</>
                )}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ValueCard
                label={c.evSalesUsed ? "Our IV (EV/Sales)" : "Our Intrinsic Value"}
                sublabel={c.evSalesUsed ? "Target EV/Sales × TTM revenue" : "Fwd EPS × Market PE · today"}
                value={c.evSalesUsed ? c.ourEvSalesIV : c.ourIntrinsicValue}
                ccy={ccy}
                hint={(() => {
                  const v = c.evSalesUsed ? c.ourEvSalesIV : c.ourIntrinsicValue;
                  return v && result.price ? ((v - result.price) / result.price) : null;
                })()}
              />
              <ValueCard
                label={c.evSalesUsed ? "Wayne's IV (EV/Sales)" : "Wayne's Intrinsic Value"}
                sublabel={c.evSalesUsed ? "Wayne's multiple × TTM revenue" : `Fwd EPS × Wayne's PE · today`}
                value={c.evSalesUsed ? c.waynesEvSalesIV : c.waynesIntrinsicValue}
                ccy={ccy}
                hint={(() => {
                  const v = c.evSalesUsed ? c.waynesEvSalesIV : c.waynesIntrinsicValue;
                  return v && result.price ? ((v - result.price) / result.price) : null;
                })()}
                accent
              />
              {!c.evSalesUsed && (
                <>
                  <ValueCard
                    label="Our Future Value (12M)"
                    sublabel="FY+1 EPS × Market PE"
                    value={c.ourFutureValue}
                    ccy={ccy}
                    hint={c.ourFutureValue && result.price ? ((c.ourFutureValue - result.price) / result.price) : null}
                  />
                  <ValueCard
                    label="Wayne's Future Value (12M)"
                    sublabel="FY+1 EPS × Wayne's PE"
                    value={c.waynesFutureValue}
                    ccy={ccy}
                    hint={c.waynesFutureValue && result.price ? ((c.waynesFutureValue - result.price) / result.price) : null}
                    accent
                  />
                </>
              )}
              {c.evSalesUsed && (
                <div className="col-span-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] text-amber-200">
                  <b>Note:</b> This stock has negative or null Forward EPS so the PE method doesn't apply.
                  Using <b>EV/Sales</b> instead — target multiple is sector-adjusted based on revenue growth
                  ({c.growth > 0 ? `${(c.growth * 100).toFixed(0)}% growth bucket` : "slow bucket"}).
                  Future Value (12M) suppressed because growth-stage names revalue on next quarter's
                  revenue, not EPS extrapolation.
                </div>
              )}
            </div>
            <div className="mt-3 rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">Wayne's Target Price (today)</div>
              <div className="mt-0.5 flex items-baseline gap-3 flex-wrap">
                <div className="text-[32px] font-bold tabular text-indigo-400">
                  {c.waynesTarget != null ? <AnimatedNumber value={c.waynesTarget} format={(n) => fmtPrice(n, ccy)} /> : "—"}
                </div>
                {c.upsidePct != null && (
                  <div className={`text-[13px] font-semibold ${c.upsidePct >= 0 ? "text-success" : "text-danger"}`}>
                    {c.upsidePct > 0 ? "+" : ""}{c.upsidePct.toFixed(1)}% vs current
                  </div>
                )}
              </div>
              <div className="mt-0.5 text-[10.5px] text-[var(--text-muted)]">
                Wayne's conservative PE applied to current forward EPS (his primary anchor).
              </div>
            </div>
          </section>

          {/* 5. ELI level analysis (Strike + EKI vs IV) */}
          <section className="mb-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              ELI tranche levels ({(c.eliLevels.strikePct * 100).toFixed(0)}% strike · {(c.eliLevels.ekiPct * 100).toFixed(0)}% EKI)
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px]">
                <thead className="bg-[var(--surface-2)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  <tr>
                    <th className="px-2 py-2 text-left">Level</th>
                    <th className="px-2 py-2 text-right">Price</th>
                    <th className="px-2 py-2 text-right">vs Our IV</th>
                    <th className="px-2 py-2 text-right">vs Wayne's IV</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-[var(--line)]">
                    <td className="px-2 py-1.5 font-medium">Strike ({(c.eliLevels.strikePct * 100).toFixed(0)}%)</td>
                    <td className="px-2 py-1.5 tabular text-right">{fmtPrice(c.eliLevels.strikePrice, ccy)}</td>
                    <td className="px-2 py-1.5 tabular text-right">{renderGap(c.eliLevels.strikeVsOurIV, ccy)}</td>
                    <td className="px-2 py-1.5 tabular text-right">{renderGap(c.eliLevels.strikeVsWaynesIV, ccy)}</td>
                  </tr>
                  <tr className="border-t border-[var(--line)]">
                    <td className="px-2 py-1.5 font-medium">EKI barrier ({(c.eliLevels.ekiPct * 100).toFixed(0)}%)</td>
                    <td className="px-2 py-1.5 tabular text-right">{fmtPrice(c.eliLevels.ekiPrice, ccy)}</td>
                    <td className="px-2 py-1.5 tabular text-right">{renderGap(c.eliLevels.ekiVsOurIV, ccy)}</td>
                    <td className="px-2 py-1.5 tabular text-right">{renderGap(c.eliLevels.ekiVsWaynesIV, ccy)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-[10.5px] text-[var(--text-muted)]">
              Negative gap (<span className="text-success">green</span>) = level is <b>below</b> intrinsic → entering at a discount if knocked in · safer.
              Positive gap (<span className="text-danger">red</span>) = overpaying at that level.
            </div>
          </section>

          {/* Formula walkthrough */}
          <section className="mb-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              The math, step by step
            </h2>

            <FormulaBlock delay={60}
              label="① CAPM — Discount Rate"
              equation="r = Rf + β × ERP"
              substitution={`r = ${fmtPct(a.riskFree)} + ${(i.beta ?? 1).toFixed(2)} × ${fmtPct(a.equityPremium)}`}
              result={fmtPct(c.discountRate)}
            />

            <FormulaBlock delay={160}
              label="② Growth Rate (bounded 2%–20%)"
              equation="g = clamp(earningsGrowth or revenueGrowth)"
              substitution={`source: ${a.growthSource}`}
              result={fmtPct(c.growth)}
            />

            <FormulaBlock delay={260}
              label="③ Free Cash Flow Base"
              equation="FCF₀ = OpCashflow + CapEx"
              substitution={i.operatingCashFlow != null && i.capex != null
                ? `FCF₀ = ${fmtMoney(i.operatingCashFlow)} + (${fmtMoney(i.capex)})`
                : i.freeCashFlow != null ? "from financialData" : "unavailable"}
              result={i.freeCashFlow != null ? fmtMoney(i.freeCashFlow) : "n/a"}
            />

            <FormulaBlock delay={360}
              label="④ 5-Year Explicit DCF"
              equation="Σ FCFₜ × (1+g)ᵗ / (1+r)ᵗ   for t=1…5"
              substitution={c.projections.map((p) => `Yr${p.year}: ${fmtMoney(p.fcf)} → PV ${fmtMoney(p.pv)}`).join("  ·  ") || "—"}
              result={c.projections.length ? fmtMoney(c.projections.reduce((s, p) => s + p.pv, 0)) : "—"}
            />

            <FormulaBlock delay={460}
              label="⑤ Terminal Value (Gordon growth, g∞=3%)"
              equation="TV = FCF₅ × (1+g∞) / (r − g∞)"
              substitution={c.terminalValue != null
                ? `TV = ${fmtMoney((c.projections[4]?.fcf ?? 0))} × ${(1 + a.terminalGrowth).toFixed(2)} / (${(c.discountRate).toFixed(3)} − ${a.terminalGrowth})`
                : "—"}
              result={c.terminalPV != null ? `PV ${fmtMoney(c.terminalPV)}` : "—"}
            />

            <FormulaBlock delay={560}
              label="⑥ FCF Intrinsic (Gordon, supporting)"
              equation="(ΣPV + TV_PV − netDebt) / shares"
              substitution={c.enterpriseValue != null && i.sharesOut
                ? `EV ${fmtMoney(c.enterpriseValue)} − netDebt ${fmtMoney(c.netDebt)} ÷ ${fmtMoney(i.sharesOut)} shares`
                : "—"}
              result={c.fcfIntrinsicValue != null ? fmtPrice(c.fcfIntrinsicValue, ccy) : "—"}
            />
            <div className="mb-2 ml-2 text-[10px] italic text-[var(--text-muted)]">
              Friday's caveat: Gordon-based FCF undershoots high-growth names. PE is the primary anchor.
            </div>

            <FormulaBlock delay={660}
              label="⑦ Our Intrinsic Value (today)"
              equation="Our IV = Forward EPS × Market Forward PE"
              substitution={i.epsForward != null && c.ourPE != null
                ? `${fmtPrice(i.epsForward, "")} × ${c.ourPE.toFixed(1)}x`
                : "—"}
              result={c.ourIntrinsicValue != null ? fmtPrice(c.ourIntrinsicValue, ccy) : "—"}
            />

            <FormulaBlock delay={740}
              label="⑧ Wayne's PE Haircut"
              equation={`Wayne's PE = Market PE × ${a.waynePEHaircut}`}
              substitution={c.ourPE != null && c.waynesPE != null
                ? `${c.ourPE.toFixed(1)}x × ${a.waynePEHaircut} = ${c.waynesPE.toFixed(1)}x`
                : "—"}
              result={c.waynesPE != null ? `${c.waynesPE.toFixed(1)}x` : "—"}
            />

            <FormulaBlock delay={820}
              label="⑨ Wayne's Intrinsic Value (today)"
              equation="Wayne IV = Forward EPS × Wayne's PE"
              substitution={i.epsForward != null && c.waynesPE != null
                ? `${fmtPrice(i.epsForward, "")} × ${c.waynesPE.toFixed(1)}x`
                : "—"}
              result={c.waynesIntrinsicValue != null ? fmtPrice(c.waynesIntrinsicValue, ccy) : "—"}
              accent
            />

            <FormulaBlock delay={900}
              label="⑩ Next-Year EPS (growth-adjusted)"
              equation="FY+1 EPS = Forward EPS × (1 + g)"
              substitution={i.epsForward != null
                ? `${fmtPrice(i.epsForward, "")} × ${(1 + c.growth).toFixed(3)}`
                : "—"}
              result={c.nextYearEPS != null ? fmtPrice(c.nextYearEPS, "") : "—"}
            />

            <FormulaBlock delay={980}
              label="⑪ Future Value (12M, both models)"
              equation="FV = FY+1 EPS × PE"
              substitution={c.nextYearEPS != null && c.ourPE != null && c.waynesPE != null
                ? `Ours ${fmtPrice(c.ourFutureValue ?? 0, ccy)}  ·  Wayne ${fmtPrice(c.waynesFutureValue ?? 0, ccy)}`
                : "—"}
              result={c.waynesFutureValue != null ? fmtPrice(c.waynesFutureValue, ccy) : "—"}
            />
          </section>

          {/* Raw inputs table */}
          <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Inputs pulled from Yahoo
            </h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[11.5px] sm:grid-cols-3">
              <InputRow label="Beta" value={i.beta != null ? i.beta.toFixed(2) : "—"} />
              <InputRow label="Forward P/E" value={i.forwardPE != null ? i.forwardPE.toFixed(1) : "—"} />
              <InputRow label="Trailing P/E" value={i.trailingPE != null ? i.trailingPE.toFixed(1) : "—"} />
              <InputRow label="EPS Forward" value={i.epsForward != null ? fmtPrice(i.epsForward, "") : "—"} />
              <InputRow label="EPS Trailing" value={i.epsTrailing != null ? fmtPrice(i.epsTrailing, "") : "—"} />
              <InputRow label="FCF (TTM)" value={i.freeCashFlow != null ? fmtMoney(i.freeCashFlow) : "—"} />
              <InputRow label="Shares Out" value={i.sharesOut != null ? fmtMoney(i.sharesOut, "") : "—"} />
              <InputRow label="Total Debt" value={i.totalDebt != null ? fmtMoney(i.totalDebt) : "—"} />
              <InputRow label="Total Cash" value={i.totalCash != null ? fmtMoney(i.totalCash) : "—"} />
              <InputRow label="Earnings growth" value={i.earningsGrowth != null ? fmtPct(i.earningsGrowth) : "—"} />
              <InputRow label="Revenue growth" value={i.revenueGrowth != null ? fmtPct(i.revenueGrowth) : "—"} />
              <InputRow label="D / Equity" value={c.debtToEquity != null ? `${(c.debtToEquity * 100).toFixed(0)}%` : "—"} />
              <InputRow label="D / FCF" value={c.debtToFCF != null ? `${c.debtToFCF.toFixed(2)}x` : "—"} />
            </div>
          </section>
        </>
      )}

      {!result && !analyzing && !error && (
        <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface)]/40 p-6 text-center text-[12.5px] text-[var(--text-muted)]">
          Enter a ticker above. Try <span className="font-mono font-semibold text-[var(--text)]">MRVL</span> — Marvell Tech, Wayne's recent 220-230 target.
        </div>
      )}
    </div>
  );
}

function ValueCard({ label, sublabel, value, ccy, hint, accent }: {
  label: string; sublabel: string; value: number | null; ccy: string; hint: number | null; accent?: boolean;
}) {
  const hintUp = hint != null && hint > 0;
  return (
    <div className={`rounded-xl border p-3 ${accent ? "border-indigo-500/50 bg-gradient-to-br from-indigo-500/10 to-purple-500/5" : "border-[var(--line)] bg-[var(--surface-2)]/50"}`}>
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</div>
      <div className="text-[9px] text-[var(--text-muted)]">{sublabel}</div>
      <div className={`mt-1.5 text-[22px] font-bold tabular ${accent ? "text-indigo-400" : ""}`}>
        {value != null ? <AnimatedNumber value={value} format={(n) => fmtPrice(n, ccy)} /> : "—"}
      </div>
      {hint != null && (
        <div className={`mt-0.5 flex items-center gap-1 text-[10.5px] font-semibold ${hintUp ? "text-success" : "text-danger"}`}>
          {hintUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {hint > 0 ? "+" : ""}{(hint * 100).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

function renderGap(gap: number | null, ccy: string) {
  if (gap == null) return <span className="text-[var(--text-muted)]">—</span>;
  const safe = gap <= 0; // negative = level below IV = GOOD (entering at discount)
  return (
    <span className={safe ? "text-success font-semibold" : "text-danger font-semibold"}>
      {gap > 0 ? "+" : ""}{fmtPrice(gap, ccy)}
    </span>
  );
}

function DebtGate({ banned, reasons, debtToFCF, debtToEquity, debtToEquitySource, cashRich, netDebt, fcf, equity, fcfBan, equityBan }: {
  banned: boolean; reasons: string[];
  debtToFCF: number | null; debtToEquity: number | null;
  debtToEquitySource: "yahoo-normalized" | "raw-computed" | "unavailable";
  cashRich: boolean;
  netDebt: number; fcf: number | null; equity: number | null;
  fcfBan: number; equityBan: number;
}) {
  const fcfRatioFinite = debtToFCF != null && Number.isFinite(debtToFCF);
  const fcfOK = cashRich || (fcfRatioFinite && (debtToFCF as number) <= fcfBan);
  const eqOK = debtToEquity == null || debtToEquity <= equityBan;
  const fcfDisplay = cashRich
    ? "n/a"
    : debtToFCF == null
    ? "—"
    : !Number.isFinite(debtToFCF)
    ? "∞ (FCF ≤ 0)"
    : `${(debtToFCF as number).toFixed(2)}x`;
  const sourceLabel =
    debtToEquitySource === "yahoo-normalized" ? "Yahoo normalized" :
    debtToEquitySource === "raw-computed" ? "computed from balance sheet" : "unavailable";
  return (
    <section className={`mb-4 rounded-2xl border p-4 slide-up ${banned ? "border-amber-500/40 bg-amber-500/10" : "border-emerald-500/30 bg-emerald-500/5"}`}>
      <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className={banned ? "text-amber-400" : "text-emerald-400"} />
          <h2 className={`text-[11px] font-bold uppercase tracking-wider ${banned ? "text-amber-400" : "text-emerald-400"}`}>
            Debt Gate — {banned ? "BANNED" : cashRich ? "PASS (net cash)" : "PASS"}
          </h2>
        </div>
        <span className="text-[9.5px] text-[var(--text-muted)]">D/E source: {sourceLabel}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11.5px] sm:grid-cols-4">
        <div>
          <div className="text-[9.5px] uppercase text-[var(--text-muted)]">Net Debt</div>
          <div className={`tabular font-semibold ${cashRich ? "text-emerald-400" : ""}`}>
            {cashRich ? `+${fmtMoney(-netDebt)} cash` : fmtMoney(netDebt)}
          </div>
        </div>
        <div><div className="text-[9.5px] uppercase text-[var(--text-muted)]">Annual FCF</div><div className={`tabular font-semibold ${fcf != null && fcf < 0 ? "text-amber-400" : ""}`}>{fcf != null ? fmtMoney(fcf) : "—"}</div></div>
        <div>
          <div className="text-[9.5px] uppercase text-[var(--text-muted)]">Debt / FCF</div>
          <div className={`tabular font-bold ${fcfOK ? "text-emerald-400" : "text-amber-400"}`}>
            {fcfDisplay}
            <span className="ml-1 text-[9px] font-normal text-[var(--text-muted)]">limit {fcfBan}x</span>
          </div>
        </div>
        <div>
          <div className="text-[9.5px] uppercase text-[var(--text-muted)]">Debt / Equity</div>
          <div className={`tabular font-bold ${eqOK ? "text-emerald-400" : "text-amber-400"}`}>
            {debtToEquity != null ? `${(debtToEquity * 100).toFixed(0)}%` : "—"}
            <span className="ml-1 text-[9px] font-normal text-[var(--text-muted)]">limit {equityBan * 100}%</span>
          </div>
        </div>
      </div>
      {banned && reasons.length > 0 && (
        <div className="mt-2 border-t border-amber-500/20 pt-2 text-[11px] text-amber-200">
          <b>Wayne skips this one.</b>{" "}
          {reasons.join(" · ")}. Over-leveraged names drag through long drawdowns.
        </div>
      )}
    </section>
  );
}

function VerdictBanner({ verdict, upsidePct, banned }: {
  verdict: Analysis["computed"]["verdict"]; upsidePct: number | null; banned: boolean;
}) {
  if (banned) return null; // Debt Gate above already carries the SKIP message
  const colors = {
    LAUNCH: { bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-400", label: "LAUNCH READY" },
    WATCH:  { bg: "bg-sky-500/10",     border: "border-sky-500/40",     text: "text-sky-400",     label: "ON THE WATCHLIST" },
    AVOID:  { bg: "bg-red-500/10",     border: "border-red-500/40",     text: "text-red-400",     label: "RICHLY PRICED" },
    SKIP:   { bg: "bg-amber-500/10",   border: "border-amber-500/40",   text: "text-amber-400",   label: "SKIP" },
  }[verdict];
  return (
    <div className={`mb-4 flex items-center justify-between gap-3 rounded-2xl border p-4 slide-up ${colors.bg} ${colors.border}`}>
      <div>
        <div className={`text-[11px] font-bold uppercase tracking-[0.14em] ${colors.text}`}>Wayne's verdict</div>
        <div className={`mt-0.5 text-[18px] font-bold ${colors.text}`}>{colors.label}</div>
      </div>
      {upsidePct != null && (
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Upside to target</div>
          <div className={`text-[20px] font-bold tabular ${colors.text}`}>
            {upsidePct > 0 ? "+" : ""}{upsidePct.toFixed(1)}%
          </div>
        </div>
      )}
    </div>
  );
}

function FormulaBlock({ label, equation, substitution, result, delay, accent }: {
  label: string; equation: string; substitution: string; result: string; delay: number; accent?: boolean;
}) {
  return (
    <div className="formula-pop mb-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/60 p-3" style={{ animationDelay: `${delay}ms` }}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className="font-mono text-[12.5px] font-semibold">{equation}</div>
      <div className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]">{substitution}</div>
      <div className={`mt-1.5 font-mono text-[13.5px] font-bold ${accent ? "text-indigo-400" : "text-[var(--text)]"}`}>
        = {result}
      </div>
    </div>
  );
}

function InputRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-[var(--line)] py-1">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="tabular font-semibold">{value}</span>
    </div>
  );
}
