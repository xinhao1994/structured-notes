"use client";

import clsx from "clsx";
import type { PriceQuote, Tranche } from "@/lib/types";
import { koSchedule, formatPx, memorisedKOCheck } from "@/lib/calc";
import { useObservationCloses } from "@/lib/hooks/useObservationCloses";
import { useDetectedKO } from "@/lib/hooks/useDetectedKO";

interface Props {
  tranche: Tranche;
  quotes: Record<string, PriceQuote | undefined>;
}

export function KOSchedule({ tranche, quotes }: Props) {
  const sched = koSchedule(tranche);
  const today = new Date().toISOString().slice(0, 10);
  const showInitialFx = !!tranche.initialFixing;
  const nextN = sched.find((x) => x.date >= today)?.n;

  // Fetch the OFFICIAL CLOSE on every past observation date — per market
  // session (US session for US stocks, HK for HK, etc.). Intraday wicks
  // don't trigger KO; only the local-market close on the obs date matters.
  const { closes: obsCloses, pending: closesPending, missing: closesMissing } =
    useObservationCloses(tranche);

  // Run KO detection. The hook persists the detected obs # to storage so
  // the Calculator can read it. We don't need to use its return value
  // here — the per-row badges below recompute from `obsCloses` directly.
  // Mounting this hook is what triggers the side-effect write.
  useDetectedKO(tranche);

  // Compute the memorised-KO state for past observations only.
  // We use this to render per-underlying "memorised" markers + a "Memorised
  // KO" badge on the observation where the last underlying finally touched.
  const pastClosesOnly = (() => {
    const out: Record<number, Record<string, { close: number }>> = {};
    for (const o of sched) {
      if (o.date >= today) continue;
      if (obsCloses[o.n]) out[o.n] = obsCloses[o.n];
    }
    return out;
  })();
  const memo = memorisedKOCheck(tranche, pastClosesOnly);

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

      {closesPending && (
        <div className="mb-2 rounded-lg border border-accent/30 bg-accent-50 px-2 py-1 text-[11px] text-[var(--text-muted)] dark:bg-accent-900/20">
          Fetching official closes on past observation dates...
        </div>
      )}
      {closesMissing.length > 0 && !closesPending && (
        <div className="mb-2 rounded-lg border border-warning/30 bg-[var(--surface-2)] px-2 py-1 text-[11px] text-[var(--text-muted)]">
          Could not fetch close for {closesMissing.length} (obs/symbol) pair{closesMissing.length > 1 ? "s" : ""}. Status for those observations falls back to live spot — verify manually.
        </div>
      )}

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
                      KO px · close-vs-trigger
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
              const obsData = obsCloses[o.n];

              // Per-underlying delta. For PAST observations, prefer the
              // historical close on the obs date — the official trigger
              // input. For FUTURE observations there's no close yet, so
              // we show the live spot as a "would-KO" indicator.
              const perSym = tranche.underlyings.map((u) => {
                const koPx = o.koPriceBySymbol[u.symbol];
                const histClose = past ? obsData?.[u.symbol]?.close : undefined;
                const live = quotes[u.symbol]?.price;
                const pxForCompare = past ? histClose : live;
                const delta =
                  koPx != null && pxForCompare != null
                    ? ((pxForCompare - koPx) / koPx) * 100
                    : undefined;
                return { u, koPx, pxForCompare, histClose, live, delta };
              });

              const valid = perSym.filter((p) => p.delta != null) as Array<typeof perSym[number] & { delta: number }>;
              const worst = valid.length ? valid.reduce((a, b) => (a.delta < b.delta ? a : b)) : null;
              // For past obs, "Knocked out" only confirms when we have closes
              // for ALL underlyings — partial data means we can't be sure
              // the worst-of triggered.
              const allResolvedPast = past && perSym.every((p) => p.histClose != null);

              return (
                <tr key={o.n} className={clsx(isNext && "bg-accent-50 dark:bg-accent-900/30")}>
                  <td className="tabular">{o.n}</td>
                  <td className="tabular">{o.date}</td>
                  <td className="tabular font-medium">{(o.koPct * 100).toFixed(0)}%</td>
                  {showInitialFx &&
                    perSym.map(({ u, koPx, delta, histClose }) => {
                      // First-touched obs for this underlying — if it equals
                      // the current row's obs number, this row is where the
                      // memory was set. Show a "memorised" tag.
                      const firstTouched = memo.firstTouchedAt[u.symbol];
                      const memorisedAtThisRow = past && firstTouched === o.n;
                      const memorisedEarlier = past && firstTouched != null && firstTouched < o.n;
                      return (
                      <td key={u.symbol} className="tabular">
                        <div>{formatPx(koPx)}</div>
                        {past && histClose != null && (
                          <div className="text-[10px] text-[var(--text-muted)]">
                            close {formatPx(histClose)}
                          </div>
                        )}
                        {memorisedAtThisRow && (
                          <div className="mt-0.5 inline-block rounded-full bg-warning/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-warning">
                            🔒 Touched & memorised
                          </div>
                        )}
                        {memorisedEarlier && (
                          <div className="mt-0.5 inline-block rounded-full bg-[var(--surface)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--text-muted)]" title={`Already memorised from obs #${firstTouched}`}>
                            ✓ Memorised (obs #{firstTouched})
                          </div>
                        )}
                        {delta != null && (
                          <div
                            className={clsx(
                              "text-[10.5px] font-semibold",
                              delta >= 0 ? "text-success" : "text-danger"
                            )}
                            title={
                              past
                                ? delta >= 0
                                  ? `Close on ${o.date} was ${delta.toFixed(2)}% above this KO trigger — knocked out at this obs.`
                                  : `Close on ${o.date} was ${Math.abs(delta).toFixed(2)}% below this KO trigger — did NOT knock out at this obs.`
                                : delta >= 0
                                  ? `Spot is ${delta.toFixed(2)}% above this KO trigger — would knock out if observation were today.`
                                  : `Spot is ${Math.abs(delta).toFixed(2)}% below this KO trigger — would NOT knock out today.`
                            }
                          >
                            {delta >= 0 ? "▲ +" : "▼ "}{delta.toFixed(2)}%
                          </div>
                        )}
                      </td>
                      );
                    })}
                  <td>
                    {past && memo.memorisedKOAtObs === o.n ? (
                      <span className="badge safe" title="All underlyings have now been memorised as touched — tranche knocked out under the memory rule.">
                        🔒 Memorised KO
                      </span>
                    ) : past ? (
                      allResolvedPast && worst && worst.delta >= 0 ? (
                        <span className="badge safe" title={`Worst-of (${worst.u.symbol}) closed at/above the KO trigger on ${o.date}.`}>
                          Knocked out
                        </span>
                      ) : allResolvedPast && worst ? (
                        <span className="badge moderate" title={`Worst-of (${worst.u.symbol}) closed ${Math.abs(worst.delta).toFixed(2)}% below the KO trigger on ${o.date} — no autocall.`}>
                          Survived
                        </span>
                      ) : worst ? (
                        // Partial historical data — fall back to live-spot estimate but label it.
                        <span
                          className="badge moderate"
                          title={`Historical close incomplete for this obs. Live-spot worst-of (${worst.u.symbol}) is ${worst.delta >= 0 ? "above" : Math.abs(worst.delta).toFixed(2) + "% below"} the KO trigger.`}
                        >
                          {worst.delta >= 0 ? "Likely KO" : "Likely survived"}
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

      <p className="mt-2 text-[10.5px] text-[var(--text-muted)] leading-relaxed">
        Past observations use the OFFICIAL close on the obs date in each underlying&apos;s home session
        (US session for US stocks, HK session for HK stocks, etc.) — intraday dips don&apos;t trigger KO. Future
        observations show live spot as a &quot;would-KO&quot; indicator.
        <br /><br />
        <strong>🔒 Memorised KO rule:</strong> each underlying remembers its first close above KO. Even if it
        later falls back below, it stays &ldquo;touched&rdquo;. The tranche knocks out at the observation where the
        LAST underlying finally touches — so partial touches across different observations still add up to a
        full KO. &ldquo;Touched &amp; memorised&rdquo; is the first time a stock crosses; &ldquo;Memorised
        (obs #N)&rdquo; means it was already locked-in from an earlier obs.
      </p>
    </section>
  );
}
