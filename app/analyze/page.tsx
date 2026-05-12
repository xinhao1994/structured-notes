"use client";

// Stock Analyze — single-stock research dashboard for RM client briefs.
// Mobile-first, designed for non-native English readers.
//
// Sections:
//   1. Background        — friendly hook + company info
//   2. Fundamentals      — 4-number snapshot + verdict
//   3. 52-week range     — where the price sits in the year's range
//   4. Capital structure — cash / debt / equity pie
//   5. Revenue & profit  — 4-year trend (revenue + net income bars)
//   6. Earnings track    — last 4 quarters beat / miss
//   7. Price chart       — 5y line
//   8. Analyst sentiment — Strong Buy / Buy / Hold / Sell distribution
//   9. Next earnings     — date + estimate range (the catalyst)
//  10. Recent ratings    — upgrades / downgrades list
//  11. Scenarios         — 4 cases price targets
//
// Every section has a Copy button (WhatsApp-ready), charts have PNG export.

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  LineChart, Search, AlertTriangle, Copy, Check, Download,
  Building2, TrendingUp, BarChart3, Target, Sparkles, MapPin,
  ExternalLink, PieChart, Activity, Calendar, ArrowUpRight, ArrowDownRight,
  Users, DollarSign,
} from "lucide-react";
import {
  LineChart as RLineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip,
  BarChart, Bar, Cell, CartesianGrid, ReferenceLine,
  PieChart as RPieChart, Pie, Legend, ComposedChart,
} from "recharts";
import * as htmlToImage from "html-to-image";
import { STOCK_HOOKS, genericHook } from "@/lib/stockHooks";
import type { MarketCode } from "@/lib/types";

// ────────────────────────────────────────────────────────────────────────
// SOFT CHART PALETTE — easy on the eyes for a dark-themed app. Avoids
// the hard saturated red/green of the CSS vars. Slightly desaturated so
// nothing screams from the screen.
// ────────────────────────────────────────────────────────────────────────
const PALETTE = {
  pos:     "#7CC09E",  // sage green — positive / beat / safe
  neg:     "#E0857D",  // dusty coral — negative / miss / risk
  warn:    "#E8B86C",  // warm amber — inline / caution
  primary: "#7BA7E0",  // soft sky blue — primary data series
  accent:  "#C7A0E0",  // soft lavender — highlight / accent
  muted:   "#9CA3AF",  // slate grey — estimates / secondary
  gold:    "#D4B85E",  // gentle gold — premium / income
  grid:    "rgba(255,255,255,0.08)",
};
const TOOLTIP_STYLE = {
  background: "rgba(20, 24, 36, 0.95)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  fontSize: 12,
  color: "#e5e7eb",
};

const MARKETS: { code: MarketCode; label: string }[] = [
  { code: "US", label: "US" },
  { code: "HK", label: "HK" },
  { code: "SG", label: "SG" },
  { code: "JP", label: "JP" },
  { code: "AU", label: "AU" },
  { code: "MY", label: "MY" },
];

interface Profile {
  symbol: string; market: MarketCode; sym: string;
  inputSymbol?: string;
  candidatesTried?: string[];
  warnings?: string[];
  profile: { sector: string | null; industry: string | null; country: string | null; city: string | null; state: string | null; website: string | null; fullTimeEmployees: number | null; summary: string | null; };
  snapshot: { longName: string; exchange: string | null; currency: string | null; price: number | null; marketCap: number | null; high52: number | null; low52: number | null; dividendYield: number | null; beta: number | null; perf30d: number | null; };
  fundamentals: { forwardPE: number | null; trailingPE: number | null; pegRatio: number | null; enterpriseValue: number | null; evRevenue: number | null; evEbitda: number | null; profitMargin: number | null; operatingMargin: number | null; revenueGrowth: number | null; earningsGrowth: number | null; totalCash: number | null; totalDebt: number | null; sharesOutstanding: number | null; epsTrailing: number | null; epsForward: number | null; };
  income: Array<{ year: number; revenue: number; netIncome: number | null }>;
  earnings: Array<{ quarter: string; estimate: number | null; actual: number | null; surprisePct: number | null; verdict: "beat" | "miss" | "inline" | null }>;
  priceHistory: Array<{ t: number; c: number }>;
  analystRec: { period: string | null; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number } | null;
  nextEarnings: { date: string | null; epsEstimate: number | null; epsLow: number | null; epsHigh: number | null; revenueEstimate: number | null; revenueLow: number | null; revenueHigh: number | null } | null;
  upgrades: Array<{ firm: string | null; toGrade: string | null; fromGrade: string | null; action: string | null; date: string | null }>;
}

