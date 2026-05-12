"use client";

import { useEffect, useMemo, useState } from "react";
import {
  listPocket, getCurrentParsedText, getCalcSettings, setCalcSettings,
  getKnockedOutByTranche,
} from "@/lib/storage";
import { clientCalc, formatCcy, MIN_LOT, validateLot } from "@/lib/calc";
import type { Currency, Tranche } from "@/lib/types";
import { parseTrancheText } from "@/lib/parser";
import { SAMPLE_TRANCHE_TEXT } from "@/lib/sample";
import {
  Calculator, AlertTriangle, CheckCircle2, MessageSquare, RefreshCw, Copy, Check, Trophy,
} from "lucide-react";

const CCYS: Currency[] = ["USD", "HKD", "MYR", "SGD", "JPY", "AUD"];

export default function CalculatorPage() {
  const [pocket, setPocketList] = useState<ReturnType<typeof listPocket>>([]);
  const [sampleTranche, setSampleTranche] = useState<Tranche | null>(null);

  // Hydrate from localStorage after first client render (avoid SSR mismatch).
  useEffect(() => {
    setPocketList(listPocket());
    const text = getCurrentParsedText() ?? SAMPLE_TRANCHE_TEXT;
    setSampleTranche(parseTrancheText(text).tranche);
  }, []);

  const choices = useMemo(() => {
    const items: { id: string; label: string; tranche: Tranche }[] = [];
    if (sampleTranche) {
      items.push({
        id: "sample",
        label: `Current parse · ${sampleTranche.trancheCode}`,
        tranche: sampleTranche,
      });
    }
    for (const p of pocket) {
      items.push({
        id: p.id,
        label: `${p.tranche.trancheCode} · ${p.tranche.currency} · ${(p.tranche.couponPa * 100).toFixed(1)}%`,
        tranche: p.tranche,
      });
    }
    return items;
  }, [sampleTranche, pocket]);

  // Restore last-used state from localStorage (currency/principal/KO obs/template).
  const saved = typeof window !== "undefined" ? getCalcSettings() : {};

  const [trancheId, setTrancheId] = useState<string>(saved.trancheId ?? "sample");
  const tranche = choices.find((c) => c.id === trancheId)?.tranche ?? sampleTranche;

  const [currency, setCurrency] = useState<Currency>((saved.currency as Currency) ?? "USD");
  const [principal, setPrincipal] = useState<number>(saved.principal ?? 0);
  const [knockedOutAt, setKnockedOutAt] = useState<number | null>(saved.knockedOutAt ?? null);
  const [tplIdx, setTplIdx] = useState<number>(saved.msgTemplateIdx ?? 0);
  const [clientName, setClientName] = useState<string>("");
  const [copied, setCopied] = useState(false);

  // When the tranche switches, default currency + principal to that tranche's
  // currency + its min lot, but only if we don't have a stored value for it.
  // Also auto-default `knockedOutAt` to the value detected by Desk's KO
  // schedule (when that tranche has knocked out on a past observation).
  // The user can still override via the dropdown below — auto-default kicks
  // in only on tranche switch.
  useEffect(() => {
    if (!tranche) return;
    if (!saved.currency) setCurrency(tranche.currency);
    if (!saved.principal) setPrincipal(MIN_LOT[tranche.currency]);
    const detected = getKnockedOutByTranche(tranche.trancheCode);
    if (detected != null) setKnockedOutAt(detected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tranche?.trancheCode]);

  // Persist on every change.
  useEffect(() => { setCalcSettings({ trancheId }); }, [trancheId]);
  useEffect(() => { setCalcSettings({ currency }); }, [currency]);
  useEffect(() => { setCalcSettings({ principal }); }, [principal]);
  useEffect(() => { setCalcSettings({ knockedOutAt }); }, [knockedOutAt]);
  useEffect(() => { setCalcSettings({ msgTemplateIdx: tplIdx }); }, [tplIdx]);

  const validation = validateLot(currency, principal);
  const calc = useMemo(
    () => (tranche ? clientCalc(tranche, currency, principal) : null),
    [tranche, currency, principal]
  );

  // KO message generation — only meaningful when knockedOutAt is set.
  const message = useMemo(() => {
    if (!tranche || !calc || !knockedOutAt) return null;
    return buildKoMessage(tranche, currency, principal, knockedOutAt, calc.monthlyCoupon, tplIdx, clientName);
  }, [tranche, calc, currency, principal, knockedOutAt, tplIdx, clientName]);

  async function copyMessage() {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  if (!tranche) {
    return (
      <p className="text-[var(--text-muted)] mt-6 text-center">
        Loading calculator...
      </p>
    );
  }

  return (
    <>
      <header className="mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Proposal builder
        </div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Calculator size={18} /> Client calculator
        </h1>
      </header>

      <section className="card mb-3 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Tranche</span>
            <select
              value={trancheId}
              onChange={(e) => {
                const id = e.target.value;
                setTrancheId(id);
                const t = choices.find((c) => c.id === id)?.tranche;
                if (t) {
                  setCurrency(t.currency);
                  setPrincipal(MIN_LOT[t.currency]);
                  // Pull Desk-detected KO observation # for this tranche, if any.
                  const detected = getKnockedOutByTranche(t.trancheCode);
                  setKnockedOutAt(detected);
                }
              }}
              className="input mt-1"
            >
              {choices.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Currency</span>
            <select
              value={currency}
              onChange={(e) => {
                const c = e.target.value as Currency;
                setCurrency(c);
                if (principal < MIN_LOT[c]) setPrincipal(MIN_LOT[c]);
              }}
              className="input mt-1"
            >
              {CCYS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              Principal · min {formatCcy(currency, MIN_LOT[currency])}
            </span>
            <input
              type="number"
              value={principal || ""}
              min={MIN_LOT[currency]}
              step={1000}
              onChange={(e) => setPrincipal(parseInt(e.target.value, 10) || 0)}
              className="input mt-1 tabular"
            />
          </label>
        </div>

        <div
          className={`mt-3 flex items-center gap-2 rounded-lg border p-2 text-[12.5px] ${
            validation
              ? "border-danger/30 bg-dangerBg text-danger dark:bg-danger/10"
              : "border-success/30 bg-successBg text-success dark:bg-success/10"
          }`}
        >
          {validation ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
          {validation ?? `Meets minimum lot for ${currency}.`}
        </div>
      </section>

      {/* Result cards */}
      {calc && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ResultCard label="Monthly coupon" value={formatCcy(currency, calc.monthlyCoupon)} />
          <ResultCard label="Total coupon (tenor)" value={formatCcy(currency, calc.totalCoupon)} />
          <ResultCard label="Annualized return" value={`${calc.annualizedReturnPct.toFixed(2)}%`} />
          <ResultCard label="Estimated payout" value={formatCcy(currency, calc.estimatedPayout)} />
        </div>
      )}

      {/* ─── KO MESSAGE GENERATOR ─────────────────────────────────────────── */}
      <section className="card mt-4 p-4">
        <header className="mb-3 flex items-center gap-2">
          <Trophy size={16} className="text-success" />
          <h3 className="text-base font-semibold">Knock-out client message</h3>
        </header>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Client name (optional)</span>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Mr Tan"
              className="input mt-1"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              Knocked out at obs #
              {knockedOutAt != null && getKnockedOutByTranche(tranche.trancheCode) === knockedOutAt && (
                <span className="ml-2 rounded-full bg-success/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-success">
                  auto · from Desk
                </span>
              )}
            </span>
            <select
              value={knockedOutAt ?? ""}
              onChange={(e) => setKnockedOutAt(e.target.value ? parseInt(e.target.value, 10) : null)}
              className="input mt-1"
            >
              <option value="">— not yet —</option>
              {Array.from({ length: tranche.tenorMonths }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>Observation #{n}</option>
              ))}
            </select>
          </label>
          <div className="block">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Coupon earned</span>
            <div className="input mt-1 tabular font-semibold flex items-center">
              {knockedOutAt && calc
                ? `${formatCcy(currency, calc.monthlyCoupon * knockedOutAt)} (${knockedOutAt} × ${formatCcy(currency, calc.monthlyCoupon)})`
                : "—"}
            </div>
          </div>
        </div>

        {message ? (
          <div className="mt-3">
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-[13px] leading-relaxed whitespace-pre-wrap">
              {message}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <div className="text-[11px] text-[var(--text-muted)]">
                Style {tplIdx + 1} of {TEMPLATE_COUNT} — {TEMPLATE_NAMES[tplIdx]}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setTplIdx((i) => (i + 1) % TEMPLATE_COUNT)}
                  className="btn h-9 px-3 text-xs"
                  title="Cycle to next message style"
                >
                  <RefreshCw size={14} /> Refresh
                </button>
                <button onClick={copyMessage} className="btn btn-primary h-9 px-3 text-xs">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied!" : "Copy message"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[12px] text-[var(--text-muted)]">
            <MessageSquare size={12} className="inline mr-1" />
            Select which observation the tranche knocked out at to generate a message you can copy to your client.
          </p>
        )}
      </section>

      <section className="card mt-4 p-4">
        <h3 className="mb-2 text-base font-semibold">Scenarios</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {calc && (
            <>
              <ScenarioCard
                tone="positive"
                title="Best case · KO at first observation"
                body={`Receives 1 month coupon (${formatCcy(currency, calc.monthlyCoupon)}) + principal. Annualized ${(calc.annualizedReturnPct).toFixed(1)}% never crystallises.`}
              />
              <ScenarioCard
                tone="neutral"
                title="Base case · runs to maturity"
                body={`All ${tranche.tenorMonths} coupons paid: ${formatCcy(currency, calc.totalCoupon)}. Final payout ${formatCcy(currency, calc.estimatedPayout)}.`}
              />
              <ScenarioCard
                tone="negative"
                title="Worst case · KI breached, no recovery"
                body={`Coupons retained ${formatCcy(currency, calc.totalCoupon)}; principal redemption ≈ ${formatCcy(currency, calc.worstCasePayout - calc.totalCoupon)}. Net ${formatCcy(currency, calc.worstCasePayout)}.`}
              />
            </>
          )}
        </div>
      </section>

      <p className="mt-3 text-[11px] text-[var(--text-muted)]">
        Calculations assume coupons paid monthly per market convention; no FX. Best/worst-case are stylised
        proposal illustrations, not pricing — final payoff is determined by the issuer's term sheet.
      </p>
    </>
  );
}

function ResultCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className="tabular mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function ScenarioCard({
  title, body, tone,
}: { title: string; body: string; tone: "positive" | "neutral" | "negative"; }) {
  const ring =
    tone === "positive" ? "border-l-4 border-l-success" :
    tone === "negative" ? "border-l-4 border-l-danger" :
    "border-l-4 border-l-accent";
  return (
    <div className={`rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 ${ring}`}>
      <div className="text-[12px] font-semibold">{title}</div>
      <div className="mt-1 text-[12px] text-[var(--text-muted)]">{body}</div>
    </div>
  );
}

