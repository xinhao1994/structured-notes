"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Wallet, Calculator, LineChart } from "lucide-react";
import clsx from "clsx";

// 4-tab nav. Analyze = single-stock research dashboard for RM client briefs.
const tabs = [
  { href: "/", label: "Desk", icon: LayoutDashboard },
  { href: "/pocket", label: "Pocket", icon: Wallet },
  { href: "/calculator", label: "Calc", icon: Calculator },
  { href: "/analyze", label: "Analyze", icon: LineChart },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[var(--surface)]/95 backdrop-blur-md">
      <div className="mx-auto grid max-w-6xl grid-cols-4 px-1 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5">
        {tabs.map((t) => {
          const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={clsx(
                "flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium",
                active ? "text-accent dark:text-[var(--accent)]" : "text-[var(--text-muted)]"
              )}
            >
              <Icon size={20} className={active ? "stroke-[2.4]" : ""} />
              <span>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
