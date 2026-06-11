"use client";

// ProductParser — Desk entry point.
// A single big liquid circle button in the middle that breathes like a
// heartbeat. Tap it → water-drop ripple expands from the touch point,
// clipboard is read, dashboard renders. An Edit chip in the corner
// reveals the textarea for hand-fixing fields the parser misses.

import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, Pencil, Sparkles, RotateCcw, CheckCircle2, AlertCircle } from "lucide-react";
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
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const rippleIdRef = useRef(0);

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

  function addRipple(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = ++rippleIdRef.current;
    setRipples((prev) => [...prev, { id, x, y }]);
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 950);
  }

  async function pasteFromClipboard(e?: React.MouseEvent<HTMLButtonElement>) {
    if (e) addRipple(e);
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
      {/* Top label strip with Edit button — kept tiny so the liquid circle dominates */}
      <div className="border-b border-[var(--line)] bg-[var(--surface-2)] px-4 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            <Sparkles size={11} className="mr-1 inline" />
            New tranche
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

      {/* Liquid circle button — heartbeat-pulsing, water-rippling */}
      <div className="flex flex-col items-center justify-center py-10 px-4">
        <button
          type="button"
          onClick={pasteFromClipboard}
          className="liquid-paste-btn"
          aria-label="Paste tranche from clipboard"
        >
          <span className="liquid-paste-glow" aria-hidden="true" />
          <span className="liquid-paste-blob blob-1" aria-hidden="true" />
          <span className="liquid-paste-blob blob-2" aria-hidden="true" />
          <span className="liquid-paste-highlight" aria-hidden="true" />
          <span className="liquid-paste-inner">
            <ClipboardPaste size={30} strokeWidth={2} />
            <span className="liquid-paste-label">Paste</span>
          </span>
          {ripples.map((r) => (
            <span
              key={r.id}
              className="liquid-paste-ripple"
              style={{ left: r.x, top: r.y }}
              aria-hidden="true"
            />
          ))}
        </button>

        {/* Inline status pill */}
        {flashStatus !== "none" && (
          <div
            className={`mt-5 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] ${
              flashStatus === "ok" ? "bg-success/10 text-success" :
              flashStatus === "empty" ? "bg-warning/10 text-warning" :
              "bg-danger/10 text-danger"
            }`}
          >
            {flashStatus === "ok" && <><CheckCircle2 size={13} /> Parsed — dashboard loaded below.</>}
            {flashStatus === "empty" && <><AlertCircle size={13} /> Clipboard is empty.</>}
            {flashStatus === "denied" && <><AlertCircle size={13} /> Clipboard denied — tap <strong>Edit</strong> to paste manually.</>}
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
            <button onClick={(e) => pasteFromClipboard(e)} className="btn">
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
