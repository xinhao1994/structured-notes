"use client";

import clsx from "clsx";
import type { PriceQuote, Tranche } from "@/lib/types";
import { koSchedule, formatPx } from "@/lib/calc";

interface Props {
  tranche: Tranche;
  quotes: Record<string, PriceQuote | undefined>;
}

export function KOSchedule({ tranche, quotes }: Props) {
  const sched = koSchedule(tranche);
  const today = new Date().toISOString().slice(0, 10);
  const showInitialFx = !!tranche.initialFixing;
  const nextN = sched.find((x) => x.date >= today)?.n;

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
          start {(tranche.koStartPct * 100).toFixed(0)}% · stepdown -{(tranche.koStepdownPct * 100).toFixed(0)}% / obs
        </div>
      </header>

      <div className="scroll-x">
        <table className="bank-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Valuation date</th>
              <th>KO level</th>
              {showInitialFx &&
                tranche.underlyings.map((u) => (
                  <th key={u.symbol} className="!text-right">
                    {u.symbol}
                    <div className="text-[9px] font-normal normal-case tracking-normal text-[var(--text-muted)]">
                      KO px - live delta
                    </div>
                  </th>
                ))}
              <th>Worst-of</th>
            </tr>
          </thead>
          <tbody>
            {sched.map((o) => {
              const past = o.date < today;
              const isNext = o.n === nextN;

              const perSym = tranche.underlyings.map((u) => {
                const koPx = o.koPriceBySymbol[u.symbol];
                const live = quotes[u.symbol]?.price;
                const delta =
                  koPx != null && live != null
                    ? ((live - koPx) / koPx) * 100
                    : undefined;
                return { u, koPx, live, delta };
              });

              const valid = perSym.filter((p) => p.delta != null) as Array<typeof perSym[number] & { delta: number }>;
              const worst = valid.length ? valid.reduce((a, b) => (a.delta < b.delta ? a : b)) : null;

              return (
                <tr key={o.n} className={clsx(isNext && "bg-accent-50 dark:bg-accent-900/30")}>
                  <td className="tabular">{o.n}</td>
                  <td className="tabular">{o.date}</td>
                  <td className="tabular font-medium">{(o.koPct * 100).toFixed(0)}%</td>
                  {showInitialFx &&
                    perSym.map(({ u, koPx, delta }) => (
                      <td key={u.symbol} className="tabular">
                        <div>{formatPx(koPx)}</div>
                        {delta != null && (
                          <div
                            className={clsx(
                              "text-[10.5px] font-semibold",
                              delta >= 0 ? "text-success" : "text-danger"
                            )}
                            title={
                              delta >= 0
                                ? `Spot is ${delta.toFixed(2)}% above this KO trigger - would knock out at this observation.`
                                : `Spot is ${Math.abs(delta).toFixed(2)}% below this KO trigger - would NOT knock out at this observation.`
                            }
                          >
                            {delta >= 0 ? "▲ +" : "▼ "}{delta.toFixed(2)}%
                          </div>
                        )}
                      </td>
                    ))}
                  <td>
                    {past ? (
                      worst && worst.delta >= 0 ? (
                        <span className="badge safe" title={`Worst-of (${worst.u.symbol}) is currently above this KO trigger.`}>
                          Knocked out
                        </span>
                      ) : worst ? (
                        <span className="badge moderate" title={`Worst-of (${worst.u.symbol}) is ${Math.abs(worst.delta).toFixed(2)}% below this KO trigger — no autocall at this obs.`}>
                          Survived
                        </span>
                      ) : (
                        <span className="badge moderate">Passed</span>
                      )
                    ) : worst ? (
                      <span
                        className={clsx(
                          "badge",
                          worst.delta >= 0
                            ? "safe"
                            : worst.delta >= -5
                            ? "near-ko"
                            : worst.delta >= -15
                            ? "moderate"
                            : "high-risk"
                        )}
                      >
                        {worst.delta >= 0 ? "Would KO" : "Short by"}{" "}
                        {Math.abs(worst.delta).toFixed(2)}%
                        <span className="ml-1 text-[10px] font-normal opacity-75">({worst.u.symbol})</span>
                      </span>
                    ) : (
                      <span className="badge moderate">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[10.5px] text-[var(--text-muted)]">
        For each observation, the per-underlying column shows the KO price plus the current spot's distance from it
        (▲ = above KO, ▼ = below KO). The Worst-of badge is driven by the underlying with the smallest cushion -
        autocall only triggers when all underlyings are at or above their KO levels on the observation date.
      </p>
    </section>
  );
}