export default function AnalyzePage() {
  // Read ?symbol=NVDA&market=US so deep links from Desk / Pocket land directly
  // on the right stock instead of always defaulting to NVDA.
  const searchParams = useSearchParams();
  const urlSymbol = searchParams?.get("symbol") ?? null;
  const urlMarket = (searchParams?.get("market") ?? "US").toUpperCase() as MarketCode;

  const [input, setInput] = useState(urlSymbol || "NVDA");
  const [market, setMarket] = useState<MarketCode>(urlMarket);
  const [data, setData] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(symbol: string, mkt: MarketCode) {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/stock-profile?symbol=${encodeURIComponent(symbol)}&market=${mkt}`, { cache: "no-store" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || `Yahoo lookup failed (${r.status})`);
      }
      const j = await r.json() as Profile;
      setData(j);
    } catch (e: any) {
      setError(e?.message || "Could not load stock profile");
      setData(null);
    } finally { setLoading(false); }
  }

  // Re-load whenever the deep-link params change (Desk → Analyze taps,
  // or Desk → Pocket → Analyze flows). When no symbol param is present,
  // default to NVDA so the page still demos itself.
  useEffect(() => {
    const sym = urlSymbol || "NVDA";
    setInput(sym);
    setMarket(urlMarket);
    load(sym, urlMarket);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSymbol, urlMarket]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const s = input.trim(); if (!s) return;
    load(s, market);
  }

  return (
    <>
      <header className="mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Client briefing
        </div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <LineChart size={18} /> Stock Analyze
        </h1>
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">
          Deep-dive on one stock — friendly explanations, charts, scenarios.
          Tap any <em>Copy</em> button to send the section to your client on WhatsApp.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="card mb-3 flex flex-wrap items-end gap-2 p-3">
        <label className="block flex-1 min-w-[120px]">
          <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Ticker or company name</span>
          <input
            value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="NVDA · Sandisk · 9988 · Western Digital"
            className="input mt-1" autoCapitalize="characters"
          />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Market</span>
          <select value={market} onChange={(e) => setMarket(e.target.value as MarketCode)} className="input mt-1">
            {MARKETS.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
        </label>
        <button type="submit" className="btn btn-primary h-10 px-4 text-xs" disabled={loading}>
          <Search size={14} /> {loading ? "Loading..." : "Analyze"}
        </button>
      </form>

      {error && (
        <div className="card mb-3 border-l-4 border-l-danger p-3 text-[12.5px]">
          <div className="mb-1 flex items-center gap-2 font-semibold text-danger">
            <AlertTriangle size={14} /> {error}
          </div>
          <p className="text-[var(--text-muted)]">
            Try a company name (e.g. <code>NVIDIA</code>, <code>Sandisk</code>) — the lookup will find the ticker.
            For HK stocks use the 4-digit code (e.g. 9988 with HK market).
          </p>
        </div>
      )}

      {data && !loading && (
        <>
          {data.inputSymbol && data.inputSymbol.toUpperCase() !== data.symbol && (
            <div className="card mb-3 border-l-4 border-l-accent p-2.5 text-[12px]">
              <span className="text-[var(--text-muted)]">Resolved &ldquo;{data.inputSymbol}&rdquo; → </span>
              <strong className="font-mono">{data.symbol}</strong>
            </div>
          )}
          {data.warnings && data.warnings.length > 0 && (
            <div className="card mb-3 border-l-4 border-l-warning p-2.5 text-[11.5px] text-[var(--text-muted)]">
              {data.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
          <BackgroundCard data={data} />
          <FundamentalsCard data={data} />
          <RangeCard data={data} />
          <CapitalStructureCard data={data} />
          <RevenueTrendCard data={data} />
          <EarningsCard data={data} />
          <PriceChartCard data={data} />
          <AnalystRecCard data={data} />
          <NextEarningsCard data={data} />
          <UpgradesCard data={data} />
          <ScenariosCard data={data} />
        </>
      )}

      <p className="mt-3 text-[11px] text-[var(--text-muted)]">
        Data from Yahoo Finance and Finnhub (fallback). Fundamentals refresh quarterly; price history is weekly over 5 years.
        The verdicts and scenarios are heuristics — review the wording before sending to a real client.
      </p>
    </>
  );
}

/* ───────────── BACKGROUND CARD ───────────── */
function BackgroundCard({ data }: { data: Profile }) {
  const hook = STOCK_HOOKS[data.symbol];
  const intro = hook?.hook ?? genericHook(data.snapshot.longName, data.profile.summary);
  const hq = [data.profile.city, data.profile.state, data.profile.country].filter(Boolean).join(", ");
  // What-they-do — prefer curated, otherwise show a longer excerpt of
  // Yahoo's summary (up to ~500 chars so a newbie can actually learn).
  const whatTheyDo = hook?.whatTheyDo ?? data.profile.summary?.slice(0, 500) ?? "—";
  const howTheyMakeMoney = hook?.howTheyMakeMoney ?? null;

  const wa = useMemo(() => {
    const lines: string[] = [];
    lines.push(`📊 *${data.snapshot.longName}* (${data.symbol})`);
    lines.push("");
    lines.push(intro);
    lines.push("");
    lines.push("*What they do:*");
    lines.push(whatTheyDo);
    if (howTheyMakeMoney) {
      lines.push("");
      lines.push("*How they make money:* " + howTheyMakeMoney);
    }
    if (hook?.familiarProducts?.length) {
      lines.push("");
      lines.push("*Familiar products:* " + hook.familiarProducts.join(" · "));
    }
    if (hook?.whyItMoves?.length) {
      lines.push("");
      lines.push("*What moves the share price:*");
      hook.whyItMoves.forEach((w) => lines.push("• " + w));
    }
    if (hook?.malaysiaTie) {
      lines.push("");
      lines.push("🇲🇾 *Malaysia connection:* " + hook.malaysiaTie);
    } else if (hook?.noMalaysiaTie) {
      lines.push("");
      lines.push("🇲🇾 *Malaysia connection:* No direct Malaysian operations or partnership.");
    }
    if (hook?.founded) lines.push("\n*Founded:* " + hook.founded);
    if (hook?.listedSince) lines.push("*Listed:* " + hook.listedSince);
    if (hq) lines.push("*Headquarters:* " + hq);
    if (data.profile.sector) lines.push(`*Sector:* ${data.profile.sector}${data.profile.industry ? ` · ${data.profile.industry}` : ""}`);
    if (data.profile.fullTimeEmployees) lines.push(`*Employees:* ${data.profile.fullTimeEmployees.toLocaleString()}`);
    return lines.join("\n");
  }, [data, hook, intro, whatTheyDo, howTheyMakeMoney, hq]);

  return (
    <section className="card mb-3 p-4">
      <header className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <Building2 size={11} className="mr-1 inline" /> Background
          </div>
          <h2 className="text-lg font-semibold">{data.snapshot.longName}</h2>
          <div className="text-[11px] text-[var(--text-muted)]">{data.symbol} · {data.snapshot.exchange ?? data.market} · {data.snapshot.currency ?? ""}</div>
        </div>
        <CopyButton text={wa} label="Copy to client" />
      </header>

      {/* HOOK — relatable opener, even for stocks not in our curated list */}
      <div className="rounded-xl border border-l-4 border-l-accent border-[var(--line)] bg-[var(--surface-2)] p-3 text-[13.5px] leading-relaxed">
        <Sparkles size={13} className="float-left mr-1.5 mt-0.5 text-accent" />
        {intro}
      </div>

      {/* WHAT THEY DO — always full-width so newbie gets the proper paragraph */}
      <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">What they do</div>
        <p className="mt-1 text-[12.5px] leading-relaxed">{whatTheyDo}</p>
      </div>

      {/* HOW THEY MAKE MONEY — only for curated stocks (high-value info) */}
      {howTheyMakeMoney && (
        <div className="mt-2 rounded-xl border border-l-4 border-l-success border-[var(--line)] bg-[var(--surface-2)] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">💰 How they make money</div>
          <p className="mt-1 text-[12.5px] leading-relaxed">{howTheyMakeMoney}</p>
        </div>
      )}

      {/* WHY IT MOVES — share-price drivers */}
      {hook?.whyItMoves?.length && (
        <div className="mt-2 rounded-xl border border-l-4 border-l-warning border-[var(--line)] bg-[var(--surface-2)] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">📈 What moves the share price</div>
          <ul className="mt-1 space-y-1 text-[12.5px] leading-relaxed">
            {hook.whyItMoves.map((w, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-warning">•</span><span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* FAMILIAR PRODUCTS */}
      {hook?.familiarProducts?.length ? (
        <div className="mt-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Products you might know</div>
          <ul className="mt-1 list-disc pl-5 text-[12.5px] leading-relaxed marker:text-accent">
            {hook.familiarProducts.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      ) : null}

      {/* MALAYSIA CONNECTION — explicit yes/no */}
      {(hook?.malaysiaTie || hook?.noMalaysiaTie) && (
        <div className={`mt-2 rounded-xl border border-l-4 p-3 ${hook?.malaysiaTie ? "border-l-warning border-[var(--line)] bg-[var(--surface-2)]" : "border-l-[var(--text-muted)] border-[var(--line)] bg-[var(--surface-2)]"}`}>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">🇲🇾 Malaysia connection</div>
          <p className="mt-1 text-[12.5px] leading-relaxed">
            {hook?.malaysiaTie ?? "No direct Malaysian operations or business partnership that we've documented for this company."}
          </p>
        </div>
      )}

      {/* COMPANY FACTS — compact grid */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {hook?.founded && (
          <Pill label="Founded" body={<div className="flex items-center gap-1.5"><Calendar size={12} className="text-[var(--text-muted)]" />{hook.founded}</div>} />
        )}
        {hook?.listedSince && (
          <Pill label="Listed since" body={<div className="flex items-center gap-1.5"><TrendingUp size={12} className="text-[var(--text-muted)]" />{hook.listedSince}</div>} />
        )}
        <Pill label="Headquarters" body={
          <div className="flex items-center gap-1.5"><MapPin size={12} className="text-[var(--text-muted)]" /><span>{hq || "—"}</span></div>
        } />
        <Pill label="Sector / industry" body={
          <span>{data.profile.sector ?? "—"}{data.profile.industry && <span className="text-[var(--text-muted)]"> · {data.profile.industry}</span>}</span>
        } />
        <Pill label="Employees" body={<div className="flex items-center gap-1.5"><Users size={12} className="text-[var(--text-muted)]" />{data.profile.fullTimeEmployees != null ? data.profile.fullTimeEmployees.toLocaleString() : "—"}</div>} />
        {data.profile.website && (
          <Pill label="Website" body={
            <a href={data.profile.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              {data.profile.website.replace(/^https?:\/\//, "")} <ExternalLink size={11} />
            </a>
          } />
        )}
      </div>

      {/* Friendly nudge for stocks without curated content so we can prioritise expansion */}
      {!hook && (
        <p className="mt-3 text-[10.5px] text-[var(--text-muted)]">
          ℹ️ Detailed hook + Malaysia tie for this ticker not yet curated. The summary above comes from Yahoo Finance.
          For deeper coverage on this name, request an addition to the stock-hook library.
        </p>
      )}
    </section>
  );
}

/* ───────────── FUNDAMENTALS ───────────── */
function FundamentalsCard({ data }: { data: Profile }) {
  const f = data.fundamentals; const s = data.snapshot;
  const fmtCcy = (n: number | null) => n == null ? "—" : (data.snapshot.currency || "USD") + " " + fmtNum(n);
  const fmtBig = (n: number | null) => n == null ? "—" : (data.snapshot.currency || "USD") + " " + fmtBigNum(n);
  const fmtPct = (n: number | null) => n == null ? "—" : `${(n * 100).toFixed(1)}%`;
  const fmtX = (n: number | null) => n == null ? "—" : `${n.toFixed(1)}×`;
  const fmtPctSigned = (n: number | null) => n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

  const verdict = useMemo(() => {
    if (f.forwardPE == null) return null;
    if (f.pegRatio != null) {
      if (f.pegRatio < 1) return { tone: "below", label: "Looks below fair value", note: `PEG ${f.pegRatio.toFixed(2)} (< 1.0 = growth not fully priced in).` };
      if (f.pegRatio < 1.5) return { tone: "at", label: "Looks around fair value", note: `PEG ${f.pegRatio.toFixed(2)} (1.0–1.5 typical).` };
      return { tone: "above", label: "Looks above fair value", note: `PEG ${f.pegRatio.toFixed(2)} (> 1.5 = priced for high growth).` };
    }
    if (f.forwardPE < 15) return { tone: "below", label: "Looks below fair value", note: `Fwd P/E ${f.forwardPE.toFixed(1)} (< 15 = cheap on earnings).` };
    if (f.forwardPE < 25) return { tone: "at", label: "Looks around fair value", note: `Fwd P/E ${f.forwardPE.toFixed(1)} (15–25 typical).` };
    return { tone: "above", label: "Looks above fair value", note: `Fwd P/E ${f.forwardPE.toFixed(1)} (> 25 = priced for high growth).` };
  }, [f]);

  const wa = useMemo(() => {
    const lines: string[] = [];
    lines.push(`📈 *${data.symbol} — Fundamentals snapshot*`);
    lines.push("");
    lines.push(`💰 Price: ${fmtCcy(s.price)} · Market cap: ${fmtBig(s.marketCap)}`);
    lines.push(`📅 30-day move: ${fmtPctSigned(s.perf30d)}`);
    lines.push("");
    lines.push(`📊 Forward P/E: ${fmtX(f.forwardPE)} · EV/Sales: ${fmtX(f.evRevenue)}`);
    lines.push(`📈 Revenue growth (last Q): ${fmtPctSigned(f.revenueGrowth != null ? f.revenueGrowth * 100 : null)}`);
    lines.push(`📈 Earnings growth (last Q): ${fmtPctSigned(f.earningsGrowth != null ? f.earningsGrowth * 100 : null)}`);
    lines.push("");
    lines.push(`💵 Cash: ${fmtBig(f.totalCash)} · Debt: ${fmtBig(f.totalDebt)} · Net: ${fmtBig((f.totalCash ?? 0) - (f.totalDebt ?? 0))}`);
    if (verdict) {
      lines.push("");
      lines.push(`*Verdict:* ${verdict.label}. ${verdict.note}`);
    }
    return lines.join("\n");
  }, [data, f, s, verdict]);

  return (
    <section className="card mb-3 p-4">
      <header className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <BarChart3 size={11} className="mr-1 inline" /> Fundamentals
          </div>
          <h2 className="text-lg font-semibold">Snapshot in 4 numbers</h2>
        </div>
        <CopyButton text={wa} label="Copy" />
      </header>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Num label="Price" big={fmtCcy(s.price)} sub={`Cap ${fmtBig(s.marketCap)}`} />
        <Num label="30-day move" big={fmtPctSigned(s.perf30d)} sub={`52w ${fmtNum(s.low52)} – ${fmtNum(s.high52)}`} tone={s.perf30d != null ? (s.perf30d >= 0 ? "pos" : "neg") : "neutral"} />
        <Num label="Forward P/E" big={fmtX(f.forwardPE)} sub={`EV/Sales ${fmtX(f.evRevenue)}`} />
        <Num label="Revenue growth (Q)" big={f.revenueGrowth != null ? `${f.revenueGrowth >= 0 ? "+" : ""}${(f.revenueGrowth * 100).toFixed(1)}%` : "—"} sub={`EPS gr. ${fmtPctSigned(f.earningsGrowth != null ? f.earningsGrowth * 100 : null)}`} tone={f.revenueGrowth != null ? (f.revenueGrowth >= 0 ? "pos" : "neg") : "neutral"} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Num label="Cash" big={fmtBig(f.totalCash)} />
        <Num label="Debt" big={fmtBig(f.totalDebt)} />
        <Num label="Net cash" big={fmtBig((f.totalCash ?? 0) - (f.totalDebt ?? 0))} tone={(f.totalCash ?? 0) - (f.totalDebt ?? 0) >= 0 ? "pos" : "neg"} />
        <Num label="Profit margin" big={fmtPct(f.profitMargin)} sub={`Op. ${fmtPct(f.operatingMargin)}`} />
      </div>
      {verdict && (
        <div className={`mt-3 rounded-xl border p-3 text-[13px] ${
          verdict.tone === "below" ? "border-success/40 bg-successBg text-success dark:bg-success/10" :
          verdict.tone === "above" ? "border-warning/40 bg-[var(--surface-2)] text-warning" :
          "border-[var(--line)] bg-[var(--surface-2)] text-[var(--text)]"
        }`}>
          <strong>Verdict:</strong> {verdict.label}. <span className="opacity-80">{verdict.note}</span>
        </div>
      )}
    </section>
  );
}

/* ───────────── 52-WEEK RANGE ───────────── */
function RangeCard({ data }: { data: Profile }) {
  const { low52, high52, price, currency } = data.snapshot;
  if (low52 == null || high52 == null || price == null) return null;
  const pct = Math.max(0, Math.min(100, ((price - low52) / (high52 - low52)) * 100));
  const ccy = currency || "";
  const wa = `📊 *${data.symbol} — 52-week range*\n${ccy} ${low52.toFixed(2)} (low) → ${ccy} ${high52.toFixed(2)} (high)\nCurrent ${ccy} ${price.toFixed(2)} = ${pct.toFixed(0)}% of the way up.\n${pct < 33 ? "Trading in the LOWER third — value zone." : pct > 66 ? "Trading in the UPPER third — momentum zone, watch out for pullback." : "Trading in the MIDDLE — fair value zone."}`;

  return (
    <section className="card mb-3 p-4">
      <header className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <Activity size={11} className="mr-1 inline" /> Where it sits
          </div>
          <h2 className="text-lg font-semibold">52-week range</h2>
        </div>
        <CopyButton text={wa} label="Copy" />
      </header>
      <div className="rounded-xl bg-[var(--surface-2)] p-3">
        <div className="mb-1 flex justify-between text-[11px] text-[var(--text-muted)]">
          <span>Low {ccy} {low52.toFixed(2)}</span>
          <span>High {ccy} {high52.toFixed(2)}</span>
        </div>
        <div className="relative h-3 overflow-hidden rounded-full" style={{
          background: `linear-gradient(90deg, ${PALETTE.pos}33 0%, ${PALETTE.warn}33 50%, ${PALETTE.neg}33 100%)`,
        }}>
          <div
            className="absolute top-1/2 h-5 w-1 -translate-y-1/2 rounded-full"
            style={{ left: `calc(${pct}% - 2px)`, background: PALETTE.primary, boxShadow: `0 0 10px ${PALETTE.primary}` }}
          />
        </div>
        <div className="mt-2 text-center text-[12px]">
          <span className="font-semibold tabular text-[14px]">{ccy} {price.toFixed(2)}</span>
          <span className="ml-2 text-[var(--text-muted)]">at {pct.toFixed(0)}% of range</span>
        </div>
        <p className="mt-2 text-center text-[11.5px] text-[var(--text-muted)]">
          {pct < 33 ? "🟢 Lower third — closer to value zone." :
           pct > 66 ? "🟡 Upper third — momentum zone, less margin of safety." :
           "⚪ Middle of range — balanced."}
        </p>
      </div>
    </section>
  );
}

/* ───────────── CAPITAL STRUCTURE PIE ───────────── */
function CapitalStructureCard({ data }: { data: Profile }) {
  const ref = useRef<HTMLDivElement>(null);
  const { totalCash, totalDebt } = data.fundamentals;
  const { marketCap, currency } = data.snapshot;
  if (totalCash == null && totalDebt == null && marketCap == null) return null;
  const cash = totalCash ?? 0;
  const debt = totalDebt ?? 0;
  // Equity proxy = market cap minus net cash. For visualisation only.
  const equity = Math.max(0, (marketCap ?? 0) - Math.max(0, cash - debt));
  const pieData = [
    { name: "Cash", value: cash, color: PALETTE.pos },
    { name: "Debt", value: debt, color: PALETTE.neg },
    { name: "Equity (market cap − net cash)", value: equity, color: PALETTE.primary },
  ].filter((d) => d.value > 0);
  if (pieData.length === 0) return null;
  const ccy = currency || "";
  const netCash = cash - debt;
  const healthVerdict = netCash >= 0
    ? `Net cash position of ${ccy} ${fmtBigNum(netCash)} — balance sheet is strong.`
    : `Net debt position of ${ccy} ${fmtBigNum(Math.abs(netCash))} — they owe more than they hold.`;

  const wa = `💼 *${data.symbol} — Capital structure*\nCash: ${ccy} ${fmtBigNum(cash)}\nDebt: ${ccy} ${fmtBigNum(debt)}\nMarket cap: ${ccy} ${fmtBigNum(marketCap)}\n\n${healthVerdict}`;

  return (
    <section className="card mb-3 p-4">
      <header className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <PieChart size={11} className="mr-1 inline" /> Balance sheet health
          </div>
          <h2 className="text-lg font-semibold">Capital structure</h2>
        </div>
        <div className="flex gap-1.5">
          <DownloadButton targetRef={ref} filename={`${data.symbol}-capital.png`} />
          <CopyButton text={wa} label="Copy" />
        </div>
      </header>
      <div ref={ref} className="rounded-xl bg-[var(--surface-2)] p-3">
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer>
            <RPieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%" cy="50%"
                innerRadius={50} outerRadius={85}
                paddingAngle={2}
                stroke="rgba(0,0,0,0.2)"
                strokeWidth={1}
              >
                {pieData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
              </Pie>
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v: any) => `${ccy} ${fmtBigNum(Number(v))}`}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" />
            </RPieChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-center text-[12px]">
          <span className={`font-semibold ${netCash >= 0 ? "text-[var(--text)]" : "text-warning"}`}>
            {netCash >= 0 ? "✓ " : "⚠ "}{healthVerdict}
          </span>
        </p>
      </div>
    </section>
  );
}

/* ───────────── REVENUE & PROFIT TREND ───────────── */
function RevenueTrendCard({ data }: { data: Profile }) {
  const ref = useRef<HTMLDivElement>(null);
  if (!data.income || data.income.length === 0) return null;
  const rows = data.income.map((r) => ({
    year: r.year.toString(),
    revenue: r.revenue / 1e9, // billions for readable axis
    netIncome: r.netIncome != null ? r.netIncome / 1e9 : 0,
    margin: r.netIncome != null && r.revenue > 0 ? (r.netIncome / r.revenue) * 100 : 0,
  }));
  const ccy = data.snapshot.currency || "";
  const first = rows[0], last = rows[rows.length - 1];
  const revGrowthCagr = first.revenue > 0 && rows.length > 1
    ? (Math.pow(last.revenue / first.revenue, 1 / (rows.length - 1)) - 1) * 100
    : null;

  const wa = `📈 *${data.symbol} — Revenue & profit trend*\n${rows.map(r => `${r.year}: ${ccy} ${r.revenue.toFixed(1)}B revenue · ${r.netIncome.toFixed(1)}B profit (${r.margin.toFixed(1)}% margin)`).join("\n")}\n\n${revGrowthCagr != null ? `Revenue CAGR (${rows.length}y): ${revGrowthCagr >= 0 ? "+" : ""}${revGrowthCagr.toFixed(1)}%/year` : ""}`;

  return (
    <section className="card mb-3 p-4">
      <header className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <DollarSign size={11} className="mr-1 inline" /> Money story
          </div>
          <h2 className="text-lg font-semibold">Revenue &amp; profit — last {rows.length} years</h2>
          {revGrowthCagr != null && (
            <div className="text-[11px] text-[var(--text-muted)]">
              Revenue growing <strong className={revGrowthCagr >= 0 ? "text-success" : "text-danger"}>{revGrowthCagr >= 0 ? "+" : ""}{revGrowthCagr.toFixed(1)}%/year</strong> on average
            </div>
          )}
        </div>
        <div className="flex gap-1.5">
          <DownloadButton targetRef={ref} filename={`${data.symbol}-revenue.png`} />
          <CopyButton text={wa} label="Copy" />
        </div>
      </header>
      <div ref={ref} className="rounded-xl bg-[var(--surface-2)] p-3">
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: "#9CA3AF" }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "#9CA3AF" }} tickFormatter={(v) => `${v.toFixed(0)}B`} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "#9CA3AF" }} tickFormatter={(v) => `${v.toFixed(0)}%`} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v: any, name: string) => {
                  if (name === "Net margin") return `${Number(v).toFixed(1)}%`;
                  return `${ccy} ${Number(v).toFixed(2)}B`;
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" />
              <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill={PALETTE.primary} radius={[6, 6, 0, 0]} />
              <Bar yAxisId="left" dataKey="netIncome" name="Net profit" fill={PALETTE.gold} radius={[6, 6, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="margin" name="Net margin" stroke={PALETTE.accent} strokeWidth={2} dot={{ fill: PALETTE.accent, r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

/* ───────────── EARNINGS HISTORY ───────────── */
function EarningsCard({ data }: { data: Profile }) {
  const rows = data.earnings.filter((r) => r.estimate != null || r.actual != null);
  const ref = useRef<HTMLDivElement>(null);
  const wa = useMemo(() => {
    if (!rows.length) return `📊 ${data.symbol}: No recent earnings history available.`;
    const lines = [`📊 *${data.symbol} — Last ${rows.length} quarters earnings*`, ""];
    for (const r of rows) {
      const e = r.estimate != null ? r.estimate.toFixed(2) : "—";
      const a = r.actual != null ? r.actual.toFixed(2) : "—";
      const emoji = r.verdict === "beat" ? "✅" : r.verdict === "miss" ? "❌" : r.verdict === "inline" ? "➖" : "—";
      const sp = r.surprisePct != null ? ` (${r.surprisePct >= 0 ? "+" : ""}${r.surprisePct.toFixed(1)}%)` : "";
      lines.push(`${emoji} ${r.quarter || "—"}: actual ${a} vs est ${e}${sp}`);
    }
    return lines.join("\n");
  }, [data.symbol, rows]);

  return (
    <section className="card mb-3 p-4">
      <header className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <TrendingUp size={11} className="mr-1 inline" /> Earnings track record
          </div>
          <h2 className="text-lg font-semibold">Beat or miss — last {rows.length} quarters</h2>
        </div>
        <div className="flex gap-1.5">
          <DownloadButton targetRef={ref} filename={`${data.symbol}-earnings.png`} />
          <CopyButton text={wa} label="Copy" />
        </div>
      </header>
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-[var(--text-muted)]">No recent earnings data available.</p>
      ) : (
        <div ref={ref} className="rounded-xl bg-[var(--surface-2)] p-3">
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} vertical={false} />
                <XAxis dataKey="quarter" tick={{ fontSize: 10, fill: "#9CA3AF" }} />
                <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => typeof v === "number" ? v.toFixed(2) : v} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" />
                <Bar dataKey="estimate" name="Estimate" fill={PALETTE.muted} opacity={0.5} radius={[4, 4, 0, 0]} />
                <Bar dataKey="actual" name="Actual" radius={[4, 4, 0, 0]}>
                  {rows.map((r, i) => (
                    <Cell key={i} fill={
                      r.verdict === "beat" ? PALETTE.pos :
                      r.verdict === "miss" ? PALETTE.neg :
                      PALETTE.warn
                    } />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11.5px] sm:grid-cols-4">
            {rows.map((r) => (
              <div key={r.quarter} className="rounded-lg border border-[var(--line)] p-2">
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{r.quarter || "—"}</div>
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="tabular font-semibold">{r.actual != null ? r.actual.toFixed(2) : "—"}</span>
                  <span className="text-[10px] text-[var(--text-muted)]">vs {r.estimate != null ? r.estimate.toFixed(2) : "—"}</span>
                </div>
                <span
                  className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                  style={{
                    background: r.verdict === "beat" ? `${PALETTE.pos}26` : r.verdict === "miss" ? `${PALETTE.neg}26` : `${PALETTE.warn}26`,
                    color: r.verdict === "beat" ? PALETTE.pos : r.verdict === "miss" ? PALETTE.neg : PALETTE.warn,
                  }}
                >
                  {r.verdict === "beat" ? "✓ Beat" : r.verdict === "miss" ? "✗ Miss" : r.verdict === "inline" ? "= Inline" : "—"}
                  {r.surprisePct != null && <span className="ml-1 font-normal opacity-75">{r.surprisePct >= 0 ? "+" : ""}{r.surprisePct.toFixed(1)}%</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/* ───────────── 5Y PRICE CHART ───────────── */
function PriceChartCard({ data }: { data: Profile }) {
  const ref = useRef<HTMLDivElement>(null);
  const series = data.priceHistory.map((p) => ({ d: new Date(p.t).toISOString().slice(0, 7), c: p.c }));
  if (series.length === 0) return null;
  const first = series[0].c, last = series[series.length - 1].c;
  const totalReturn = ((last - first) / first) * 100;
  const wa = `📈 *${data.symbol} — 5-year price story*\n\nFrom ${data.snapshot.currency || ""} ${first.toFixed(2)} (${series[0].d}) → ${data.snapshot.currency || ""} ${last.toFixed(2)} (today). Total return: ${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(0)}% over 5 years.`;

  return (
    <section className="card mb-3 p-4">
      <header className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <LineChart size={11} className="mr-1 inline" /> Price journey
          </div>
          <h2 className="text-lg font-semibold">5-year weekly close</h2>
          <div className="text-[11px] text-[var(--text-muted)]">
            Total return: <strong style={{ color: totalReturn >= 0 ? PALETTE.pos : PALETTE.neg }}>{totalReturn >= 0 ? "+" : ""}{totalReturn.toFixed(0)}%</strong>
          </div>
        </div>
        <div className="flex gap-1.5">
          <DownloadButton targetRef={ref} filename={`${data.symbol}-5y-price.png`} />
          <CopyButton text={wa} label="Copy" />
        </div>
      </header>
      <div ref={ref} className="rounded-xl bg-[var(--surface-2)] p-3">
        <div style={{ width: "100%", height: 240 }}>
          <ResponsiveContainer>
            <RLineChart data={series} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PALETTE.primary} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={PALETTE.primary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} vertical={false} />
              <XAxis dataKey="d" tick={{ fontSize: 10, fill: "#9CA3AF" }} interval={Math.floor(series.length / 8)} />
              <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} domain={["auto", "auto"]} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="c" stroke={PALETTE.primary} strokeWidth={2.2} dot={false} fill="url(#priceFill)" />
            </RLineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

/* ───────────── ANALYST RECOMMENDATION ───────────── */
function AnalystRecCard({ data }: { data: Profile }) {
  const r = data.analystRec;
  if (!r) return null;
  const total = r.strongBuy + r.buy + r.hold + r.sell + r.strongSell;
  if (total === 0) return null;
  const segments = [
    { name: "Strong Buy", n: r.strongBuy, color: "#5FA77E" },     // deeper green
    { name: "Buy", n: r.buy, color: PALETTE.pos },
    { name: "Hold", n: r.hold, color: PALETTE.warn },
    { name: "Sell", n: r.sell, color: "#D88A82" },                // softer red
    { name: "Strong Sell", n: r.strongSell, color: PALETTE.neg },
  ];
  const bullish = r.strongBuy + r.buy;
  const bearish = r.sell + r.strongSell;
  const verdict = bullish > bearish + r.hold ? "Strongly bullish" :
                  bullish > bearish ? "Mostly bullish" :
                  bearish > bullish ? "Cautious / bearish" : "Mixed views";

  const wa = `🎯 *${data.symbol} — Analyst sentiment* (${total} analysts)\n` +
    `Strong Buy: ${r.strongBuy} · Buy: ${r.buy} · Hold: ${r.hold} · Sell: ${r.sell} · Strong Sell: ${r.strongSell}\n\n*${verdict}* — ${bullish} bulls, ${bearish} bears.`;

  return (
    <section className="card mb-3 p-4">
      <header className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <Users size={11} className="mr-1 inline" /> Wall Street view
          </div>
          <h2 className="text-lg font-semibold">Analyst recommendations · {total} analysts</h2>
          <div className="text-[11px]" style={{ color: bullish > bearish ? PALETTE.pos : bearish > bullish ? PALETTE.neg : PALETTE.warn }}>
            {verdict}
          </div>
        </div>
        <CopyButton text={wa} label="Copy" />
      </header>
      <div className="rounded-xl bg-[var(--surface-2)] p-3">
        <div className="flex h-7 overflow-hidden rounded-full">
          {segments.map((s) => s.n > 0 && (
            <div
              key={s.name}
              className="flex items-center justify-center text-[10px] font-semibold text-white/90"
              style={{ width: `${(s.n / total) * 100}%`, background: s.color, minWidth: 24 }}
              title={`${s.name}: ${s.n}`}
            >
              {s.n}
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-5 gap-1 text-center text-[10.5px]">
          {segments.map((s) => (
            <div key={s.name}>
              <div className="mx-auto mb-0.5 h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
              <div className="text-[var(--text-muted)] leading-tight">{s.name}</div>
              <div className="tabular font-semibold">{s.n}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────── NEXT EARNINGS DATE ───────────── */
function NextEarningsCard({ data }: { data: Profile }) {
  const e = data.nextEarnings;
  if (!e || !e.date) return null;
  const ccy = data.snapshot.currency || "";
  const daysAway = Math.round((new Date(e.date).getTime() - Date.now()) / 86400000);
  const wa = `📅 *${data.symbol} — Next catalyst*\nNext earnings: *${e.date}* (${daysAway >= 0 ? `in ${daysAway} days` : `${-daysAway} days ago`}).\nEPS estimate: ${e.epsEstimate?.toFixed(2) ?? "—"} (range ${e.epsLow?.toFixed(2) ?? "—"} to ${e.epsHigh?.toFixed(2) ?? "—"}).${e.revenueEstimate != null ? `\nRevenue estimate: ${ccy} ${fmtBigNum(e.revenueEstimate)}` : ""}\n\nA beat could push price up, a miss could trigger selloff. Watch this date.`;

  return (
    <section className="card mb-3 p-4">
      <header className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <Calendar size={11} className="mr-1 inline" /> Next catalyst
          </div>
          <h2 className="text-lg font-semibold">Upcoming earnings · {e.date}</h2>
          <div className="text-[11px] text-[var(--text-muted)]">
            {daysAway >= 0 ? `In ${daysAway} day${daysAway === 1 ? "" : "s"}` : `${-daysAway} day${-daysAway === 1 ? "" : "s"} ago`}
          </div>
        </div>
        <CopyButton text={wa} label="Copy" />
      </header>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Num label="EPS estimate" big={e.epsEstimate != null ? e.epsEstimate.toFixed(2) : "—"} sub={`Range ${e.epsLow?.toFixed(2) ?? "—"} – ${e.epsHigh?.toFixed(2) ?? "—"}`} />
        {e.revenueEstimate != null && (
          <Num label="Revenue est." big={`${ccy} ${fmtBigNum(e.revenueEstimate)}`} sub={`Range ${fmtBigNum(e.revenueLow)} – ${fmtBigNum(e.revenueHigh)}`} />
        )}
        <Num label="Days to report" big={daysAway >= 0 ? `${daysAway} days` : "passed"} tone={daysAway >= 0 && daysAway <= 14 ? "pos" : "neutral"} />
      </div>
    </section>
  );
}

/* ───────────── RECENT UPGRADES / DOWNGRADES ───────────── */
function UpgradesCard({ data }: { data: Profile }) {
  if (!data.upgrades || data.upgrades.length === 0) return null;
  const wa = `📰 *${data.symbol} — Recent analyst rating changes*\n` +
    data.upgrades.slice(0, 5).map(u => `${u.date}: ${u.firm} — ${u.action ?? "?"} from "${u.fromGrade ?? "—"}" to "${u.toGrade ?? "—"}"`).join("\n");

  return (
    <section className="card mb-3 p-4">
      <header className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <ArrowUpRight size={11} className="mr-1 inline" /> Latest moves
          </div>
          <h2 className="text-lg font-semibold">Recent rating changes</h2>
        </div>
        <CopyButton text={wa} label="Copy" />
      </header>
      <div className="overflow-x-auto rounded-xl bg-[var(--surface-2)]">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              <th className="p-2 text-left">Date</th>
              <th className="p-2 text-left">Firm</th>
              <th className="p-2 text-left">Action</th>
              <th className="p-2 text-left">Rating</th>
            </tr>
          </thead>
          <tbody>
            {data.upgrades.slice(0, 6).map((u, i) => {
              const isUp = /upgrade|up$/i.test(u.action || "");
              const isDown = /downgrade|down$/i.test(u.action || "");
              return (
                <tr key={i} className="border-t border-[var(--line)]">
                  <td className="p-2 tabular text-[var(--text-muted)]">{u.date || "—"}</td>
                  <td className="p-2">{u.firm || "—"}</td>
                  <td className="p-2">
                    <span className="inline-flex items-center gap-1" style={{ color: isUp ? PALETTE.pos : isDown ? PALETTE.neg : PALETTE.muted }}>
                      {isUp ? <ArrowUpRight size={11} /> : isDown ? <ArrowDownRight size={11} /> : null}
                      {u.action || "—"}
                    </span>
                  </td>
                  <td className="p-2 text-[var(--text-muted)]">
                    {u.fromGrade ? <span className="line-through opacity-60">{u.fromGrade}</span> : null}
                    {u.fromGrade && u.toGrade ? " → " : null}
                    <strong className="text-[var(--text)]">{u.toGrade || "—"}</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ───────────── SCENARIOS ───────────── */
function ScenariosCard({ data }: { data: Profile }) {
  const f = data.fundamentals;
  const eps = f.epsForward ?? f.epsTrailing;
  const basePE = f.forwardPE ?? f.trailingPE ?? 20;
  const price = data.snapshot.price;
  const ccy = data.snapshot.currency || "USD";

  const [bearMult, setBearMult] = useState(Math.round(basePE * 0.6));
  const [baseMult, setBaseMult] = useState(Math.round(basePE));
  const [bullMult, setBullMult] = useState(Math.round(basePE * 1.3));
  const [stretchMult, setStretchMult] = useState(Math.round(basePE * 1.6));

  useEffect(() => {
    setBearMult(Math.round(basePE * 0.6));
    setBaseMult(Math.round(basePE));
    setBullMult(Math.round(basePE * 1.3));
    setStretchMult(Math.round(basePE * 1.6));
  }, [data.symbol, basePE]);

  if (eps == null) {
    return (
      <section className="card mb-3 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          <Target size={11} className="mr-1 inline" /> Asymmetry
        </div>
        <h2 className="text-lg font-semibold">Where can it go?</h2>
        <p className="mt-2 text-[12.5px] text-[var(--text-muted)]">EPS data unavailable.</p>
      </section>
    );
  }

  const scenarios = [
    { tone: "bear", label: "Bear case", horizon: "3-6 months", mult: bearMult, setMult: setBearMult, caption: "If catalyst disappoints" },
    { tone: "base", label: "Base case", horizon: "6-12 months", mult: baseMult, setMult: setBaseMult, caption: "If execution holds" },
    { tone: "bull", label: "Bull case", horizon: "12-18 months", mult: bullMult, setMult: setBullMult, caption: "If everything works" },
    { tone: "stretch", label: "Stretched bull", horizon: "24 months", mult: stretchMult, setMult: setStretchMult, caption: "Absolute ceiling" },
  ];
  const targets = scenarios.map((s) => ({ ...s, target: s.mult * eps }));
  const entryZone = price != null ? targets[0].target : null;
  const trim = targets[2].target;
  const hardStop = price != null ? price * 0.85 : null;

  const wa = useMemo(() => {
    const lines: string[] = [];
    lines.push(`🎯 *${data.symbol} — 4-scenario price targets*`);
    lines.push(`(based on EPS ${eps.toFixed(2)} × multiple)`);
    lines.push("");
    for (const t of targets) lines.push(`*${t.label}* (${t.horizon}): ${ccy} ${t.target.toFixed(2)} — ${t.mult}× EPS — ${t.caption}`);
    if (price != null) {
      lines.push("");
      lines.push("📍 *Plan:*");
      if (entryZone != null) lines.push(`Entry zone: around ${ccy} ${entryZone.toFixed(2)} (bear case)`);
      lines.push(`Trim levels: around ${ccy} ${trim.toFixed(2)} (bull case)`);
      if (hardStop != null) lines.push(`Hard stop: ${ccy} ${hardStop.toFixed(2)} (-15% from spot)`);
    }
    return lines.join("\n");
  }, [data.symbol, eps, ccy, targets, price, entryZone, trim, hardStop]);

  return (
    <section className="card mb-3 p-4">
      <header className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <Target size={11} className="mr-1 inline" /> Asymmetry — where it can go
          </div>
          <h2 className="text-lg font-semibold">4 scenarios</h2>
          <div className="text-[11px] text-[var(--text-muted)]">
            Anchored on EPS <strong>{eps.toFixed(2)}</strong> × multiple. Adjust below.
          </div>
        </div>
        <CopyButton text={wa} label="Copy" />
      </header>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {targets.map((s) => {
          const upside = price != null ? ((s.target - price) / price) * 100 : null;
          const accentColor =
            s.tone === "bear" ? PALETTE.neg :
            s.tone === "base" ? PALETTE.primary :
            s.tone === "bull" ? PALETTE.pos :
            PALETTE.gold;
          return (
            <div key={s.label} className="rounded-xl border-l-4 border-[var(--line)] bg-[var(--surface-2)] p-3" style={{ borderLeftColor: accentColor }}>
              <div className="flex items-center justify-between">
                <div className="text-[12px] font-semibold uppercase tracking-wider">{s.label}</div>
                <div className="text-[10px] text-[var(--text-muted)]">{s.horizon}</div>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <div className="tabular text-2xl font-semibold">{ccy} {s.target.toFixed(2)}</div>
                {upside != null && (
                  <div className="text-[12px] font-semibold" style={{ color: upside >= 0 ? PALETTE.pos : PALETTE.neg }}>
                    {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
                  </div>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{s.caption}</div>
              <div className="mt-2 flex items-center gap-2 text-[11px]">
                <label className="text-[var(--text-muted)]">Multiple</label>
                <input type="number" value={s.mult} onChange={(e) => s.setMult(parseFloat(e.target.value) || 0)} className="input h-7 w-20 px-2 text-[12px] tabular" step={1} min={1} />
                <span className="text-[10px] text-[var(--text-muted)]">× EPS {eps.toFixed(2)}</span>
              </div>
            </div>
          );
        })}
      </div>
      {price != null && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Num label="Entry zone" big={`${ccy} ${entryZone!.toFixed(2)}`} sub="≈ bear case" tone="neutral" />
          <Num label="Trim levels" big={`${ccy} ${trim.toFixed(2)}`} sub="≈ bull case" tone="pos" />
          <Num label="Hard stop" big={`${ccy} ${hardStop!.toFixed(2)}`} sub="-15% from spot" tone="neg" />
        </div>
      )}
    </section>
  );
}

/* ───────────── shared primitives ───────────── */
function Pill({ label, body, highlight }: { label: string; body: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${highlight ? "border-l-4 border-l-warning border-[var(--line)] bg-[var(--surface-2)]" : "border-[var(--line)] bg-[var(--surface-2)]"}`}>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-[12.5px] leading-relaxed">{body}</div>
    </div>
  );
}

