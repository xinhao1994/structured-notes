"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Wallet, Calculator, LineChart, Brain, Banknote, MessageCircle } from "lucide-react";
import clsx from "clsx";

// 7-tab nav. WF = Wealth Financing cash-flow comparison tool.
const tabs = [
  { href: "/", label: "Desk", icon: LayoutDashboard },
  { href: "/pocket", label: "Pocket", icon: Wallet },
  { href: "/calculator", label: "Calc", icon: Calculator },
  { href: "/analyze", label: "Analyze", icon: LineChart },
  { href: "/wayne", label: "Wayne", icon: Brain },
  { href: "/wf", label: "WF", icon: Banknote },
  { href: "/chat", label: "Chat", icon: MessageCircle },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[var(--surface)]/95 backdrop-blur-md">
      <div className="mx-auto grid max-w-6xl grid-cols-7 px-1 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5">
        {tabs.map((t) => {
          const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={clsx(
                "relative flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10.5px] font-medium transition-colors duration-150",
                active ? "text-[var(--accent)]" : "text-[var(--text-muted)]"
              )}
            >
              {/* Active pill highlight */}
              {active && (
                <span
                  className="absolute inset-x-0.5 top-0.5 bottom-0.5 rounded-xl"
                  style={{ background: "color-mix(in srgb, var(--accent) 13%, transparent)" }}
                />
              )}
              <Icon
                size={19}
                className={clsx(
                  "relative z-10 transition-transform duration-200",
                  active ? "stroke-[2.4] scale-110" : ""
                )}
              />
              <span className="relative z-10">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
