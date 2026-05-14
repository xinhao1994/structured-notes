"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import Link from "next/link";
import { Copy, FileImage, FileText, Pencil, Check, X, RotateCcw, LineChart } from "lucide-react";
import * as htmlToImage from "html-to-image";
import jsPDF from "jspdf";
import type { Tranche, PriceQuote } from "@/lib/types";
import { tableRows, formatPx } from "@/lib/calc";
import { TickingPrice } from "@/components/TickingPrice";
import { isMarketOpen } from "@/lib/markets";

interface Props {
  tranche: Tranche;
  quotes: Record<string, PriceQuote | undefined>;
  /** Called when the user manually overrides an initial fixing (pass null to clear). */
  onOverrideFixing?: (symbol: string, value: number | null) => void;
}

export interface ProductTableHandle {
  exportPng: () => Promise<void>;
  exportPdf: () => Promise<void>;
  copyTsv: () => Promise<void>;
}

async function captureFullTable(node: HTMLElement): Promise<string> {
  const scrollEl = node.querySelector<HTMLElement>(".scroll-x");
  const tableEl = node.querySelector<HTMLElement>("table");
  const fullWidth = Math.max(tableEl?.scrollWidth ?? 0, scrollEl?.scrollWidth ?? 0, node.scrollWidth);
  const prev = {
    nodeWidth: node.style.width,
    scrollOverflow: scrollEl?.style.overflow ?? "",
    scrollWidth: scrollEl?.style.width ?? "",
  };
  if (scrollEl) { scrollEl.style.overflow = "visible"; scrollEl.style.width = `${fullWidth}px`; }
  node.style.width = `${fullWidth}px`;
  // Use the ACTUAL theme background colour so the canvas matches the dark
  // surface in dark mode, not a hardcoded white. Falls back to the
  // computed --surface CSS var; if unavailable, falls back to white.
  const surfaceVar = getComputedStyle(document.documentElement)
    .getPropertyValue("--surface").trim();
  const bg = surfaceVar || getComputedStyle(node).backgroundColor || "#ffffff";
  try {
    return await htmlToImage.toPng(node, {
      backgroundColor: bg, pixelRatio: 2, width: fullWidth,
      style: { width: `${fullWidth}px` }, cacheBust: true,
    });
  } finally {
    node.style.width = prev.nodeWidth;
    if (scrollEl) { scrollEl.style.overflow = prev.scrollOverflow; scrollEl.style.width = prev.scrollWidth; }
  }
}

