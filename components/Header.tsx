"use client";

import { useEffect, useState } from "react";
import { Moon, Sun, Briefcase } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { malaysiaNowParts, marketSnapshots } from "@/lib/markets";
import type { MarketCode } from "@/lib/types";
import clsx from "clsx";

const FLAG: Record<MarketCode, string> = {
  US: "🇺🇸",
  HK: "🇭🇰",
  MY: "🇲🇾",
  SG: "🇸🇬",
  JP: "🇯🇵",
  AU: "🇦🇺",
};

export function Header() {
  const { theme, toggle } = useTheme();
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const my = malaysiaNowParts(now);
  const snaps = marketSnapshots(now);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--surface)]/80 backdrop-blur-md">
      {/* Row 1 — brand, MY clock, theme toggle */}
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
            <Briefcase size={16} />
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-wide">SN Desk</div>
            <div className="text-[10px] uppercase tracking-[.12em] text-[var(--text-muted)]">
              Structured Notes
            </div>
          </div>
        </div>

        <div className="hidden items-center gap-3 sm:flex">
          <div className="text-right leading-tight">
            <div className="text-[13px] font-medium">{my.date}</div>
            <div className="tabular text-[11px] text-[var(--text-muted)]">
              {my.time} · MY ({my.tz})
            </div>
          </div>
        </div>

        <button
          onClick={toggle}
          className="btn h-9"
          aria-label="Toggle theme"
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      {/* Row 2 — market strip (mobile-friendly horizontal scroll) */}
      <div className="scroll-x border-t border-[var(--line)]">
        <div className="mx-auto flex w-max max-w-6xl items-stretch gap-0 px-4 sm:px-6">
          {snaps.map((s) => (
            <div
              key={s.code}
              className="flex min-w-[150px] items-center gap-2 border-r border-[var(--line)] px-3 py-2 last:border-r-0"
            >
              <span aria-hidden className="text-base">{FLAG[s.code]}</span>
              <div className="leading-tight">
                <div className="text-[11px] font-semibold uppercase tracking-wide">
                  {s.code}
                  <span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]">
                    {s.currency}
                  </span>
                </div>
                <div className="tabular text-[11px] text-[var(--text-muted)]">
                  {s.localDate} · {s.localTime}
                </div>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <span className={clsx("live-dot", !s.open && "closed")} />
                <span className={clsx(
                  "text-[10px] font-semibold uppercase tracking-wide",
                  s.open ? "text-success" : "text-danger"
                )}>
                  {s.open ? "Open" : labelFor(s.reason)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* MY clock for narrow screens */}
      <div className="border-t border-[var(--line)] sm:hidden">
        <div className="mx-auto max-w-6xl px-4 py-1.5 text-[11px] tabular text-[var(--text-muted)]">
          {my.date} · {my.time} · MY
        </div>
      </div>
    </header>
  );
}

function labelFor(r: string): string {
  switch (r) {
    case "weekend": return "Weekend";
    case "holiday": return "Holiday";
    case "lunch": return "Lunch";
    case "pre": return "Pre-mkt";
    case "post": return "Closed";
    default: return "Closed";
  }
}
