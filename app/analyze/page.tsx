"use client";

// Stock Analyze — single-stock research dashboard.
// Designed for the RM to brief clients on WhatsApp. Sections:
//   1. Background       — friendly hook + company info (Malaysia ties when relevant)
//   2. Fundamentals     — 4-number snapshot (price/PE/growth/cash)
//   3. Earnings history — last 4 quarters: beat / miss with chart
//   4. Price chart      — 5y weekly chart, downloadable PNG
//   5. Scenarios        — 4-case price targets (bear / base / bull / stretched bull)
// Each section has a Copy button (WhatsApp-ready text) and charts have PNG download.

import { useEffect, useMemo, useRef, useState } from "react";
import { LineChart, Search, AlertTriangle, Copy, Check, Download, Building2, Calendar, TrendingUp, BarChart3, Target, Sparkles, MapPin, ExternalLink } from "lucide-react";
import {
  LineChart as RLineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, BarChart, Bar, Cell, CartesianGrid, ReferenceLine,
} from "recharts";
import * as htmlToImage from "html-to-image";
import { STOCK_HOOKS, genericHook } from "@/lib/stockHooks";
import type { MarketCode } from "@/lib/types";

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
  profile: { sector: string | null; industry: string | null; country: string | null; city: string | null; state: string | null; website: string | null; fullTimeEmployees: number | null; summary: string | null; };
  snapshot: { longName: string; exchange: string | null; currency: string | null; price: number | null; marketCap: number | null; high52: number | null; low52: number | null; dividendYield: number | null; beta: number | null; perf30d: number | null; };
  fundamentals: { forwardPE: number | null; trailingPE: number | null; pegRatio: number | null; enterpriseValue: number | null; evRevenue: number | null; evEbitda: number | null; profitMargin: number | null; operatingMargin: number | null; revenueGrowth: number | null; earningsGrowth: number | null; totalCash: number | null; totalDebt: number | null; sharesOutstanding: number | null; epsTrailing: number | null; epsForward: number | null; };
  income: Array<{ year: number; revenue: number; netIncome: number | null }>;
  earnings: Array<{ quarter: string; estimate: number | null; actual: number | null; surprisePct: number | null; verdict: "beat" | "miss" | "inline" | null }>;
  priceHistory: Array<{ t: number; c: number }>;
}

export default function AnalyzePage() {
  const [input, setInput] = useState("NVDA");
  const [market, setMarket] = useState<MarketCode>("US");
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

  // Load NVDA by default on first mount so the page feels alive.
  useEffect(() => { load("NVDA", "US"); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const s = input.trim().toUpperCase();
    if (!s) return;
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
          Single-stock dashboard with friendly explanations + WhatsApp-ready copy. Tap any section&apos;s <em>Copy</em> to share with your client.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="card mb-3 flex flex-wrap items-end gap-2 p-3">
        <label className="block flex-1 min-w-[120px]">
          <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Ticker</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            placeholder="e.g. NVDA, AAPL, 9988"
            className="input mt-1 font-mono"
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
            Try a different ticker or market. For HK use the 4-digit code (e.g. 9988 with HK market).
          </p>
        </div>
      )}

      {data && !loading && (
        <>
          <BackgroundCard data={data} />
          <FundamentalsCard data={data} />
          <EarningsCard data={data} />
          <PriceChartCard data={data} />
          <ScenariosCard data={data} />
        </>
      )}

      <p className="mt-3 text-[11px] text-[var(--text-muted)]">
        Data source: Yahoo Finance. Fundamentals refresh quarterly; price history is weekly close over 5 years.
        Hooks and explanations are templates — review before sending to clients.
      </p>
    </>
  );
}

/* ───────────── BACKGROUND CARD ───────────── */