function Num({ label, big, sub, tone }: { label: string; big: string; sub?: string; tone?: "pos" | "neg" | "neutral" }) {
  const c = tone === "pos" ? { color: PALETTE.pos } : tone === "neg" ? { color: PALETTE.neg } : {};
  return (
    <div className="card p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className="tabular mt-1 text-[18px] font-semibold leading-tight" style={c}>{big}</div>
      {sub && <div className="text-[10.5px] text-[var(--text-muted)]">{sub}</div>}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
      }}
      className="btn h-8 px-2.5 text-[11px]"
      title="Copy to WhatsApp"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : label}
    </button>
  );
}

function DownloadButton({ targetRef, filename }: { targetRef: React.RefObject<HTMLDivElement>; filename: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        if (!targetRef.current) return;
        setBusy(true);
        try {
          const dataUrl = await htmlToImage.toPng(targetRef.current, {
            backgroundColor: "#141824", // matches our soft tooltip background
            pixelRatio: 2,
          });
          const a = document.createElement("a");
          a.href = dataUrl; a.download = filename;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
        } catch {}
        setBusy(false);
      }}
      className="btn h-8 px-2.5 text-[11px]"
      title="Download PNG"
    >
      <Download size={12} /> {busy ? "..." : "PNG"}
    </button>
  );
}

/* ───────────── formatters ───────────── */
function fmtNum(n: number | null): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toFixed(2);
}
function fmtBigNum(n: number | null): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}
