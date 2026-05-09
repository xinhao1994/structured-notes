"use client";

import {
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
import type { PriceQuote, Tranche } from "@/lib/types";
import { koProbabilityHeuristic, currentKoLevel } from "@/lib/calc";

interface Props {
  tranche: Tranche;
  quotes: Record<string, PriceQuote | undefined>;
}

export function Analytics({ tranche, quotes }: Props) {
  const koProb = koProbabilityHeuristic(tranche, quotes);
  const ko = currentKoLevel(tranche);

  // distance-to-EKI bar series — % above (positive) or below (negative) EKI
  const distEki = tranche.underlyings.map((u) => {
    const q = quotes[u.symbol];
    const init = tranche.initialFixing?.[u.symbol];
    if (!q || !init) return { name: u.symbol, distance: 0 };
    const ki = init * tranche.ekiPct;
    return { name: u.symbol, distance: +(((q.price - ki) / ki) * 100).toFixed(2) };
  });

  return (
    <section className="card mt-4 p-4">
      <header className="mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Visual analytics
        </div>
        <h3 className="text-base font-semibold">Tranche health</h3>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Gauge label="KO probability (heuristic)" value={koProb} hint={ko ? `Next KO ${(ko.koPct * 100).toFixed(0)}% on ${ko.date}` : ""} />
        <Gauge
          label="Performance gauge"
          value={Math.max(0, Math.min(100, 100 - koProb))}
          hint="Higher = more cushion above current KO"
          color="#137a4a"
        />

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Distance to EKI (per underlying)
          </div>
          <div className="mt-1 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distEki} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="currentColor" />
                <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} stroke="currentColor" />
                <Tooltip
                  formatter={(v: number) => [`${v}%`, "Above EKI"]}
                  contentStyle={{ borderRadius: 10, fontSize: 12 }}
                />
                <ReferenceLine y={0} stroke="currentColor" strokeDasharray="3 3" />
                <Bar dataKey="distance" fill="#0a3a66" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}

function Gauge({
  label,
  value,
  hint,
  color = "#0a3a66",
}: {
  label: string;
  value: number;
  hint?: string;
  color?: string;
}) {
  const data = [{ name: "v", value, fill: color }];
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </div>
      <div className="relative h-40">
        <ResponsiveContainer>
          <RadialBarChart
            innerRadius="70%"
            outerRadius="100%"
            barSize={14}
            data={data}
            startAngle={210}
            endAngle={-30}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar background={{ fill: "rgba(0,0,0,.06)" }} dataKey="value" cornerRadius={9} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="tabular text-2xl font-semibold">{value}%</div>
          {hint && <div className="text-[10px] text-[var(--text-muted)]">{hint}</div>}
        </div>
      </div>
    </div>
  );
}
