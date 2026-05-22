"use client";

// ProductParser — the entry point on the Desk tab.
// Polished single-button layout: tap "Paste from clipboard" → parser runs
// instantly on whatever's in the clipboard. The Edit button reveals the
// textarea so the user can hand-fix any field the parser got wrong.

import { useEffect, useState } from "react";
import { ClipboardPaste, Sparkles, RotateCcw, Pencil, CheckCircle2, AlertCircle } from "lucide-react";
import { parseTrancheText, type ParseResult } from "@/lib/parser";
import { SAMPLE_TRANCHE_TEXT } from "@/lib/sample";
import { getCurrentParsedText, setCurrentParsedText } from "@/lib/storage";

interface Props {
  onParsed: (result: ParseResult, rawText: string) => void;
  initialText?: string;
}

export function ProductParser({ onParsed, initialText }: Props) {
  const [text, setText] = useState<string>(initialText ?? SAMPLE_TRANCHE_TEXT);
  const [open, setOpen] = useState<boolean>(false);
  const [flashStatus, setFlashStatus] = useState<"none" | "ok" | "empty" | "denied">("none");

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
      if (!t.trim()) {
        setFlashStatus("empty");
        setTimeout(() => setFlashStatus("none"), 2500);
        return;
      }
      setText(t);
      run(t);
      setFlashStatus("ok");
      setTimeout(() => setFlashStatus("none"), 2500);
    } catch {
      setFlashStatus("denied");
      setTimeout(() => setFlashStatus("none"), 3500);
    }
  }

  return (
    <section className="card mb-4 overflow-hidden">
      {/* Top label strip — sets the tone before the big CTA */}
      <div className="border-b border-[var(--line)] bg-[var(--surface-2)] px-4 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            <Sparkles size={11} className="mr-1 inline" />
            New tranche · parse from clipboard
          </div>
          <button
            onClick={() => setOpen((o) => !o)}
            className="btn h-7 px-2.5 text-[11px]"
            aria-expanded={open}
            title="Open the editor to fix any field the parser missed"
          >
            <Pencil size={11} /> {open ? "Hide" : "Edit"}
          </button>
        </div>
      </div>

      {/* Hero CTA section */}
      <div className="p-4">
        <h2 className="text-[15px] font-semibold leading-tight">
          Paste a tranche to load the dashboard
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-muted)]">
          Copy a tranche message in your usual format → tap below. The parser pulls out
          the <strong className="text-[var(--text)]">tranche code</strong>, <strong className="text-[var(--text)]">trade</strong> &amp; <strong className="text-[var(--text)]">offering dates</strong>,{" "}
          <strong className="text-[var(--text)]">strike / KO / EKI %</strong>, <strong className="text-[var(--text)]">coupon</strong>, <strong className="text-[var(--text)]">tenor</strong>, and <strong className="text-[var(--text)]">underlying stocks</strong> automatically.
        </p>

        {/* Primary CTA — solid accent fill, bright white text for max contrast.
            Was previously text-accent on bg-accent/10 which read as washed-out
            on dark surfaces. White-on-blue is the highest-contrast banking
            convention. */}
        <button
          onClick={pasteFromClipboard}
          className="group mt-3 flex w-full items-center justify-center gap-2.5 rounded-xl bg-accent px-4 py-3.5 text-[14.5px] font-semibold text-white shadow-sm transition hover:bg-accent/90 active:scale-[0.98] active:bg-accent"
        >
          <ClipboardPaste size={18} className="transition-transform group-active:scale-95" />
          Paste from clipboard
        </button>

        {/* Inline status pill — confirms paste worked / failed without a modal */}
        {flashStatus !== "none" && (
          <div
            className={`mt-2 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] ${
              flashStatus === "ok" ? "bg-success/10 text-success" :
              flashStatus === "empty" ? "bg-warning/10 text-warning" :
              "bg-danger/10 text-danger"
            }`}
          >
            {flashStatus === "ok" && <><CheckCircle2 size={13} /> Parsed — dashboard loaded below.</>}
            {flashStatus === "empty" && <><AlertCircle size={13} /> Clipboard is empty.</>}
            {flashStatus === "denied" && <><AlertCircle size={13} /> Clipboard access denied. Tap <strong>Edit</strong> and paste into the box instead.</>}
          </div>
        )}
      </div>

      {/* Editor — revealed by the Edit button */}
      {open && (
        <div className="border-t border-[var(--line)] bg-[var(--surface-2)] p-4">
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Editor — paste, hand-fix any field, then Parse
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            className="input font-mono text-[12.5px] leading-snug"
            spellCheck={false}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => run(text)} className="btn btn-primary">
              <Sparkles size={15} /> Parse this
            </button>
            <button onClick={pasteFromClipboard} className="btn">
              <ClipboardPaste size={15} /> Paste from clipboard
            </button>
            <button onClick={() => setText(SAMPLE_TRANCHE_TEXT)} className="btn" title="Reset to sample">
              <RotateCcw size={15} /> Sample
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
