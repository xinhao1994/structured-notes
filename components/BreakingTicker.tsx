"use client";

// Single-line news banner that rotates one headline at a time. Lives under
// the market-price ticker in the header. Designed NOT to compete with the
// scrolling price ticker — a second auto-scroll would be confusing. A
// rotating fade is what Bloomberg + CNBC use for breaking text.

import { useEffect, useState } from "react";
import clsx from "clsx";

const ROTATE_MS = 7000;     // 7s per headline
const FADE_MS = 350;
const POLL_MS = 5 * 60_000; // refresh the headline list every 5 min

interface NewsItem {
  id: string;
  headline: string;
  source: string;
  url: string;
  timestamp: number;
  breaking: boolean;
  category: string;
}

function relTime(ms: number): string {
  if (!ms) return "";
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function BreakingTicker() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [fading, setFading] = useState(false);

  // Fetch + refresh
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/news");
        if (!r.ok) return;
        const j = await r.json() as { items: NewsItem[] };
        if (cancelled) return;
        if (Array.isArray(j.items)) setItems(j.items);
      } catch {}
    }
    load();
    const id = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Rotate the current headline. Triggers a brief fade-out, swap, fade-in.
  useEffect(() => {
    if (items.length <= 1) return;
    const id = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setIdx((i) => (i + 1) % items.length);
        setFading(false);
      }, FADE_MS);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [items.length]);

  if (items.length === 0) return null;
  const item = items[idx];

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 border-t border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[11.5px] no-underline transition-opacity duration-300"
      style={{ opacity: fading ? 0 : 1 }}
      title={`${item.source} · ${relTime(item.timestamp)} — tap to read`}
    >
      <span
        className={clsx(
          "flex h-1.5 w-1.5 flex-shrink-0 rounded-full",
          item.breaking ? "bg-danger animate-pulse" : "bg-accent",
        )}
      />
      <span
        className={clsx(
          "flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider",
          item.breaking ? "bg-danger/15 text-danger" : "bg-accent/10 text-accent",
        )}
      >
        {item.breaking ? "Breaking" : "News"}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-[var(--text)]">
        {item.headline}
      </span>
      <span className="flex-shrink-0 text-[10px] text-[var(--text-muted)]">
        {item.source}
      </span>
    </a>
  );
}