export const ProductTable = forwardRef<ProductTableHandle, Props>(function ProductTable(
  { tranche, quotes, onOverrideFixing },
  ref
) {
  const tableRef = useRef<HTMLDivElement>(null);
  const rows = tableRows(tranche, quotes);
  const [editingSym, setEditingSym] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  async function doExportPng() {
    if (!tableRef.current) return;
    const dataUrl = await captureFullTable(tableRef.current);
    download(dataUrl, `${tranche.trancheCode}.png`);
  }
  async function doExportPdf() {
    if (!tableRef.current) return;
    const dataUrl = await captureFullTable(tableRef.current);
    const img = new Image();
    img.src = dataUrl;
    await new Promise((r) => (img.onload = r));
    const isLandscape = img.width >= img.height;
    const pdf = new jsPDF({ orientation: isLandscape ? "landscape" : "portrait", unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 30, titleH = 24;
    const availW = pageW - 2 * margin;
    const availH = pageH - 2 * margin - titleH;
    const ratio = img.width / img.height;
    let drawW = availW; let drawH = drawW / ratio;
    if (drawH > availH) { drawH = availH; drawW = drawH * ratio; }
    const offX = margin + (availW - drawW) / 2;
    pdf.setFontSize(11);
    pdf.text(`Tranche ${tranche.trancheCode}`, margin, margin);
    pdf.addImage(dataUrl, "PNG", offX, margin + titleH, drawW, drawH);
    pdf.save(`${tranche.trancheCode}.pdf`);
  }
  async function doCopyTsv() {
    const header = ["Stock", "Initial Fixing", "Live Price", "Δ vs Initial", "52W High", "52W Low", "EKI Price", "Strike Price"].join("\t");
    const lines = rows.map((r) => {
      const delta = r.initial && r.live ? `${(((r.live - r.initial) / r.initial) * 100).toFixed(2)}%` : "";
      return [
        `${r.underlying.rawName} ${r.underlying.market}`,
        r.initial ?? "", r.live ?? "", delta,
        r.high52 ?? "", r.low52 ?? "", r.eki ?? "", r.strike ?? "",
      ].join("\t");
    });
    try { await navigator.clipboard.writeText([header, ...lines].join("\n")); } catch {}
  }

  useImperativeHandle(ref, () => ({
    exportPng: doExportPng, exportPdf: doExportPdf, copyTsv: doCopyTsv,
  }));

  function startEdit(sym: string, current: number | undefined) {
    setEditingSym(sym);
    setEditValue(current != null ? String(current) : "");
  }
  function commitEdit(sym: string) {
    const v = parseFloat(editValue);
    if (isFinite(v) && v > 0) onOverrideFixing?.(sym, v);
    setEditingSym(null);
  }
  function clearOverride(sym: string) {
    onOverrideFixing?.(sym, null);
    setEditingSym(null);
  }

  return (
    <section className="card overflow-hidden" id="product-table">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Tranche {tranche.trancheCode} · {tranche.currency}
          </div>
          <h3 className="text-base font-semibold">Underlying basket</h3>
        </div>
        <div className="no-print flex gap-2">
          <button onClick={doExportPng} className="btn h-9 px-3 text-xs" title="Export full table as PNG"><FileImage size={14} /> PNG</button>
          <button onClick={doExportPdf} className="btn h-9 px-3 text-xs" title="Export full table as PDF"><FileText size={14} /> PDF</button>
          <button onClick={doCopyTsv} className="btn h-9 px-3 text-xs" title="Copy table as TSV"><Copy size={14} /> Copy</button>
        </div>
      </header>

      {/* No more forced bg-white — the theme-aware bank-table CSS handles
          surface colour, zebra striping, sticky header, and hover state.
          PNG/PDF export still works (html-to-image captures whatever's on
          screen, so the dark theme exports as-is, which actually looks more
          professional than the old white version). */}
      <div ref={tableRef} className="bg-[var(--surface)]">
        <div className="scroll-x">
          <table className="bank-table">
            <thead>
              <tr>
                <th>Stock</th>
                <th>Initial Fixing</th>
                <th>Live Price</th>
                <th>Δ vs Initial</th>
                <th>52-Week High</th>
                <th>52-Week Low</th>
                <th>EKI Price</th>
                <th>Strike Price</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ki = r.eki;
                const aboveKi = r.live != null && ki != null ? r.live > ki : undefined;
                const delta = r.initial != null && r.live != null
                  ? ((r.live - r.initial) / r.initial) * 100 : undefined;
                const isEditing = editingSym === r.underlying.symbol;
                return (
                  <tr key={r.underlying.symbol}>
                    <td>
                      {/* Underlying name is a deep-link → /analyze with that symbol pre-loaded.
                          Saves the RM from copy-pasting tickers between pages. */}
                      <Link
                        href={`/analyze?symbol=${encodeURIComponent(r.underlying.symbol)}&market=${r.underlying.market}`}
                        className="group inline-flex items-center gap-2 hover:text-accent"
                        title="Open in Stock Analyze"
                      >
                        <span className="font-medium underline-offset-2 group-hover:underline">{r.underlying.rawName}</span>
                        <span className="rounded bg-[var(--surface-2)] border border-[var(--line)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                          {r.underlying.market}
                        </span>
                        <LineChart size={12} className="opacity-0 transition-opacity group-hover:opacity-70" />
                      </Link>
                    </td>
                    <td className="tabular text-[var(--text)]">
                      {isEditing ? (
                        <span className="inline-flex items-center gap-1">
                          <input
                            autoFocus
                            type="number"
                            step="0.01"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit(r.underlying.symbol);
                              if (e.key === "Escape") setEditingSym(null);
                            }}
                            className="w-24 rounded border border-[var(--line)] bg-[var(--surface)] text-[var(--text)] px-1 py-0.5 text-right text-[12px]"
                          />
                          <button onClick={() => commitEdit(r.underlying.symbol)} className="text-success" title="Save"><Check size={14} /></button>
                          <button onClick={() => setEditingSym(null)} className="text-[var(--text-muted)]" title="Cancel"><X size={14} /></button>
                          <button onClick={() => clearOverride(r.underlying.symbol)} className="text-[var(--text-muted)]" title="Reset to auto"><RotateCcw size={12} /></button>
                        </span>
                      ) : (
                        <button
                          onClick={() => startEdit(r.underlying.symbol, r.initial)}
                          className="group inline-flex items-center gap-1 hover:text-accent"
                          title="Click to override initial fixing"
                        >
                          {formatPx(r.initial, r.currency)}
                          <Pencil size={10} className="opacity-0 transition-opacity group-hover:opacity-60" />
                        </button>
                      )}
                    </td>
                    <td className="font-semibold">
                      <TickingPrice
                        price={r.live}
                        currency={r.currency}
                        marketOpen={isMarketOpen(r.underlying.market).open}
                        compact
                      />
                    </td>
                    <td className={`tabular font-medium ${
                      delta == null ? "" : delta >= 0 ? "text-success" : "text-danger"
                    }`}>
                      {delta == null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%`}
                    </td>
                    <td className="tabular">{formatPx(r.high52, r.currency)}</td>
                    <td className="tabular">{formatPx(r.low52, r.currency)}</td>
                    <td className={`tabular ${aboveKi === false ? "text-danger font-semibold" : ""}`}>
                      {formatPx(r.eki, r.currency)}
                    </td>
                    <td className="tabular">{formatPx(r.strike, r.currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[var(--line)] px-4 py-2 text-[10px] text-[var(--text-muted)]">
          Initial Fixing {tranche.isIndicativeFixing ? "(indicative — latest close)" : "(actual)"}
          {" · "}Click any Initial Fixing cell to override manually.
          {" · "}Strike = Initial × {(tranche.strikePct * 100).toFixed(0)}%
          {" · "}EKI = Initial × {(tranche.ekiPct * 100).toFixed(0)}%
          {" · "}Δ vs Initial = (Live − Initial) ÷ Initial.
        </div>
      </div>
    </section>
  );
});

function download(dataUrl: string, name: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  a.click();
}
