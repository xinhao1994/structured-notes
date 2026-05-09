"use client";

import clsx from "clsx";
import type { Tranche } from "@/lib/types";
import { koSchedule, formatPx } from "@/lib/calc";

interface Props {
  tranche: Tranche;
}

export function KOSchedule({ tranche }: Props) {
  const sched = koSchedule(tranche);
  const today = new Date().toISOString().slice(0, 10);
  const showInitialFx = !!tranche.initialFixing;

  return (
    <section className="card mt-4 p-4">
      <header className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Auto-call schedule
          </div>
          <h3 className="text-base font-semibold">Knock-out observations</h3>
        </div>
        <div className="text-[11px] text-[var(--text-muted)]">
          start {(tranche.koStartPct * 100).toFixed(0)}% · stepdown −{(tranche.koStepdownPct * 100).toFixed(0)}% / obs
        </div>
      </header>

      <div className="scroll-x">
        <table className="bank-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Valuation date</th>
              <th>KO level</th>
              {showInitialFx && tranche.underlyings.map((u) => <th key={u.symbol}>KO @ {u.symbol}</th>)}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sched.map((o) => {
              const status: "past" | "next" | "future" =
                o.date < today ? "past" : (sched.find((x) => x.date >= today)?.n === o.n ? "next" : "future");
              return (
                <tr key={o.n} className={clsx(status === "next" && "bg-accent-50 dark:bg-accent-900/30")}>
                  <td className="tabular">{o.n}</td>
                  <td className="tabular">{o.date}</td>
                  <td className="tabular font-medium">{(o.koPct * 100).toFixed(0)}%</td>
                  {showInitialFx &&
                    tranche.underlyings.map((u) => (
                      <td key={u.symbol} className="tabular">
                        {formatPx(o.koPriceBySymbol[u.symbol])}
                      </td>
                    ))}
                  <td>
                    <span
                      className={clsx(
                        "badge",
                        status === "past" ? "moderate" : status === "next" ? "near-ko" : "safe"
                      )}
                    >
                      {status === "past" ? "Passed" : status === "next" ? "Next" : "Upcoming"}
                    </span>
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
