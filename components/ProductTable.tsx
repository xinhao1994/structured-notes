"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { Copy, Download, FileImage, FileText } from "lucide-react";
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

export const ProductTable = forwardRef<ProductTableHandle, Props>(function ProductTable(
  { tranche, quotes },
  ref
) {
  const tableRef = useRef<HTMLDivElement>(null);
  const rows = tableRows(tranche, quotes);

  useImperativeHandle(ref, () => ({
    async exportPng() {
      if (!tableRef.current) return;
      const dataUrl = await htmlToImage.toPng(tableRef.current, {
        backgroundColor: "white",
        pixelRatio: 2,
      });
      download(dataUrl, `${tranche.trancheCode}.png`);
    },
    async exportPdf() {
      if (!tableRef.current) return;
      const dataUrl = await htmlToImage.toPng(tableRef.current, {
        backgroundColor: "white",
        pixelRatio: 2,
      });
      const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const img = new Image();
      img.src = dataUrl;
      await new Promise((r) => (img.onload = r));
      const w = pageW - 60;
      const h = (img.height * w) / img.width;
      pdf.text(`Tranche ${tranche.trancheCode}`, 30, 30);
      pdf.addImage(dataUrl, "PNG", 30, 50, w, h);
      pdf.save(`${tranche.trancheCode}.pdf`);
    },
    async copyTsv() {
      const header = ["Stock", "Live Price", "52W High", "52W Low", "EKI Price", "Strike Price"].join("\t");
      const lines = rows.map((r) =>
        [
          `${r.underlying.rawName} ${r.underlying.market}`,
          r.live ?? "",
          r.high52 ?? "",
          r.low52 ?? "",
          r.eki ?? "",
          r.strike ?? "",
        ].join("\t")
      );
      const text = [header, ...lines].join("\n");
      try { await navigator.clipboard.writeText(text); } catch {}
    },
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
          <button
            onClick={async () => {
              const node = tableRef.current!;
              const dataUrl = await htmlToImage.toPng(node, {
                backgroundColor: "white",
                pixelRatio: 2,
              });
              download(dataUrl, `${tranche.trancheCode}.png`);
            }}
            className="btn h-9 px-3 text-xs"
            title="Export as PNG"
          >
            <FileImage size={14} /> PNG
          </button>
          <button
            onClick={async () => {
              const node = tableRef.current!;
              const dataUrl = await htmlToImage.toPng(node, {
                backgroundColor: "white",
                pixelRatio: 2,
              });
              const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
              const img = new Image();
              img.src = dataUrl;
              await new Promise((r) => (img.onload = r));
              const w = pdf.internal.pageSize.getWidth() - 60;
              const h = (img.height * w) / img.width;
              pdf.text(`Tranche ${tranche.trancheCode}`, 30, 30);
              pdf.addImage(dataUrl, "PNG", 30, 50, w, h);
              pdf.save(`${tranche.trancheCode}.pdf`);
            }}
            className="btn h-9 px-3 text-xs"
            title="Export as PDF"
          >
            <FileText size={14} /> PDF
          </button>
          <button
            onClick={async () => {
              const header = ["Stock", "Live Price", "52W High", "52W Low", "EKI Price", "Strike Price"].join("\t");
              const lines = rows.map((r) =>
                [
                  `${r.underlying.rawName} ${r.underlying.market}`,
                  r.live ?? "",
                  r.high52 ?? "",
                  r.low52 ?? "",
                  r.eki ?? "",
                  r.strike ?? "",
                ].join("\t")
              );
              try { await navigator.clipboard.writeText([header, ...lines].join("\n")); } catch {}
            }}
            className="btn h-9 px-3 text-xs"
            title="Copy as TSV"
          >
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
                <th>Live Price</th>
                <th>52-Week High</th>
                <th>52-Week Low</th>
                <th>EKI Price</th>
                <th>Strike Price</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ki = r.eki;
                const aboveKi =
                  r.live != null && ki != null ? r.live > ki : undefined;
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
                    <td className="tabular font-medium">
                      {formatPx(r.live, r.currency)}
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
          Strike = Initial × {(tranche.strikePct * 100).toFixed(0)}%   ·   EKI = Initial × {(tranche.ekiPct * 100).toFixed(0)}%   ·   Quotes refresh automatically. Indicative pricing shown until trade date.
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
