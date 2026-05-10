"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { Copy, FileImage, FileText } from "lucide-react";
import * as htmlToImage from "html-to-image";
import jsPDF from "jspdf";
import type { Tranche, PriceQuote } from "@/lib/types";
import { tableRows, formatPx } from "@/lib/calc";

interface Props {
  tranche: Tranche;
  quotes: Record<string, PriceQuote | undefined>;
}

export interface ProductTableHandle {
  exportPng: () => Promise<void>;
  exportPdf: () => Promise<void>;
  copyTsv: () => Promise<void>;
}

/**
 * Capture the table at its full natural width, even on mobile where the
 * outer container is horizontally scrolled. We temporarily override the
 * scroll container's overflow + width during the snapshot, then restore.
 */
async function captureFullTable(node: HTMLElement): Promise<string> {
  const scrollEl = node.querySelector<HTMLElement>(".scroll-x");
  const tableEl = node.querySelector<HTMLElement>("table");
  const fullWidth = Math.max(
    tableEl?.scrollWidth ?? 0,
    scrollEl?.scrollWidth ?? 0,
    node.scrollWidth
  );

  // Snapshot prior styles so we can restore them.
  const prev = {
    nodeWidth: node.style.width,
    scrollOverflow: scrollEl?.style.overflow ?? "",
    scrollWidth: scrollEl?.style.width ?? "",
  };

  if (scrollEl) {
    scrollEl.style.overflow = "visible";
    scrollEl.style.width = `${fullWidth}px`;
  }
  node.style.width = `${fullWidth}px`;

  try {
    return await htmlToImage.toPng(node, {
      backgroundColor: "white",
      pixelRatio: 2,
      width: fullWidth,
      style: { width: `${fullWidth}px` },
      cacheBust: true,
    });
  } finally {
    node.style.width = prev.nodeWidth;
    if (scrollEl) {
      scrollEl.style.overflow = prev.scrollOverflow;
      scrollEl.style.width = prev.scrollWidth;
    }
  }
}

export const ProductTable = forwardRef<ProductTableHandle, Props>(function ProductTable(
  { tranche, quotes },
  ref
) {
  const tableRef = useRef<HTMLDivElement>(null);
  const rows = tableRows(tranche, quotes);

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
    // Pick orientation from aspect ratio so mobile-wide tables aren't squashed.
    const isLandscape = img.width >= img.height;
    const pdf = new jsPDF({
      orientation: isLandscape ? "landscape" : "portrait",
      unit: "pt",
      format: "a4",
    });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 30;
    const titleH = 24;
    const availW = pageW - 2 * margin;
    const availH = pageH - 2 * margin - titleH;
    const ratio = img.width / img.height;
    let drawW = availW;
    let drawH = drawW / ratio;
    if (drawH > availH) {
      drawH = availH;
      drawW = drawH * ratio;
    }
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
    exportPng: doExportPng,
    exportPdf: doExportPdf,
    copyTsv: doCopyTsv,
  }));

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
          <button onClick={doExportPng} className="btn h-9 px-3 text-xs" title="Export full table as PNG">
            <FileImage size={14} /> PNG
          </button>
          <button onClick={doExportPdf} className="btn h-9 px-3 text-xs" title="Export full table as PDF">
            <FileText size={14} /> PDF
          </button>
          <button onClick={doCopyTsv} className="btn h-9 px-3 text-xs" title="Copy table as TSV">
            <Copy size={14} /> Copy
          </button>
        </div>
      </header>

      <div ref={tableRef} className="bg-white text-ink-900">
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
                  ? ((r.live - r.initial) / r.initial) * 100
                  : undefined;
                return (
                  <tr key={r.underlying.symbol}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.underlying.rawName}</span>
                        <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-700">
                          {r.underlying.market}
                        </span>
                      </div>
                    </td>
                    <td className="tabular text-ink-500">{formatPx(r.initial, r.currency)}</td>
                    <td className="tabular font-semibold">{formatPx(r.live, r.currency)}</td>
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
        <div className="border-t border-[var(--line)] px-4 py-2 text-[10px] text-ink-500">
          Initial Fixing {tranche.isIndicativeFixing ? "(indicative — latest close)" : "(actual)"}
          {" · "}Strike = Initial × {(tranche.strikePct * 100).toFixed(0)}%
          {" · "}EKI = Initial × {(tranche.ekiPct * 100).toFixed(0)}%
          {" · "}Δ vs Initial = (Live − Initial) ÷ Initial. Quotes refresh automatically.
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
