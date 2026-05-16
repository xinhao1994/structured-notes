"use client";

// Pocket — saved tranches.
// Streamlined per user request:
//   - No risk-distribution bar (was visual noise)
//   - No currency/risk/maturity filters (was over-engineered)
//   - No backup/restore JSON card (will be replaced with Google login)
//   - Single filter row: tranche-picker dropdown + name/symbol search
//   - 2-column grid max; each card is row-oriented for easy phone scanning

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search, Trash2, Pin, PinOff, Pencil, Check, X, Share2,
  Wallet, Calendar, StickyNote, ExternalLink,
} from "lucide-react";
import {
  listPocket, removePocket, togglePin, updateTrancheFields, type PocketEntry,
} from "@/lib/storage";
import { DailyObsBanner, EnableDailyAlertsButton } from "@/components/DailyObsBanner";
import { getSupabaseBrowser } from "@/lib/supabaseClient";
import { encodeTranche } from "@/lib/trancheShare";
import { useQuotes } from "@/lib/hooks/useQuotes";
import { assessRisk, currentKoLevel, formatPx } from "@/lib/calc";
import type { MarketCode, RiskBand } from "@/lib/types";
import clsx from "clsx";

export default function PocketPage() {
  const [list, setList] = useState<PocketEntry[]>([]);
  const [q, setQ] = useState("");                 // free-text search
  const [pickedId, setPickedId] = useState("");   // dropdown selection (empty = all)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [notesEditingId, setNotesEditingId] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState<string>("");

  useEffect(() => { setList(listPocket()); }, []);

  // Collect every underlying so useQuotes can fetch live prices in one batch.
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: { symbol: string; market: MarketCode }[] = [];
    for (const e of list) {
      for (const u of e.tranche.underlyings) {
        const k = `${u.market}:${u.symbol}`;
        if (!seen.has(k)) { seen.add(k); out.push({ symbol: u.symbol, market: u.market }); }
      }
    }
    return out;
  }, [list]);
  const { quotes, loading, asOf, refresh } = useQuotes(items, 30_000);

  // Enrich each entry with the risk + KO + maturity values needed for display.
  const enriched = useMemo(() => {
    return list.map((e) => {
      const t = { ...e.tranche };
      if (!t.initialFixing) {
        const fix: Record<string, number> = {};
        for (const u of t.underlyings) {
          const px = quotes[u.symbol]?.prevClose ?? quotes[u.symbol]?.price;
          if (px != null) fix[u.symbol] = px;
        }
        t.initialFixing = fix;
      }
      const r = assessRisk(t, quotes);
      const ko = currentKoLevel(t);
      const maturity = computeMaturity(t.tradeDate, t.tenorMonths);
      const daysToMat = daysBetween(new Date().toISOString().slice(0, 10), maturity);
      return { entry: { ...e, tranche: t }, risk: r, ko, maturity, daysToMat };
    });
  }, [list, quotes]);

  // Filter logic — dropdown overrides text search.
  const filtered = enriched
    .filter(({ entry }) => {
      if (pickedId) return entry.id === pickedId;
      if (!q.trim()) return true;
      const needle = q.trim().toLowerCase();
      return (
        entry.tranche.trancheCode.toLowerCase().includes(needle) ||
        entry.tranche.underlyings.some((u) =>
          u.symbol.toLowerCase().includes(needle) ||
          u.rawName.toLowerCase().includes(needle)
        ) ||
        (entry.tranche.notes ?? "").toLowerCase().includes(needle)
      );
    })
    .sort((a, b) => Number(!!b.entry.pinned) - Number(!!a.entry.pinned));

  // Actions
  function handleRemove(id: string) {
    if (!confirm("Remove this tranche from Pocket?")) return;
    removePocket(id); setList(listPocket());
  }
  function handlePin(id: string) { togglePin(id); setList(listPocket()); }
  function startEdit(id: string, currentCode: string) { setEditingId(id); setEditingValue(currentCode); }
  function commitEdit(id: string) {
    const v = editingValue.trim();
    if (v) updateTrancheFields(id, { trancheCode: v });
    setEditingId(null); setList(listPocket());
  }
  function startNotesEdit(id: string, current?: string) { setNotesEditingId(id); setNotesValue(current ?? ""); }
  function commitNotes(id: string) {
    updateTrancheFields(id, { notes: notesValue.trim() || undefined });
    setNotesEditingId(null); setList(listPocket());
  }

  async function handleShareToChat(entry: PocketEntry) {
    const supa = getSupabaseBrowser();
    if (!supa) { alert("Chat not configured (NEXT_PUBLIC_SUPABASE_ANON_KEY missing)."); return; }
    let senderName = "";
    try { senderName = localStorage.getItem("snd.chat.senderName.v1") || ""; } catch {}
    if (!senderName) {
      senderName = prompt("Your name (shown to chat readers):") || "";
      if (!senderName.trim()) return;
      try { localStorage.setItem("snd.chat.senderName.v1", senderName.trim()); } catch {}
    }
    const encoded = encodeTranche(entry.tranche);
    if (encoded.length > 2000) { alert("Tranche too large to share."); return; }
    const { error } = await supa.from("chat_messages").insert({
      sender_name: senderName.trim().slice(0, 32),
      body: encoded,
      attachment_url: null,
      attachment_type: "tranche",
    });
    if (error) alert("Share failed: " + error.message);
    else alert(`Shared ${entry.tranche.trancheCode} to chat.`);
  }

  return (
    <>
      <header className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Watchlist · {enriched.length} saved
          </div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Wallet size={18} /> Pocket
          </h1>
        </div>
        <div className="text-[11px] text-[var(--text-muted)]">
          {loading ? "Refreshing..." : asOf ? `Last ${new Date(asOf).toLocaleTimeString()}` : ""}
          <button onClick={refresh} className="ml-2 underline">refresh</button>
        </div>
      </header>

      {/* Daily-obs banner + enable-alerts button */}
      <DailyObsBanner />
      <div className="mb-3"><EnableDailyAlertsButton /></div>

      {/* Empty state */}
      {enriched.length === 0 && (
        <div className="card p-6 text-center text-[13px] text-[var(--text-muted)]">
          No tranches saved yet.{" "}
          <Link href="/" className="text-accent underline">Parse one on the Desk</Link> and tap{" "}
          <strong>Save to Pocket</strong>.
        </div>
      )}

      {/* Single-row filter: dropdown + search */}
      {enriched.length > 0 && (
        <div className="card mb-3 flex flex-wrap items-center gap-2 p-2.5">
          <select
            value={pickedId}
            onChange={(e) => { setPickedId(e.target.value); setQ(""); }}
            className="input h-9 flex-1 min-w-[120px] text-[12.5px]"
          >
            <option value="">All tranches ({enriched.length})</option>
            {enriched.map(({ entry }) => (
              <option key={entry.id} value={entry.id}>
                {entry.tranche.trancheCode} · {entry.tranche.currency}
              </option>
            ))}
          </select>
          <div className="flex flex-1 items-center gap-1.5 min-w-[120px]">
            <Search size={14} className="text-[var(--text-muted)]" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPickedId(""); }}
              placeholder="Search code, symbol, notes..."
              className="input h-9 flex-1 text-[12.5px]"
            />
          </div>
        </div>
      )}

      {enriched.length > 0 && filtered.length === 0 && (
        <div className="card p-6 text-center text-[13px] text-[var(--text-muted)]">
          No tranches match your filter.
        </div>
      )}

      {/* Tranche grid — 1 col mobile, 2 cols tablet+ */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {filtered.map(({ entry, risk: r, ko, maturity, daysToMat }) => {
          const t = entry.tranche;
          const editing = editingId === entry.id;
          return (
            <article key={entry.id} className="card p-3">
              {/* Header row: tranche code + currency + risk + actions */}
              <header className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    <span>{t.issuer || "Tranche"}</span>
                    <span className="rounded bg-[var(--surface-2)] border border-[var(--line)] px-1 py-[1px]">{t.currency}</span>
                    {entry.pinned && <Pin size={11} className="text-accent" />}
                  </div>
                  {editing ? (
                    <div className="mt-0.5 flex items-center gap-1">
                      <input autoFocus value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value.toUpperCase())}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit(entry.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="input h-7 w-44 px-2 font-mono text-[13px]" />
                      <button onClick={() => commitEdit(entry.id)} className="btn h-7 px-2" title="Save"><Check size={13} /></button>
                      <button onClick={() => setEditingId(null)} className="btn h-7 px-2" title="Cancel"><X size={13} /></button>
                    </div>
                  ) : (
                    <button onClick={() => startEdit(entry.id, t.trancheCode)}
                      className="group flex items-center gap-1 truncate text-left font-mono text-[14.5px] font-semibold hover:text-accent"
                      title="Click to rename">
                      {t.trancheCode}
                      <Pencil size={11} className="opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  )}
                </div>
                {r && (
                  <span className={clsx("badge whitespace-nowrap", r.band)}>
                    {bandLabel(r.band)}
                  </span>
                )}
              </header>

              {/* Row-oriented details — label : value pattern */}
              <div className="space-y-1.5 text-[12px]">
                <Row label="Coupon">{(t.couponPa * 100).toFixed(2)}% p.a.</Row>
                <Row label="Tenor">{t.tenorMonths} months · matures {maturity} ({daysToMat >= 0 ? `${daysToMat}d left` : "matured"})</Row>
                <Row label="Strike / KO / EKI">
                  <span className="font-semibold">{(t.strikePct * 100).toFixed(0)}%</span>
                  <span className="text-[var(--text-muted)]"> · </span>
                  <span className="font-semibold">{(t.koStartPct * 100).toFixed(0)}%</span>
                  <span className="text-[var(--text-muted)]"> · </span>
                  <span className="font-semibold">{(t.ekiPct * 100).toFixed(0)}%</span>
                </Row>
                {ko && (
                  <Row label="Next KO">
                    <span className="font-semibold">{(ko.koPct * 100).toFixed(0)}%</span>
                    <span className="text-[var(--text-muted)]"> on </span>
                    <span className="tabular">{ko.date}</span>
                  </Row>
                )}
                <Row label="Underlyings">
                  <div className="flex flex-wrap gap-1.5">
                    {t.underlyings.map((u) => {
                      const q = quotes[u.symbol];
                      return (
                        <Link
                          key={u.symbol}
                          href={`/analyze?symbol=${encodeURIComponent(u.symbol)}&market=${u.market}`}
                          className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[10.5px] hover:text-accent"
                          title="Open in Analyze"
                        >
                          <span className="font-mono font-semibold">{u.symbol}</span>
                          <span className="tabular text-[var(--text-muted)]">{formatPx(q?.price, q?.currency)}</span>
                        </Link>
                      );
                    })}
                  </div>
                </Row>
              </div>

              {/* Notes — editable inline */}
              <div className="mt-2 border-t border-[var(--line)] pt-2 text-[11.5px]">
                {notesEditingId === entry.id ? (
                  <div className="flex flex-col gap-1.5">
                    <textarea autoFocus value={notesValue}
                      onChange={(e) => setNotesValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitNotes(entry.id);
                        if (e.key === "Escape") setNotesEditingId(null);
                      }}
                      placeholder="Client(s), ticket #, follow-ups, allocation breakdown..."
                      className="input min-h-[60px] py-2 text-[12px] leading-snug" rows={3} />
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => setNotesEditingId(null)} className="btn h-7 px-2 text-[11px]"><X size={12} /> Cancel</button>
                      <button onClick={() => commitNotes(entry.id)} className="btn btn-primary h-7 px-2 text-[11px]"><Check size={12} /> Save</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => startNotesEdit(entry.id, t.notes)}
                    className="group flex w-full items-start gap-1.5 text-left text-[var(--text-muted)] hover:text-[var(--text)]"
                    title="Click to edit notes">
                    <StickyNote size={12} className="mt-0.5 flex-shrink-0" />
                    <span className="flex-1">
                      {t.notes
                        ? <span className="whitespace-pre-wrap">{t.notes}</span>
                        : <span className="italic opacity-70">Add notes — clients, allocation, follow-ups...</span>}
                    </span>
                    <Pencil size={10} className="mt-1 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                )}
              </div>

              {/* Actions — bottom row */}
              <div className="mt-2 flex justify-end gap-1.5 border-t border-[var(--line)] pt-2">
                <button onClick={() => handleShareToChat(entry)} className="btn h-7 px-2 text-[11px] text-accent" title="Share this tranche to team chat">
                  <Share2 size={11} /> Share
                </button>
                <button onClick={() => handlePin(entry.id)} className="btn h-7 px-2 text-[11px]" title={entry.pinned ? "Unpin" : "Pin"}>
                  {entry.pinned ? <PinOff size={11} /> : <Pin size={11} />}
                </button>
                <button onClick={() => handleRemove(entry.id)} className="btn h-7 px-2 text-[11px] text-danger" title="Remove">
                  <Trash2 size={11} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

/** Label : value row used inside each tranche card. Two columns with the
 *  label dimmed in the left ~80px and the value flowing in the rest. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <div className="w-[88px] flex-shrink-0 text-[10.5px] uppercase tracking-wider text-[var(--text-muted)] pt-0.5">{label}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function bandLabel(b: RiskBand) {
  return ({
    safe: "Safe", moderate: "Moderate", "near-ki": "Near KI",
    "near-ko": "Near KO", "high-risk": "High risk", critical: "Critical",
  } as Record<RiskBand, string>)[b];
}

function computeMaturity(tradeDate: string, months: number): string {
  const [y, m, d] = tradeDate.split("-").map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}