function BackgroundCard({ data }: { data: Profile }) {
  const hook = STOCK_HOOKS[data.symbol];
  const intro = hook?.hook ?? genericHook(data.snapshot.longName, data.profile.summary);
  const hq = [data.profile.city, data.profile.state, data.profile.country].filter(Boolean).join(", ");
  const wa = useMemo(() => {
    const lines: string[] = [];
    lines.push(`📊 *${data.snapshot.longName}* (${data.symbol})`);
    lines.push("");
    lines.push(intro);
    lines.push("");
    lines.push("*What they do:*");
    lines.push(hook?.whatTheyDo ?? (data.profile.summary?.slice(0, 280) ?? "—"));
    if (hook?.familiarProducts?.length) {
      lines.push("");
      lines.push("*Familiar products:* " + hook.familiarProducts.join(" · "));
    }
    if (hook?.malaysiaTie) {
      lines.push("");
      lines.push("🇲🇾 *Malaysia connection:* " + hook.malaysiaTie);
    }
    if (hq) lines.push("\n*Headquarters:* " + hq);
    if (data.profile.sector) lines.push(`*Sector:* ${data.profile.sector}${data.profile.industry ? ` · ${data.profile.industry}` : ""}`);
    if (data.profile.fullTimeEmployees) lines.push(`*Employees:* ${data.profile.fullTimeEmployees.toLocaleString()}`);
    return lines.join("\n");
  }, [data, hook, intro, hq]);

  return (
    <section className="card mb-3 p-4">
      <header className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <Building2 size={11} className="mr-1 inline" />
            Background
          </div>
          <h2 className="text-lg font-semibold">{data.snapshot.longName}</h2>
          <div className="text-[11px] text-[var(--text-muted)]">{data.symbol} · {data.snapshot.exchange ?? data.market} · {data.snapshot.currency ?? ""}</div>
        </div>
        <CopyButton text={wa} label="Copy to client" />
      </header>

      <div className="rounded-xl border border-l-4 border-l-accent border-[var(--line)] bg-[var(--surface-2)] p-3 text-[13.5px] leading-relaxed">
        <Sparkles size={13} className="float-left mr-1.5 mt-0.5 text-accent" />
        {intro}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Pill label="What they do" body={hook?.whatTheyDo ?? data.profile.summary?.slice(0, 260) ?? "—"} />
        {hook?.familiarProducts?.length ? (
          <Pill label="Products you might know" body={
            <ul className="list-disc pl-4 marker:text-accent">
              {hook.familiarProducts.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          } />
        ) : null}
        {hook?.malaysiaTie && (
          <Pill label="🇲🇾 Malaysia connection" body={hook.malaysiaTie} highlight />
        )}
        <Pill label="Headquarters" body={
          <div className="flex items-center gap-1.5">
            <MapPin size={12} className="text-[var(--text-muted)]" />
            <span>{hq || "—"}</span>
          </div>
        } />
        <Pill label="Sector / industry" body={
          <span>
            {data.profile.sector ?? "—"}
            {data.profile.industry && <span className="text-[var(--text-muted)]"> · {data.profile.industry}</span>}
          </span>
        } />
        <Pill label="Employees" body={data.profile.fullTimeEmployees != null ? data.profile.fullTimeEmployees.toLocaleString() : "—"} />
        {data.profile.website && (
          <Pill label="Website" body={
            <a href={data.profile.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              {data.profile.website.replace(/^https?:\/\//, "")} <ExternalLink size={11} />
            </a>
          } />
        )}
      </div>
    </section>
  );
}

/* ───────────── FUNDAMENTALS CARD ───────────── */

function FundamentalsCard({ data }: { data: Profile }) {
  const f = data.fundamentals; const s = data.snapshot;
  const fmtCcy = (n: number | null) => n == null ? "—" : (data.snapshot.currency || "USD") + " " + fmtNum(n);
  const fmtBig = (n: number | null) => n == null ? "—" : (data.snapshot.currency || "USD") + " " + fmtBigNum(n);
  const fmtPct = (n: number | null) => n == null ? "—" : `${(n * 100).toFixed(1)}%`;
  const fmtX = (n: number | null) => n == null ? "—" : `${n.toFixed(1)}×`;
  const fmtPctSigned = (n: number | null) => n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

  // Fair-value verdict heuristic — for client briefing, NOT investment advice.
  // Compares fwd P/E vs the trailing P/E and the growth rate (PEG-like).
  const verdict = useMemo(() => {
    if (f.forwardPE == null) return null;
    if (f.pegRatio != null) {
      if (f.pegRatio < 1) return { tone: "below", label: "Looks below fair value", note: `PEG ${f.pegRatio.toFixed(2)} (< 1.0 = growth not fully priced in).` };
      if (f.pegRatio < 1.5) return { tone: "at", label: "Looks around fair value", note: `PEG ${f.pegRatio.toFixed(2)} (1.0-1.5 typical).` };
      return { tone: "above", label: "Looks above fair value", note: `PEG ${f.pegRatio.toFixed(2)} (> 1.5 = priced for high growth).` };
    }
    if (f.forwardPE < 15) return { tone: "below", label: "Looks below fair value", note: `Fwd P/E ${f.forwardPE.toFixed(1)} (< 15 = cheap on earnings).` };
    if (f.forwardPE < 25) return { tone: "at", label: "Looks around fair value", note: `Fwd P/E ${f.forwardPE.toFixed(1)} (15-25 typical).` };
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
    lines.push(`📈 Revenue growth (last Q vs prior Q): ${fmtPctSigned(f.revenueGrowth != null ? f.revenueGrowth * 100 : null)}`);
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
            <BarChart3 size={11} className="mr-1 inline" />
            Fundamentals — what it&apos;s worth
          </div>
          <h2 className="text-lg font-semibold">Snapshot in 4 numbers</h2>
        </div>
        <CopyButton text={wa} label="Copy" />
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Num label="Price" big={fmtCcy(s.price)} sub={`Cap ${fmtBig(s.marketCap)}`} />
        <Num label="30-day move" big={fmtPctSigned(s.perf30d)} sub={`52w ${fmtNum(s.low52)} – ${fmtNum(s.high52)}`} tone={s.perf30d != null ? (s.perf30d >= 0 ? "pos" : "neg") : "neutral"} />
        <Num label="Forward P/E" big={fmtX(f.forwardPE)} sub={`EV/Sales ${fmtX(f.evRevenue)}`} />
        <Num label="Revenue growth (last Q)" big={f.revenueGrowth != null ? `${f.revenueGrowth >= 0 ? "+" : ""}${(f.revenueGrowth * 100).toFixed(1)}%` : "—"} sub={`EPS gr. ${fmtPctSigned(f.earningsGrowth != null ? f.earningsGrowth * 100 : null)}`} tone={f.revenueGrowth != null ? (f.revenueGrowth >= 0 ? "pos" : "neg") : "neutral"} />
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

/* ───────────── EARNINGS HISTORY CARD ───────────── */

function EarningsCard({ data }: { data: Profile }) {
  const rows = data.earnings.filter((r) => r.estimate != null || r.actual != null);
  const ref = useRef<HTMLDivElement>(null);

  const wa = useMemo(() => {
    if (!rows.length) return `📊 ${data.symbol}: No recent earnings history available.`;
    const lines: string[] = [];
    lines.push(`📊 *${data.symbol} — Last ${rows.length} quarters earnings*`);
    lines.push("");
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
            <TrendingUp size={11} className="mr-1 inline" />
            Earnings track record
          </div>
          <h2 className="text-lg font-semibold">Beat or miss — last {rows.length || 0} quarters</h2>
        </div>
        <div className="flex gap-1.5">
          <DownloadButton targetRef={ref} filename={`${data.symbol}-earnings.png`} />
          <CopyButton text={wa} label="Copy" />
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="text-[12.5px] text-[var(--text-muted)]">No recent earnings data available for this ticker.</p>
      ) : (
        <div ref={ref} className="rounded-xl bg-[var(--surface)] p-2">
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                <XAxis dataKey="quarter" tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
                <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
                <Tooltip
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", fontSize: 12 }}
                  formatter={(v: any) => (typeof v === "number" ? v.toFixed(2) : v)}
                />
                <ReferenceLine y={0} stroke="var(--text-muted)" />
                <Bar dataKey="actual" radius={[4, 4, 0, 0]}>
                  {rows.map((r, i) => (
                    <Cell key={i} fill={
                      r.verdict === "beat" ? "var(--success)" :
                      r.verdict === "miss" ? "var(--danger)" :
                      "var(--text-muted)"
                    } />
                  ))}
                </Bar>
                <Bar dataKey="estimate" fill="var(--text-muted)" opacity={0.25} radius={[4, 4, 0, 0]} />
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
                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                  r.verdict === "beat" ? "bg-success/15 text-success" :
                  r.verdict === "miss" ? "bg-danger/15 text-danger" :
                  r.verdict === "inline" ? "bg-[var(--surface-2)] text-[var(--text-muted)]" :
                  "bg-[var(--surface-2)] text-[var(--text-muted)]"
                }`}>
                  {r.verdict === "beat" ? "✓ Beat" : r.verdict === "miss" ? "✗ Miss" : r.verdict === "inline" ? "= Inline" : "—"}
                  {r.surprisePct != null && (
                    <span className="ml-1 font-normal opacity-75">{r.surprisePct >= 0 ? "+" : ""}{r.surprisePct.toFixed(1)}%</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/* ───────────── PRICE CHART CARD ───────────── */

function PriceChartCard({ data }: { data: Profile }) {
  const ref = useRef<HTMLDivElement>(null);
  const series = data.priceHistory.map((p) => ({
    d: new Date(p.t).toISOString().slice(0, 7),
    c: p.c,
  }));
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
            Total return: <strong className={totalReturn >= 0 ? "text-success" : "text-danger"}>{totalReturn >= 0 ? "+" : ""}{totalReturn.toFixed(0)}%</strong>
          </div>
        </div>
        <div className="flex gap-1.5">
          <DownloadButton targetRef={ref} filename={`${data.symbol}-5y-price.png`} />
          <CopyButton text={wa} label="Copy" />
        </div>
      </header>

      <div ref={ref} className="rounded-xl bg-[var(--surface)] p-2">
        <div style={{ width: "100%", height: 240 }}>
          <ResponsiveContainer>
            <RLineChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
              <XAxis dataKey="d" tick={{ fontSize: 10, fill: "var(--text-muted)" }} interval={Math.floor(series.length / 8)} />
              <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} domain={["auto", "auto"]} />
              <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", fontSize: 12 }} />
              <Line type="monotone" dataKey="c" stroke="var(--accent)" strokeWidth={2} dot={false} />
            </RLineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

/* ───────────── SCENARIOS CARD ───────────── */

function ScenariosCard({ data }: { data: Profile }) {
  // 4-case price targets, based on the user's prompt-3 framework:
  //   Bear (3-6m), Base (6-12m), Bull (12-18m), Stretched Bull (24m).
  // We anchor each on forwardEPS × a multiple, with sensible defaults around
  // the trailing P/E. User can adjust multiples in the inputs.
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
        <p className="mt-2 text-[12.5px] text-[var(--text-muted)]">EPS data unavailable for this ticker — scenarios cannot be computed.</p>
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
  const entryZone = price != null ? targets[0].target : null;       // bear ≈ entry zone
  const trim = targets[2].target;
  const hardStop = price != null ? price * 0.85 : null;             // 15% drawdown as default stop

  const wa = useMemo(() => {
    const lines: string[] = [];
    lines.push(`🎯 *${data.symbol} — 4-scenario price targets*`);
    lines.push(`(based on EPS ${eps.toFixed(2)} × multiple)`);
    lines.push("");
    for (const t of targets) {
      lines.push(`*${t.label}* (${t.horizon}): ${ccy} ${t.target.toFixed(2)} — ${t.mult}× EPS — ${t.caption}`);
    }
    if (price != null) {
      lines.push("");
      lines.push("📍 *Plan:*");
      if (entryZone != null) lines.push(`Entry zone: around ${ccy} ${entryZone.toFixed(2)} (bear case)`);
      lines.push(`Trim levels: around ${ccy} ${trim.toFixed(2)} (bull case)`);
      if (hardStop != null) lines.push(`Hard stop: ${ccy} ${hardStop.toFixed(2)} (-15% from spot — thesis broken)`);
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
            Anchored on EPS <strong>{eps.toFixed(2)}</strong> × multiple. Adjust multiples below.
          </div>
        </div>
        <CopyButton text={wa} label="Copy" />
      </header>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {targets.map((s) => {
          const upside = price != null ? ((s.target - price) / price) * 100 : null;
          const toneRing =
            s.tone === "bear" ? "border-l-danger" :
            s.tone === "base" ? "border-l-accent" :
            s.tone === "bull" ? "border-l-success" :
            "border-l-success";
          return (
            <div key={s.label} className={`rounded-xl border border-l-4 ${toneRing} border-[var(--line)] bg-[var(--surface-2)] p-3`}>
              <div className="flex items-center justify-between">
                <div className="text-[12px] font-semibold uppercase tracking-wider">{s.label}</div>
                <div className="text-[10px] text-[var(--text-muted)]">{s.horizon}</div>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <div className="tabular text-2xl font-semibold">{ccy} {s.target.toFixed(2)}</div>
                {upside != null && (
                  <div className={`text-[12px] font-semibold ${upside >= 0 ? "text-success" : "text-danger"}`}>
                    {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
                  </div>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{s.caption}</div>
              <div className="mt-2 flex items-center gap-2 text-[11px]">
                <label className="text-[var(--text-muted)]">Multiple</label>
                <input
                  type="number"
                  value={s.mult}
                  onChange={(e) => s.setMult(parseFloat(e.target.value) || 0)}
                  className="input h-7 w-20 px-2 text-[12px] tabular"
                  step={1}
                  min={1}
                />
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
  const c = tone === "pos" ? "text-success" : tone === "neg" ? "text-danger" : "";
  return (
    <div className="card p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className={`tabular mt-1 text-[18px] font-semibold leading-tight ${c}`}>{big}</div>
      {sub && <div className="text-[10.5px] text-[var(--text-muted)]">{sub}</div>}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true); setTimeout(() => setCopied(false), 1800);
        } catch {}
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
            backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--surface") || "#fff",
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
