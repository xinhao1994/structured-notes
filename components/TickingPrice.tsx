"use client";
// Renders a price that visibly "ticks" — a brief green/red background flash
// + arrow on every change, and a subtle pulsing glow when the market is open
// so the eye knows the value is live (vs a delayed snapshot).

import clsx from "clsx";
import { ArrowUp, ArrowDown } from "lucide-react";
import { usePriceTick } from "@/lib/hooks/usePriceTick";
import { formatPx } from "@/lib/calc";

interface Props {
  price: number | null | undefined;
  currency?: string;
  /** Whether the price's home market is currently open. Drives the pulse glow. */
  marketOpen?: boolean;
  /** Tailwind classes for the price text itself (font-size, weight, etc.). */
  className?: string;
  /** Render small vertical-stacked layout (price + tiny arrow under) for tight cells. */
  compact?: boolean;
}

export function TickingPrice({ price, currency, marketOpen, className, compact }: Props) {
  const dir = usePriceTick(price);
  return (
    <span
      className={clsx(
        "tabular relative inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors duration-300",
        dir === "up" && "tick-up",
        dir === "down" && "tick-down",
        marketOpen && !dir && "live-glow",
        className,
      )}
    >
      <span>{formatPx(price ?? undefined, currency)}</span>
      {dir === "up" && (
        <ArrowUp size={compact ? 10 : 11} className="text-success" />
      )}
      {dir === "down" && (
        <ArrowDown size={compact ? 10 : 11} className="text-danger" />
      )}
    </span>
  );
}
