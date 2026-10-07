"use client";

// Wayne tab — the DCF-based intrinsic-value model named after the treasury
// specialist whose launches knock out early. User types a ticker, hits
// "See what Wayne's thinking", watches a theatrical calculation reveal,
// gets a 12-month target price. Powered by /api/wayne/analyze.

import { useEffect, useRef, useState } from "react";
import { Brain, Loader2, Search, TrendingUp, TrendingDown, ShieldAlert, AlertTriangle, CheckCircle2, ClipboardPaste, XCircle, ThumbsUp, ThumbsDown } from "lucide-react";
import type { MarketCode, Tranche } from "@/lib/types";
import { parseTrancheText } from "@/lib/parser";

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
    ourEvSalesFV: number | null;
    waynesEvSalesFV: number | null;
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

interface TranchePerUnderlying {
  symbol: string; market: string; longName: string | null;
  analysis: Analysis | null; error: string | null;
}
interface TrancheAnalysis {
  tranche: Tranche;
  perUnderlying: TranchePerUnderlying[];
  verdict: {
    overall: "GO" | "NO" | "CONDITIONAL";
    passes: string[];
    fails: string[];
    notes: string[];
  };
}

export default function WaynePage() {
  const [symbol, setSymbol] = useState("");
  const [market, setMarket] = useState<MarketCode>("US");
  const [analyzing, setAnalyzing] = useState(false);
  const [stepIdx, setStepIdx] = useState(-1);
  const [result, setResult] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ─── Learning layer: trending underlyings aggregated across all parses ─
  interface PopularStock {
    symbol: string; market: string;
    parse_count: number; unique_visitors: number;
    last_parsed_at: string; raw_name_variants?: string[] | null;
  }
  const [popular, setPopular] = useState<PopularStock[] | null>(null);
  useEffect(() => {
    fetch("/api/learn/popular?limit=12", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : { popular: [] })
      .then((j) => setPopular(Array.isArray(j.popular) ? j.popular : []))
      .catch(() => setPopular([]));
  }, []);

  // ─── Tranche parser state ─────────────────────────────────────────────
  const [trancheEditOpen, setTrancheEditOpen] = useState(false);
  const [trancheText, setTrancheText] = useState("");
  const [trancheAnalyzing, setTrancheAnalyzing] = useState(false);
  const [trancheSteps, setTrancheSteps] = useState<string[]>([]);
  const [trancheStepIdx, setTrancheStepIdx] = useState(-1);
  const [trancheResult, setTrancheResult] = useState<TrancheAnalysis | null>(null);
  const [trancheError, setTrancheError] = useState<string | null>(null);
  const [trancheFlash, setTrancheFlash] = useState<"none" | "empty" | "denied">("none");
  const trancheResultRef = useRef<HTMLDivElement | null>(null);
  const trancheAnimRef = useRef<HTMLDivElement | null>(null);

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

  // One-click clipboard-paste → auto-parse → full animated analysis.
  // Mirrors the Desk tab's ProductParser UX (single tap, no second click).
  async function trancheFromClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      if (!t.trim()) {
        setTrancheFlash("empty");
        setTimeout(() => setTrancheFlash("none"), 2500);
        return;
      }
      setTrancheText(t);
      await analyzeTranche(t);
    } catch {
      setTrancheFlash("denied");
      setTimeout(() => setTrancheFlash("none"), 3500);
    }
  }

  // ─── Tranche-level analysis with full theatrical animation ─────────────
  async function analyzeTranche(overrideText?: string) {
    const text = (overrideText ?? trancheText).trim();
    if (!text) return;
    setTrancheError(null);
    setTrancheResult(null);
    setTrancheAnalyzing(true);
    setTrancheEditOpen(false); // close editor if open
    setTrancheStepIdx(-1);

    try {
      const parsed = parseTrancheText(text);
      if (!parsed?.tranche?.underlyings?.length) {
        throw new Error("No underlyings detected in that message. Make sure it includes the stock names.");
      }
      const tranche = parsed.tranche;

      // Fire-and-forget: feed this parse into the learning layer so other
      // users benefit from trending-underlyings data.
      fetch("/api/learn/tranche", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ tranche, rawText: text, source: "wayne" }),
      }).catch(() => {});

      // Build dynamic animated steps that call out each underlying by name
      const dynamicSteps: string[] = [
        `Parsing tranche structure…`,
        `Resolved ${tranche.underlyings.length} underlying${tranche.underlyings.length === 1 ? "" : "s"}: ${tranche.underlyings.map((u) => u.symbol).join(", ")}`,
      ];
      for (const u of tranche.underlyings) {
        dynamicSteps.push(
          `Pulling live market data for ${u.symbol}…`,
          `Running Debt Gate on ${u.symbol} (D/FCF, D/E)…`,
          `CAPM: r = Rf + β·ERP for ${u.symbol}…`,
          `Forward EPS × Market PE → Our IV for ${u.symbol}…`,
          `Forward EPS × 0.85·PE → Wayne's IV for ${u.symbol}…`,
          `Projecting FY+1 EPS × PE → 12M Future Value for ${u.symbol}…`,
        );
      }
      dynamicSteps.push(
        `Checking EKI depth against each underlying's intrinsic value…`,
        `Scoring stepdown feature (${(tranche.koStepdownPct * 100).toFixed(1)}% per period)…`,
        `Coupon vs risk-free: ${(tranche.couponPa * 100).toFixed(1)}% − 3.5% = +${((tranche.couponPa - 0.035) * 100).toFixed(1)}%`,
        `Finalizing Wayne's verdict…`,
      );
      setTrancheSteps(dynamicSteps);

      // Scroll the animation into view
      setTimeout(() => trancheAnimRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);

      // Kick off data fetching + minimum animation window IN PARALLEL.
      // Any underlying marked `resolved: false` by the parser (e.g. the user
      // pasted "Marvell Technologies" instead of "MRVL") gets upgraded via
      // /api/symbol-search FIRST so Wayne never hits Yahoo's generic search
      // and ends up with a random biotech match.
      const minAnimation = new Promise<void>((res) => setTimeout(res, dynamicSteps.length * 420));
      const dataFetch = Promise.all(
        tranche.underlyings.map(async (u) => {
          let effectiveSymbol = u.symbol;
          let effectiveMarket = u.market;
          if (u.resolved === false) {
            try {
              const sr = await fetch(`/api/symbol-search?q=${encodeURIComponent(u.rawName)}&market=${u.market}`, { cache: "no-store" });
              if (sr.ok) {
                const sj = await sr.json();
                if (sj?.symbol) {
                  effectiveSymbol = sj.symbol;
                  if (sj.market) effectiveMarket = sj.market;
                }
              }
            } catch { /* keep raw symbol */ }
          }
          try {
            const r = await fetch(`/api/wayne/analyze?symbol=${encodeURIComponent(effectiveSymbol)}&market=${effectiveMarket}`, { cache: "no-store" });
            if (!r.ok) {
              const j = await r.json().catch(() => ({}));
              return { symbol: effectiveSymbol, market: effectiveMarket, longName: u.rawName, analysis: null, error: j.error || `HTTP ${r.status}` };
            }
            const a = (await r.json()) as Analysis;
            return { symbol: effectiveSymbol, market: effectiveMarket, longName: a.longName ?? u.rawName, analysis: a, error: null };
          } catch (e: any) {
            return { symbol: effectiveSymbol, market: effectiveMarket, longName: u.rawName, analysis: null, error: String(e?.message || e) };
          }
        })
      );
      const [perResults] = await Promise.all([dataFetch, minAnimation]);

      // ── Decide the tranche verdict ──────────────────────────────────────
      const passes: string[] = [];
      const fails: string[] = [];
      const notes: string[] = [];

      const haveAll = perResults.every((r) => r.analysis != null);
      if (!haveAll) {
        const missing = perResults.filter((r) => !r.analysis).map((r) => r.symbol).join(", ");
        notes.push(`Could not fetch data for: ${missing}. Verdict uses available names only.`);
      }

      // 1) Debt Gate — ANY banned underlying is a hard NO
      const anyBanned = perResults.some((r) => r.analysis?.computed.banned);
      const bannedNames = perResults.filter((r) => r.analysis?.computed.banned).map((r) => `${r.symbol} (${r.analysis!.computed.banReasons[0] ?? "high debt"})`);
      if (anyBanned) {
        fails.push(`Debt gate failed: ${bannedNames.join(" · ")}`);
      } else {
        passes.push("Debt gate: all underlyings healthy balance sheet");
      }

      // 2) Easy KO — Wayne's FV above current means stock likely clears KO
      const easyKO = perResults.filter((r) => r.analysis?.computed.waynesTarget != null && r.analysis.computed.waynesTarget > r.analysis.price);
      if (easyKO.length === perResults.length) {
        passes.push(`Easy KO: Wayne's 12M target above current for all ${perResults.length} underlyings`);
      } else if (easyKO.length === 0) {
        fails.push("Hard KO: Wayne's 12M target BELOW current for every underlying — unlikely to autocall");
      } else {
        notes.push(`Mixed KO outlook: ${easyKO.length}/${perResults.length} underlyings have upside to Wayne's 12M target`);
      }

      // 3) Stepdown feature — makes KO progressively easier over the tenor
      const hasStepdown = tranche.koStepdownPct > 0;
      if (hasStepdown) {
        passes.push(`Stepdown ${(tranche.koStepdownPct * 100).toFixed(1)}%/period — KO threshold drops each observation, easing autocall`);
      } else {
        notes.push(`No stepdown — KO stays flat at ${(tranche.koStartPct * 100).toFixed(0)}% of initial for the full tenor`);
      }

      // 4) EKI safety — KI barrier must be well below Wayne's IV so you're
      // not stuck with overvalued shares if you do get knocked in
      const unsafeKI = perResults.filter((r) => {
        const a = r.analysis; if (!a) return false;
        const ekiPrice = a.price * tranche.ekiPct;
        const ivAnchor = a.computed.waynesIntrinsicValue ?? a.computed.waynesEvSalesIV ?? a.computed.waynesFutureValue ?? null;
        return ivAnchor != null && ekiPrice > ivAnchor; // EKI above IV = overpaying if knocked in
      });
      if (unsafeKI.length === 0) {
        passes.push(`EKI safe: ${(tranche.ekiPct * 100).toFixed(0)}% barrier sits below Wayne's intrinsic value for all underlyings`);
      } else {
        fails.push(`EKI unsafe for ${unsafeKI.map((r) => r.symbol).join(", ")}: barrier price is ABOVE Wayne's intrinsic — assignment means overpaying`);
      }

      // 5) Coupon premium vs risk-free (3.5% SGD-ish)
      const RF = 0.035;
      const excess = tranche.couponPa - RF;
      if (excess >= 0.045) {
        passes.push(`Coupon premium: ${(tranche.couponPa * 100).toFixed(1)}% p.a. · +${(excess * 100).toFixed(1)}% over risk-free (adequate compensation for equity risk)`);
      } else {
        notes.push(`Coupon premium slim: ${(tranche.couponPa * 100).toFixed(1)}% p.a. is only +${(excess * 100).toFixed(1)}% over risk-free`);
      }

      // 6) Growth / earnings health — flag any sub-5% revenue grower
      const slowGrowers = perResults.filter((r) => {
        const g = r.analysis?.inputs.earningsGrowth ?? r.analysis?.inputs.revenueGrowth;
        return g != null && g < 0.05;
      });
      if (slowGrowers.length) {
        notes.push(`Slow growth watch: ${slowGrowers.map((r) => r.symbol).join(", ")} < 5% YoY — may struggle to clear KO`);
      } else {
        passes.push("Growth: all underlyings have healthy earnings/revenue momentum");
      }

      // Final decision
      let overall: "GO" | "NO" | "CONDITIONAL";
      if (fails.length === 0 && passes.length >= 4) overall = "GO";
      else if (fails.length >= 2 || anyBanned) overall = "NO";
      else overall = "CONDITIONAL";

      setTrancheResult({
        tranche,
        perUnderlying: perResults,
        verdict: { overall, passes, fails, notes },
      });
      // Auto-scroll to the verdict
      setTimeout(() => {
        trancheResultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (e: any) {
      setTrancheError(String(e?.message || e));
    } finally {
      setTrancheAnalyzing(false);
      setTrancheStepIdx(-1);
    }
  }

  // Step animator for tranche flow — matches the single-stock pacing
  useEffect(() => {
    if (!trancheAnalyzing || trancheSteps.length === 0) return;
    setTrancheStepIdx(0);
    let i = 0;
    const id = window.setInterval(() => {
      i++;
      if (i >= trancheSteps.length) { window.clearInterval(id); return; }
      setTrancheStepIdx(i);
    }, 400);
    return () => window.clearInterval(id);
  }, [trancheAnalyzing, trancheSteps]);

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
        @keyframes formula-float {
          0%   { opacity: 0; transform: translateY(10px) scale(.9); }
          15%  { opacity: 1; transform: translateY(0) scale(1); }
          85%  { opacity: 1; transform: translateY(-4px) scale(1); }
          100% { opacity: 0; transform: translateY(-18px) scale(.95); }
        }
        @keyframes digit-tick {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-2px); }
        }
        .brain-glow { animation: brain-glow 2.4s ease-in-out infinite; }
        .slide-up { animation: slide-up .5s ease-out both; }
        .formula-pop { animation: formula-pop .55s ease-out both; }
        .line-grow { transform-origin: left; animation: line-grow .6s ease-out both; }
        .formula-float {
          animation: formula-float 2.5s ease-in-out infinite;
          text-shadow: 0 0 8px rgba(99,102,241,.6);
        }
        .wayne-grid { background-image:
          linear-gradient(var(--line) 1px, transparent 1px),
          linear-gradient(90deg, var(--line) 1px, transparent 1px);
          background-size: 40px 40px; opacity: .12;
          animation: grid-pan 8s linear infinite;
        }
      `}</style>

      {/* HERO — minimal: just "Ask Wayne" title + ONE centred button */}
      <section className="relative mb-5 overflow-hidden rounded-2xl border border-[var(--line)] bg-gradient-to-br from-indigo-600/10 via-purple-600/5 to-sky-500/10 p-5 sm:p-7">
        <div className="pointer-events-none absolute inset-0 wayne-grid" />
        <div className="relative flex flex-col items-center text-center">
          <div className="mb-5 flex items-center gap-2">
            <Brain size={28} className="brain-glow text-indigo-400" />
            <h1 className="text-[24px] font-bold tracking-tight">Ask Wayne</h1>
          </div>

          {/* ONE-CLICK tranche paste button — centred, prominent, auto-detects
              every market and ticker from the pasted text */}
          <div className="flex w-full max-w-md flex-col items-center gap-2">
            <button
              onClick={trancheFromClipboard}
              disabled={trancheAnalyzing}
              className="group flex w-full items-center justify-center gap-2.5 rounded-xl border border-indigo-500/50 bg-gradient-to-r from-indigo-600/25 via-purple-600/20 to-sky-500/25 px-5 py-3 text-[13.5px] font-semibold text-indigo-100 shadow-lg shadow-indigo-500/25 transition hover:border-indigo-400/70 hover:from-indigo-600/35 hover:to-sky-500/35 disabled:opacity-50"
              title="Reads the tranche from your clipboard and runs Wayne's DCF on every underlying — auto-detects US / HK / SG / MY / JP / AU."
            >
              {trancheAnalyzing ? (
                <Loader2 size={17} className="animate-spin" />
              ) : (
                <ClipboardPaste size={17} className="transition group-hover:scale-110" />
              )}
              Parse your tranche here — see what Wayne's thinking
            </button>
            <button
              onClick={() => setTrancheEditOpen((v) => !v)}
              className="text-[10.5px] font-semibold text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline"
              title="Open manual editor as a fallback if clipboard access is blocked."
            >
              Edit manually
            </button>
          </div>

          {/* Status chip for clipboard flash */}
          {trancheFlash !== "none" && (
            <div className={`mt-2 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] ${
              trancheFlash === "empty" ? "bg-warning/10 text-warning" : "bg-danger/10 text-danger"
            }`}>
              <AlertTriangle size={12} />
              {trancheFlash === "empty"
                ? "Clipboard is empty — copy your tranche message first."
                : "Clipboard permission denied — tap Edit to paste manually."}
            </div>
          )}

          {/* Fallback manual editor (ONLY shown when user explicitly opens it) */}
          {trancheEditOpen && (
            <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 slide-up">
              <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Paste manually (fallback when clipboard is blocked)
              </label>
              <textarea
                value={trancheText}
                onChange={(e) => setTrancheText(e.target.value)}
                placeholder={"e.g.\nMSI\nTrade: 6 Oct 2026\nTranche Code: MSIT26J072\nSGD\nMarvell US\nWestern Digital US\nStrike 90%\nKO 100%, stepdown 3%\nCoupon 10%\nTenor 12M\nEKI 50%"}
                rows={10}
                className="w-full rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono text-[11.5px] outline-none focus:border-indigo-500/50"
              />
              <div className="mt-2 flex justify-end">
                <button
                  onClick={() => analyzeTranche()}
                  disabled={trancheAnalyzing || !trancheText.trim()}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-[11.5px] font-semibold text-white shadow-md shadow-indigo-500/30 hover:bg-indigo-500 disabled:opacity-50"
                >
                  {trancheAnalyzing ? <Loader2 size={13} className="animate-spin" /> : <Brain size={13} />}
                  Run Wayne's model
                </button>
              </div>
              {trancheError && (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11.5px] text-red-400">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>{trancheError}</span>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </section>

      {/* ─── TRANCHE ANIMATION (while computing) ─────────────────────── */}
      {trancheAnalyzing && trancheSteps.length > 0 && (
        <section ref={trancheAnimRef} className="mb-5 slide-up rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <Loader2 size={13} className="animate-spin text-indigo-400" />
            Running Wayne's tranche model
          </div>

          {/* Live mathematical formulas floating + progress indicator */}
          <div className="relative mb-3 h-20 overflow-hidden rounded-lg border border-indigo-500/20 bg-gradient-to-br from-indigo-500/5 via-purple-500/5 to-transparent">
            <div className="pointer-events-none absolute inset-0 wayne-grid" />
            <div className="relative flex h-full items-center justify-around px-4 font-mono text-[11px] text-indigo-300">
              <FormulaFloat text="r = Rf + β·ERP" delay="0s" />
              <FormulaFloat text="FV = EPS₁ × PE" delay="0.5s" />
              <FormulaFloat text="IV = Σ FCFₜ / (1+r)ᵗ" delay="1s" />
              <FormulaFloat text="D/FCF ≤ 3x ?" delay="1.5s" />
              <FormulaFloat text="EKI < IV ?" delay="2s" />
            </div>
          </div>

          {/* Step list with pulsing dot on active step */}
          <ol className="space-y-1.5 font-mono text-[11.5px]">
            {trancheSteps.map((s, k) => (
              <li
                key={k}
                className={`flex items-center gap-2 transition-opacity ${k <= trancheStepIdx ? "text-[var(--text)]" : "text-[var(--text-muted)] opacity-40"}`}
              >
                <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${k < trancheStepIdx ? "bg-success" : k === trancheStepIdx ? "bg-indigo-400 brain-glow" : "bg-[var(--line)]"}`} />
                <span className="truncate">{s}</span>
                {k < trancheStepIdx && <CheckCircle2 size={11} className="ml-auto shrink-0 text-success" />}
              </li>
            ))}
          </ol>

          {/* Progress bar */}
          <div className="mt-3 overflow-hidden rounded bg-[var(--surface-2)]">
            <div
              className="h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-sky-500"
              style={{ width: `${Math.max(0, (trancheStepIdx + 1) / trancheSteps.length) * 100}%`, transition: "width 400ms ease-out" }}
            />
          </div>
        </section>
      )}

      {/* ─── TRANCHE VERDICT ─────────────────────────────────────────── */}
      {trancheResult && !trancheAnalyzing && (
        <div ref={trancheResultRef}>
          <TrancheVerdict data={trancheResult} ccy="$" />
        </div>
      )}

      {!trancheResult && !trancheAnalyzing && !trancheError && (
        <>
          <div className="mb-4 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface)]/40 p-6 text-center text-[12.5px] text-[var(--text-muted)]">
            Copy your tranche message (same format as the Desk tab) and tap the button above.
            Wayne auto-detects every underlying, every market, and runs the full DCF.
          </div>

          {/* Trending underlyings — learned from every parse across all users */}
          {popular && popular.length > 0 && (
            <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    📈 Trending across all tranches
                  </div>
                  <h2 className="text-[14px] font-bold">Most-parsed underlyings</h2>
                </div>
                <span className="text-[10px] text-[var(--text-muted)]">
                  Learning layer · updates every parse
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {popular.slice(0, 12).map((p) => {
                  const label = p.raw_name_variants?.[0] || p.symbol;
                  return (
                    <div
                      key={`${p.symbol}:${p.market}`}
                      className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/60 p-2.5"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-mono text-[12px] font-bold">{p.symbol}</span>
                        <span className="text-[9.5px] text-[var(--text-muted)]">{p.market}</span>
                      </div>
                      <div className="truncate text-[10px] text-[var(--text-muted)]">{label}</div>
                      <div className="mt-1 flex items-center gap-2 text-[10px]">
                        <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 font-semibold text-indigo-300">
                          {p.parse_count}× parsed
                        </span>
                        <span className="text-[var(--text-muted)]">{p.unique_visitors} user{p.unique_visitors === 1 ? "" : "s"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
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

function TrancheVerdict({ data, ccy }: { data: TrancheAnalysis; ccy: string }) {
  const { tranche, perUnderlying, verdict } = data;
  const banner =
    verdict.overall === "GO"
      ? { bg: "from-emerald-500/20 to-emerald-500/5", border: "border-emerald-500/50", text: "text-emerald-400", icon: ThumbsUp, headline: "Wayne says GO.", sub: "This tranche clears all of Wayne's gates — launch it." }
      : verdict.overall === "NO"
      ? { bg: "from-red-500/20 to-red-500/5", border: "border-red-500/50", text: "text-red-400", icon: ThumbsDown, headline: "Wayne says NO.", sub: "At least one hard gate failed — don't take this tranche." }
      : { bg: "from-amber-500/20 to-amber-500/5", border: "border-amber-500/40", text: "text-amber-400", icon: AlertTriangle, headline: "Wayne says IT DEPENDS.", sub: "Mixed signals — review the gate detail below before deciding." };
  const Icon = banner.icon;

  return (
    <section className="mb-8 mt-6 slide-up">
      {/* Big verdict banner */}
      <div className={`rounded-2xl border ${banner.border} bg-gradient-to-br ${banner.bg} p-5`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <Icon size={28} className={`mt-0.5 ${banner.text}`} />
            <div>
              <div className={`text-[20px] font-bold ${banner.text}`}>{banner.headline}</div>
              <div className="mt-0.5 text-[12px] text-[var(--text-muted)]">{banner.sub}</div>
            </div>
          </div>
          <div className="text-right text-[10.5px]">
            <div className="uppercase tracking-wider text-[var(--text-muted)]">Tranche</div>
            <div className="font-mono text-[11.5px] font-semibold">{tranche.trancheCode || "—"}</div>
            <div className="mt-1 text-[var(--text-muted)]">
              {tranche.currency} · {(tranche.couponPa * 100).toFixed(2)}% p.a. · {tranche.tenorMonths}M · Strike {(tranche.strikePct * 100).toFixed(0)}% · KO {(tranche.koStartPct * 100).toFixed(0)}% ↓{(tranche.koStepdownPct * 100).toFixed(1)}% · EKI {(tranche.ekiPct * 100).toFixed(0)}%
            </div>
          </div>
        </div>
      </div>

      {/* Gate detail — only render columns that have at least one entry */}
      {(() => {
        const visible: Array<{ title: string; items: string[]; color: "emerald" | "red" | "muted"; icon: any }> = [];
        if (verdict.passes.length) visible.push({ title: "PASSES", items: verdict.passes, color: "emerald", icon: CheckCircle2 });
        if (verdict.fails.length)   visible.push({ title: "FAILS",  items: verdict.fails,  color: "red",     icon: XCircle });
        if (verdict.notes.length)   visible.push({ title: "NOTES",  items: verdict.notes,  color: "muted",   icon: AlertTriangle });
        if (visible.length === 0) return null;
        const cols = visible.length === 1 ? "sm:grid-cols-1" : visible.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3";
        return (
          <section className={`mt-4 grid grid-cols-1 gap-3 ${cols}`}>
            {visible.map((g) => (
              <GateList key={g.title} title={g.title} items={g.items} color={g.color} icon={g.icon} />
            ))}
          </section>
        );
      })()}

      {/* Full per-underlying analysis — one detailed card per stock */}
      <section className="mt-4 space-y-4">
        {perUnderlying.map((u) => {
          if (!u.analysis) return (
            <div key={u.symbol} className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 text-[11.5px] text-red-400">
              <b>{u.symbol}</b>: {u.error || "no data"}
            </div>
          );
          const a = u.analysis;
          const c = a.computed;
          const i = a.inputs;
          const stockCcy = a.currency === "USD" ? "$" : a.currency === "HKD" ? "HK$" : "$";
          return (
            <div key={u.symbol} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
              {/* Header: ticker, name, current price */}
              <div className="mb-3 flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2">
                <div>
                  <div className="text-[10.5px] uppercase tracking-wider text-[var(--text-muted)]">{a.ySymbol} · {a.market}</div>
                  <div className="text-[14px] font-bold">{a.longName || u.symbol}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Current</div>
                  <div className="text-[18px] font-bold tabular">{fmtPrice(a.price, stockCcy)}</div>
                </div>
              </div>

              {/* Debt Gate strip */}
              <div className={`mb-3 rounded-lg border px-3 py-2 text-[11.5px] ${c.banned ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"}`}>
                <b>{c.banned ? "❌ Debt Gate BANNED" : "✅ Debt Gate PASS"}</b>
                {" · "}D/FCF: {Number.isFinite(c.debtToFCF ?? NaN) ? `${(c.debtToFCF as number).toFixed(2)}x` : (c.cashRich ? "n/a (net cash)" : "∞")}
                {" · "}D/E: {c.debtToEquity != null ? `${(c.debtToEquity * 100).toFixed(0)}%` : "—"}
                {c.banReasons.length > 0 && (
                  <div className="mt-1 text-[10.5px]">{c.banReasons.join(" · ")}</div>
                )}
              </div>

              {/* 2x2 valuation grid */}
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MiniValue label="Our IV" value={c.evSalesUsed ? c.ourEvSalesIV : c.ourIntrinsicValue} price={a.price} ccy={stockCcy} />
                <MiniValue label="Wayne's IV" value={c.evSalesUsed ? c.waynesEvSalesIV : c.waynesIntrinsicValue} price={a.price} ccy={stockCcy} accent />
                <MiniValue label="Our FV 12M" value={c.ourFutureValue ?? c.ourEvSalesFV} price={a.price} ccy={stockCcy} />
                <MiniValue label="Wayne's FV 12M" value={c.waynesFutureValue ?? c.waynesEvSalesFV ?? c.waynesTarget} price={a.price} ccy={stockCcy} accent />
              </div>

              {/* Key inputs row */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
                <KV label="Beta" value={i.beta != null ? i.beta.toFixed(2) : "—"} />
                <KV label="Forward PE" value={i.forwardPE != null ? `${i.forwardPE.toFixed(1)}x` : "—"} />
                <KV label="Wayne PE" value={c.waynesPE != null ? `${c.waynesPE.toFixed(1)}x` : (c.evSalesUsed ? `${c.evSalesWayneMultiple.toFixed(1)}x EV/S` : "—")} />
                <KV label="Fwd EPS" value={i.epsForward != null ? fmtPrice(i.epsForward, "") : "—"} />
                <KV label="FCF (TTM)" value={i.freeCashFlow != null ? fmtMoney(i.freeCashFlow) : "—"} />
                <KV label="Net Debt" value={fmtMoney(c.netDebt)} />
                <KV label="Growth" value={`${(c.growth * 100).toFixed(1)}%`} />
                <KV label="Discount r" value={`${(c.discountRate * 100).toFixed(1)}%`} />
              </div>

              {/* ELI level comparison for THIS underlying */}
              <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/40 p-2 text-[11px]">
                <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Tranche level checks
                </div>
                {(() => {
                  const strike = a.price * tranche.strikePct;
                  const eki = a.price * tranche.ekiPct;
                  const wIV = c.waynesIntrinsicValue ?? c.waynesEvSalesIV;
                  const wFV = c.waynesTarget;
                  const koLikely = wFV != null && wFV > a.price;
                  const ekiSafe = wIV != null && eki < wIV;
                  return (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                      <div>Strike ({(tranche.strikePct * 100).toFixed(0)}%): <b>{fmtPrice(strike, stockCcy)}</b></div>
                      <div>EKI ({(tranche.ekiPct * 100).toFixed(0)}%): <b>{fmtPrice(eki, stockCcy)}</b></div>
                      <div>KO likely? <b className={koLikely ? "text-emerald-400" : "text-amber-400"}>{koLikely ? "✅ YES (Wayne FV > current)" : "⚠️ not from current levels"}</b></div>
                      <div>EKI safe? <b className={ekiSafe ? "text-emerald-400" : "text-amber-400"}>{ekiSafe ? "✅ YES (barrier below Wayne IV)" : "⚠️ barrier above Wayne IV"}</b></div>
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </section>

      {/* Compact summary table (unchanged, keeps the quick-glance view) */}
      <section className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Compact summary
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead className="bg-[var(--surface-2)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              <tr>
                <th className="px-2 py-2 text-left">Underlying</th>
                <th className="px-2 py-2 text-right">Current</th>
                <th className="px-2 py-2 text-right">Strike ({(tranche.strikePct * 100).toFixed(0)}%)</th>
                <th className="px-2 py-2 text-right">EKI ({(tranche.ekiPct * 100).toFixed(0)}%)</th>
                <th className="px-2 py-2 text-right">Wayne's IV</th>
                <th className="px-2 py-2 text-right">Wayne's FV 12M</th>
                <th className="px-2 py-2 text-center">Debt Gate</th>
                <th className="px-2 py-2 text-center">KO Likely?</th>
                <th className="px-2 py-2 text-center">EKI Safe?</th>
              </tr>
            </thead>
            <tbody>
              {perUnderlying.map((u) => {
                if (!u.analysis) return (
                  <tr key={u.symbol} className="border-t border-[var(--line)]">
                    <td className="px-2 py-1.5 font-medium">{u.symbol}</td>
                    <td colSpan={8} className="px-2 py-1.5 text-[var(--text-muted)]">
                      <AlertTriangle size={10} className="mr-1 inline" /> {u.error || "no data"}
                    </td>
                  </tr>
                );
                const a = u.analysis;
                const strike = a.price * tranche.strikePct;
                const eki = a.price * tranche.ekiPct;
                const wayneIV = a.computed.waynesIntrinsicValue ?? a.computed.waynesEvSalesIV;
                const wayneFV = a.computed.waynesTarget;
                const koLikely = wayneFV != null && wayneFV > a.price;
                const ekiSafe = wayneIV != null && eki < wayneIV;
                const debtOK = !a.computed.banned;
                return (
                  <tr key={u.symbol} className="border-t border-[var(--line)] hover:bg-[var(--surface-2)]">
                    <td className="px-2 py-1.5">
                      <div className="font-semibold">{a.longName || u.symbol}</div>
                      <div className="text-[9.5px] text-[var(--text-muted)]">{u.symbol} · {u.market}</div>
                    </td>
                    <td className="px-2 py-1.5 tabular text-right font-semibold">{fmtPrice(a.price, ccy)}</td>
                    <td className="px-2 py-1.5 tabular text-right text-[var(--text-muted)]">{fmtPrice(strike, ccy)}</td>
                    <td className="px-2 py-1.5 tabular text-right text-[var(--text-muted)]">{fmtPrice(eki, ccy)}</td>
                    <td className="px-2 py-1.5 tabular text-right">{wayneIV != null ? fmtPrice(wayneIV, ccy) : "—"}</td>
                    <td className="px-2 py-1.5 tabular text-right">{wayneFV != null ? fmtPrice(wayneFV, ccy) : "—"}</td>
                    <td className="px-2 py-1.5 text-center">{debtOK ? "✅" : "❌"}</td>
                    <td className="px-2 py-1.5 text-center">{koLikely ? "✅" : "⚠️"}</td>
                    <td className="px-2 py-1.5 text-center">{ekiSafe ? "✅" : "⚠️"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function MiniValue({ label, value, price, ccy, accent }: {
  label: string; value: number | null; price: number; ccy: string; accent?: boolean;
}) {
  const upside = value && price ? ((value - price) / price) : null;
  const hintColor = upside == null ? "" : upside > 0 ? "text-success" : "text-danger";
  return (
    <div className={`rounded-md border px-2 py-1.5 ${accent ? "border-indigo-500/40 bg-indigo-500/10" : "border-[var(--line)] bg-[var(--surface-2)]/50"}`}>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className={`tabular text-[14px] font-bold ${accent ? "text-indigo-400" : ""}`}>
        {value != null ? fmtPrice(value, ccy) : "—"}
      </div>
      {upside != null && (
        <div className={`text-[10px] font-semibold ${hintColor}`}>
          {upside > 0 ? "+" : ""}{(upside * 100).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-1 border-b border-dashed border-[var(--line)] py-0.5">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="tabular font-semibold">{value}</span>
    </div>
  );
}

function FormulaFloat({ text, delay }: { text: string; delay: string }) {
  return (
    <span
      className="formula-float select-none"
      style={{ animationDelay: delay }}
    >
      {text}
    </span>
  );
}

function GateList({ title, items, color, icon: Icon }: {
  title: string; items: string[]; color: "emerald" | "red" | "muted"; icon: any;
}) {
  const cs =
    color === "emerald" ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-400" :
    color === "red" ? "border-red-500/40 bg-red-500/5 text-red-400" :
    "border-[var(--line)] bg-[var(--surface)] text-[var(--text-muted)]";
  return (
    <div className={`rounded-xl border p-3 ${cs}`}>
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
        <Icon size={11} />{title} ({items.length})
      </div>
      {items.length === 0 ? (
        <div className="text-[10.5px] italic opacity-50">none</div>
      ) : (
        <ul className="space-y-1 text-[11px] text-[var(--text)]">
          {items.map((it, idx) => <li key={idx} className="leading-snug">• {it}</li>)}
        </ul>
      )}
    </div>
  );
}
