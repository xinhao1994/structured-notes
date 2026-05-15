// GET /api/news
//
// Fetches general market news from Finnhub and returns up to 12 headlines
// sorted by impact + recency. Items mentioning high-priority keywords get
// a "breaking: true" flag so the UI can highlight them differently.
//
// Uses the FINNHUB_API_KEY you already have set. Cached at the edge for
// 5 minutes — major-impact news doesn't change minute-by-minute.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FinnhubNewsItem {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  image?: string;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
}

interface NewsItem {
  id: string;
  headline: string;
  source: string;
  url: string;
  timestamp: number;        // ms since epoch
  breaking: boolean;
  category: string;
}

// Keywords that flag a headline as "breaking" (high market impact).
// Case-insensitive. Tune over time.
const BREAKING_RX = /\b(earnings|fomc|fed|powell|rate cut|rate hike|inflation|cpi|tariff|trump|biden|xi|jinping|war|sanction|opec|nvidia|apple|microsoft|breaking|halt|crash|merger|acqui|bankrupt|china)\b/i;

export async function GET(_req: NextRequest) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) {
    return NextResponse.json({ items: [], reason: "FINNHUB_API_KEY not set" }, { status: 200 });
  }
  try {
    const r = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${key}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });
    if (!r.ok) return NextResponse.json({ items: [], reason: `Finnhub ${r.status}` }, { status: 200 });
    const raw = (await r.json()) as FinnhubNewsItem[];
    if (!Array.isArray(raw)) return NextResponse.json({ items: [] });

    const items: NewsItem[] = raw
      .filter((n) => n.headline && n.url)
      .map((n) => ({
        id: String(n.id ?? `${n.datetime ?? 0}-${(n.headline ?? "").slice(0, 40)}`),
        headline: (n.headline ?? "").trim(),
        source: n.source ?? "",
        url: n.url ?? "#",
        timestamp: (n.datetime ?? 0) * 1000,
        breaking: BREAKING_RX.test(n.headline ?? ""),
        category: n.category ?? "general",
      }))
      // Skip headlines older than 36 hours — stale news isn't "breaking".
      .filter((n) => Date.now() - n.timestamp < 36 * 3600 * 1000)
      // Sort breaking-first, then newest.
      .sort((a, b) => {
        if (a.breaking !== b.breaking) return a.breaking ? -1 : 1;
        return b.timestamp - a.timestamp;
      })
      .slice(0, 12);

    return new NextResponse(JSON.stringify({ items }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        // 5-minute edge cache + 1-hour stale-while-revalidate
        "cache-control": "public, s-maxage=300, stale-while-revalidate=3600",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ items: [], reason: e?.message ?? "fetch failed" }, { status: 200 });
  }
}