// ─── client-message templates ──────────────────────────────────────────────
// Multiple wordings cycled by the Refresh button. Layman → professional →
// brief → detailed → congratulatory → neutral.

const TEMPLATE_NAMES = [
  "Client-friendly (default)",
  "Friendly / layman",
  "Professional / formal",
  "Brief / SMS-style",
  "Detailed breakdown",
  "Congratulatory",
  "Neutral status update",
];
const TEMPLATE_COUNT = TEMPLATE_NAMES.length;

function buildKoMessage(
  t: Tranche,
  ccy: Currency,
  principal: number,
  obsN: number,
  monthlyCoupon: number,
  templateIdx: number,
  clientName: string,
): string {
  const couponEarned = monthlyCoupon * obsN;
  const totalPayout = principal + couponEarned;
  const annPct = principal > 0 ? (couponEarned / principal) * (12 / obsN) * 100 : 0;
  const sumPct = principal > 0 ? (couponEarned / principal) * 100 : 0;
  const monthsWord = obsN === 1 ? "month" : "months";
  const obsOrdinal = ordinal(obsN);
  const fc = (n: number) => formatCcy(ccy, n);
  const greet = clientName ? clientName : "valued client";
  const greetCap = clientName ? clientName : "Valued Client";

  // Helpers for the per-month coupon breakdown in the default template.
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const tradeD = new Date(t.tradeDate + "T00:00:00Z");
  const tradeMonth = monthNames[tradeD.getUTCMonth()];
  const tradeYear = tradeD.getUTCFullYear();
  // Currency symbol the way RMs typically write it (MYR -> "RM").
  const ccySym = ccy === "MYR" ? "RM" : ccy;
  const flag = ccy === "MYR" ? "🇲🇾" : ccy === "USD" ? "🇺🇸" : ccy === "HKD" ? "🇭🇰" :
               ccy === "SGD" ? "🇸🇬" : ccy === "JPY" ? "🇯🇵" : "🇦🇺";
  // Format principal as "100k" when it's a round multiple of 1000; else full number.
  const principalLabel = principal % 1000 === 0 && principal >= 1000
    ? `${(principal / 1000).toLocaleString("en-US")}k`
    : principal.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const cfmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Build per-month coupon breakdown (month after trade -> KO observation month).
  const couponLines: string[] = [];
  for (let i = 1; i <= obsN; i++) {
    const d = new Date(tradeD);
    d.setUTCMonth(d.getUTCMonth() + i);
    const m = monthNames[d.getUTCMonth()];
    const y = d.getUTCFullYear();
    couponLines.push(`${m} ${y} coupon : ${ccySym} ${cfmt(monthlyCoupon)} ✅`);
  }
  // Underlyings list — strip any "(Long Name)" annotation for readability.
  const underlyingList = t.underlyings
    .map((u) => `  ${u.rawName.replace(/\s*\([^)]*\)/, "")}`)
    .join("\n");

  switch (templateIdx % TEMPLATE_COUNT) {
    case 0: // ★ Client-friendly default — coupon-by-month breakdown with ✅
      return `Morning ${greetCap}, good news!

The below tranche has knocked out and total earned coupon as below:

${t.trancheCode}
${ccySym} ${flag}
${underlyingList}
Tenor ${t.tenorMonths} months
Coupon ${(t.couponPa * 100).toFixed(1)}% p.a.
Strike ${(t.strikePct * 100).toFixed(0)}%
KO ${(t.koStartPct * 100).toFixed(0)}%, monthly stepdown ${(t.koStepdownPct * 100).toFixed(0)}%
EKI ${(t.ekiPct * 100).toFixed(0)}%

${couponLines.join("\n")}

Coupon total 🟰 ${ccySym} ${cfmt(couponEarned)}

Credit back total :
${ccySym} ${principalLabel} + ${ccySym} ${cfmt(couponEarned)} = ${ccySym} ${cfmt(totalPayout)}

Good news 👍🏻 this above tranche we did on ${tradeMonth} ${tradeYear} has knocked out / early terminated 😉`;

    case 1: // Friendly / layman
      return `Hi ${greet}! 🎉

Great news — your structured note (${t.trancheCode}) has been automatically redeemed at observation #${obsN}, which means it matured early at a profit!

You've earned ${obsN} ${monthsWord} of coupon: ${fc(couponEarned)} on top of your ${fc(principal)} principal. Your full ${fc(totalPayout)} is being returned to your account.

In simple terms: the underlying stocks performed well, so the bank pays you back early with a nice yield. That's a ${sumPct.toFixed(2)}% return in just ${obsN} ${monthsWord} (annualised ${annPct.toFixed(2)}%).

Let me know if you'd like to look at similar opportunities — happy to walk you through them.`;

    case 2: // Professional / formal
      return `Dear ${greetCap},

We are pleased to inform you that your structured product tranche ${t.trancheCode} has triggered an early redemption (knock-out event) at observation #${obsN}.

Total coupon income earned across ${obsN} monthly periods: ${fc(couponEarned)}, representing an annualised return of ${annPct.toFixed(2)}% (${sumPct.toFixed(2)}% absolute).

Principal of ${fc(principal)} together with accrued coupons (total ${fc(totalPayout)}) will be credited to your settlement account in due course.

Please do not hesitate to contact me should you wish to discuss reinvestment opportunities.

Kind regards.`;

    case 3: // Brief / SMS-style
      return `Hi ${greet}, tranche ${t.trancheCode} has knocked out at obs #${obsN}. Coupon earned: ${fc(couponEarned)} over ${obsN} ${monthsWord}. Principal ${fc(principal)} + coupon = ${fc(totalPayout)} returning soon. Annualised ${annPct.toFixed(2)}%.`;

    case 4: // Detailed breakdown
      return `Update on your tranche ${t.trancheCode}:

✅ Status: Knocked out (early redemption) at observation #${obsN}
📅 Observation: ${obsOrdinal} monthly observation
💰 Coupon income: ${obsN} × ${fc(monthlyCoupon)} = ${fc(couponEarned)}
💵 Principal returned: ${fc(principal)}
📈 Total proceeds: ${fc(totalPayout)}
📊 Return: ${sumPct.toFixed(2)}% over ${obsN} ${monthsWord} (annualised ${annPct.toFixed(2)}%)

Funds will be settled to your account per the original T+${t.settlementOffset} schedule. Let me know once you'd like to review redeployment options.`;

    case 5: // Congratulatory
      return `Congratulations ${greetCap}! 🎊

Your structured note tranche ${t.trancheCode} has just achieved an early redemption (auto-call) at the ${obsOrdinal} observation. This is an excellent outcome — you're now entitled to ${obsN} ${monthsWord} of coupon payments totalling ${fc(couponEarned)}, in addition to your full principal of ${fc(principal)} being returned.

That works out to a ${sumPct.toFixed(2)}% return realised in just ${obsN} ${monthsWord} — an annualised ${annPct.toFixed(2)}%. A strong result for your portfolio.

Looking forward to discussing the next opportunity with you.`;

    case 6: // Neutral status update
      return `Tranche ${t.trancheCode} — status update:

Knocked out at observation #${obsN}. Coupon income earned: ${fc(couponEarned)} (${obsN} ${monthsWord} × ${fc(monthlyCoupon)}). Principal returned in full: ${fc(principal)}. Total payout: ${fc(totalPayout)}. Realised return ${sumPct.toFixed(2)}% / annualised ${annPct.toFixed(2)}%.

Settlement per T+${t.settlementOffset}. Reach out for redeployment options.`;

    default:
      return "";
  }
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
