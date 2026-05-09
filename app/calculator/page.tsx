"use client";

import { useMemo, useState } from "react";
import { listPocket } from "@/lib/storage";
import { clientCalc, formatCcy, MIN_LOT, validateLot } from "@/lib/calc";
import type { Currency, Tranche } from "@/lib/types";
import { parseTrancheText } from "@/lib/parser";
import { SAMPLE_TRANCHE_TEXT } from "@/lib/sample";
import { Calculator, AlertTriangle, CheckCircle2 } from "lucide-react";

const CCYS: Currency[] = ["USD", "HKD", "MYR", "SGD", "JPY", "AUD"];

export default function CalculatorPage() {
  const pocket = typeof window !== "undefined" ? listPocket() : [];
  const sampleTranche = parseTrancheText(SAMPLE_TRANCHE_TEXT).tranche;
  const choices: { id: string; label: string; tranche: Tranche }[] = [
    { id: "sample", label: `Sample · ${sampleTranche.trancheCode}`, tranche: sampleTranche },
    ...pocket.map((p) => ({
      id: p.id,
      label: `${p.tranche.trancheCode} · ${p.tranche.currency} · ${(p.tranche.couponPa * 100).toFixed(1)}%`,
      tranche: p.tranche,
    })),
  ];

  const [trancheId, setTrancheId] = useState<string>(choices[0]?.id ?? "sample");
  const tranche = choices.find((c) => c.id === trancheId)?.tranche ?? sampleTranche;

  const [currency, setCurrency] = useState<Currency>(tranche.currency);
  const [principal, setPrincipal] = useState<number>(MIN_LOT[tranche.currency]);

  const validation = validateLot(currency, principal);
  const calc = useMemo(() => clientCalc(tranche, currency, principal), [tranche, currency, principal]);

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
              value={principal}
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ResultCard label="Monthly coupon" value={formatCcy(currency, calc.monthlyCoupon)} />
        <ResultCard label="Total coupon (tenor)" value={formatCcy(currency, calc.totalCoupon)} />
        <ResultCard label="Annualized return" value={`${calc.annualizedReturnPct.toFixed(2)}%`} />
        <ResultCard label="Estimated payout" value={formatCcy(currency, calc.estimatedPayout)} />
      </div>

      <section className="card mt-4 p-4">
        <h3 className="mb-2 text-base font-semibold">Scenarios</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone: "positive" | "neutral" | "negative";
}) {
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
