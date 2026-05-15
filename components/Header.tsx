"use client";

import { useEffect, useState } from "react";
import { Moon, Sun, Briefcase } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { malaysiaNowParts, marketSnapshots } from "@/lib/markets";
import type { MarketCode } from "@/lib/types";
import clsx from "clsx";
import { BreakingTicker } from "@/components/BreakingTicker";

const FLAG: Record<MarketCode, string> = {
  US: "🇺🇸", HK: "🇭🇰", MY: "🇲🇾", SG: "🇸🇬", JP: "🇯🇵", AU: "🇦🇺",
};

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

interface Snap {
  code: MarketCode;
  currency: string;
  localTime: string;
  localDate: string;
  open: boolean;
  reason: string;
}

function TickerCell({ s }: { s: Snap }) {
  return (
    <div className="flex min-w-[170px] items-center gap-2 border-r border-[var(--line)] px-3 py-2">
      <span aria-hidden className="text-base">{FLAG[s.code]}</span>
      <div className="leading-tight">
        <div className="text-[11px] font-semibold uppercase tracking-wide">
          {s.code}
          <span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]">{s.currency}</span>
        </div>
        <div className="tabular text-[11px] text-[var(--text-muted)]">{s.localDate} · {s.localTime}</div>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <span className={clsx("live-dot", !s.open && "closed")} />
        <span className={clsx("text-[10px] font-semibold uppercase tracking-wide", s.open ? "text-success" : "text-danger")}>
          {s.open ? "Open" : labelFor(s.reason)}
        </span>
      </div>
    </div>
  );
}

export function Header() {
  const { theme, toggle } = useTheme();
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const my = malaysiaNowParts(now);
  const snaps = marketSnapshots(now) as Snap[];

  return (
    <header
      className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--surface)]/80 backdrop-blur-md"
      // On installed iOS PWAs the page extends UNDER the Dynamic Island /
      // notch / status bar. Without this padding the brand + theme toggle
      // sit inside that 50px-tall cutout area where touches don't register.
      // env(safe-area-inset-top) returns 0 on platforms without a notch,
      // so this is a no-op on desktop and Android.
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* Row 1 — brand, MY clock, theme toggle */}
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
            <Briefcase size={16} />
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-wide">SN Desk</div>
            <div className="text-[10px] uppercase tracking-[.12em] text-[var(--text-muted)]">Structured notes</div>
          </div>
        </div>

        <div className="hidden items-center gap-3 sm:flex">
          <div className="text-right leading-tight">
            <div className="text-[13px] font-medium">{my.date}</div>
            <div className="tabular text-[11px] text-[var(--text-muted)]">{my.time} · MY ({my.tz})</div>
          </div>
        </div>

        <button onClick={toggle} className="btn h-9" aria-label="Toggle theme" title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      {/* Row 2 — Bloomberg-style auto-scrolling market ticker */}
      <div className="ticker-strip border-t border-[var(--line)]">
        <div className="ticker-track">
          {/* Two copies of the full market list, in a single inline-flex track,
              translated -50% over the keyframe — yields a seamless infinite loop. */}
          {snaps.map((s) => <TickerCell key={`a-${s.code}`} s={s} />)}
          {snaps.map((s) => <TickerCell key={`b-${s.code}`} s={s} />)}
        </div>
      </div>

      {/* Row 3 — Breaking-news rotator. Single-line headline, ~7s fade
          rotation. Avoids a second scrolling ticker (which would compete
          with the prices above for the eye's attention). Bloomberg/CNBC
          use exactly this pattern for breaking text. */}
      <BreakingTicker />

      {/* MY clock for narrow screens */}
      <div className="border-t border-[var(--line)] sm:hidden">
        <div className="mx-auto max-w-6xl px-4 py-1.5 text-[11px] tabular text-[var(--text-muted)]">
          {my.date} · {my.time} · MY
        </div>
      </div>
    </header>
  );
}
