"use client";

import { useEffect, useState } from "react";
import { ClipboardPaste, Sparkles, RotateCcw } from "lucide-react";
import { parseTrancheText, type ParseResult } from "@/lib/parser";
import { SAMPLE_TRANCHE_TEXT } from "@/lib/sample";
import { getCurrentParsedText, setCurrentParsedText } from "@/lib/storage";

interface Props {
  onParsed: (result: ParseResult, rawText: string) => void;
  initialText?: string;
}

export function ProductParser({ onParsed, initialText }: Props) {
  // Initial textarea content: latest saved → caller-provided → sample.
  const [text, setText] = useState<string>(initialText ?? SAMPLE_TRANCHE_TEXT);
  const [open, setOpen] = useState<boolean>(false);

  useEffect(() => {
    const saved = getCurrentParsedText();
    if (saved && !initialText) setText(saved);
  }, [initialText]);

  function run(value: string) {
    const result = parseTrancheText(value);
    setCurrentParsedText(value);
    onParsed(result, value);
    setOpen(false);
  }

  async function pasteFromClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      if (t.trim()) {
        setText(t);
        run(t);
      }
    } catch { /* user denied */ }
  }

  return (
    <section className="card mb-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            New tranche
          </div>
          <h2 className="text-base font-semibold leading-tight">Paste structured product text</h2>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
            Bloomberg, dealer email, IM screenshot — paste it; the parser extracts
            tranche code, dates, strike/KO/EKI, coupon, tenor, and underlyings.
          </p>
        </div>
        <button onClick={() => setOpen((o) => !o)} className="btn h-8 px-3 text-xs" aria-expanded={open}>
          {open ? "Hide" : "Edit"}
        </button>
      </div>

      {open && (
        <div className="mt-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            className="input font-mono text-[12.5px] leading-snug"
            spellCheck={false}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => run(text)} className="btn btn-primary">
              <Sparkles size={16} /> Parse
            </button>
            <button onClick={pasteFromClipboard} className="btn">
              <ClipboardPaste size={16} /> Paste from clipboard
            </button>
            <button onClick={() => setText(SAMPLE_TRANCHE_TEXT)} className="btn" title="Reset to sample">
              <RotateCcw size={16} /> Sample
            </button>
          </div>
        </div>
      )}

      {!open && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => run(text)} className="btn btn-primary">
            <Sparkles size={16} /> Generate dashboard
          </button>
          <button onClick={pasteFromClipboard} className="btn">
            <ClipboardPaste size={16} /> Paste from clipboard
          </button>
        </div>
      )}
    </section>
  );
}
