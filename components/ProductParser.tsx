"use client";

// ProductParser — Desk entry point.
// A free-floating liquid orb in the centre. No card frame. SVG turbulence
// distorts a multi-colour radial gradient in real time, giving a true
// liquid surface that flows. Heartbeat pulse + water-drop ripple on tap.

import { useEffect, useRef, useState } from "react";
import { Pencil, Sparkles, ClipboardPaste, RotateCcw, CheckCircle2, AlertCircle } from "lucide-react";
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
    <div className="mb-4">
      {/* Tiny Edit button — top right, away from the orb */}
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
          <Sparkles size={11} className="mr-1 inline" />
          New tranche
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="btn h-7 px-2.5 text-[11px]"
          aria-expanded={open}
        >
          <Pencil size={11} /> {open ? "Hide" : "Edit"}
        </button>
      </div>

      {/* The orb — no card, floats on the page background */}
      <div className="flex flex-col items-center justify-center py-6">
        <button
          type="button"
          onClick={pasteFromClipboard}
          className="liquid-orb"
          aria-label="Parse tranche from clipboard"
        >
          <svg className="liquid-orb-svg" viewBox="0 0 240 240" aria-hidden="true">
            <defs>
              {/* Animated turbulence — surface "flows" by shifting baseFrequency */}
              <filter id="orb-liquid-a" x="-20%" y="-20%" width="140%" height="140%">
                <feTurbulence type="fractalNoise" baseFrequency="0.014 0.020" numOctaves="3" seed="3" result="noise">
                  <animate
                    attributeName="baseFrequency"
                    dur="9s"
                    values="0.014 0.020; 0.022 0.012; 0.012 0.024; 0.014 0.020"
                    repeatCount="indefinite"
                  />
                </feTurbulence>
                <feDisplacementMap in="SourceGraphic" in2="noise" scale="22" xChannelSelector="R" yChannelSelector="G" />
              </filter>
              <filter id="orb-liquid-b" x="-20%" y="-20%" width="140%" height="140%">
                <feTurbulence type="fractalNoise" baseFrequency="0.018 0.014" numOctaves="3" seed="9" result="noise">
                  <animate
                    attributeName="baseFrequency"
                    dur="11s"
                    values="0.018 0.014; 0.012 0.022; 0.022 0.014; 0.018 0.014"
                    repeatCount="indefinite"
                  />
                </feTurbulence>
                <feDisplacementMap in="SourceGraphic" in2="noise" scale="18" xChannelSelector="R" yChannelSelector="G" />
              </filter>

              {/* Base sphere — deep violet to magenta */}
              <radialGradient id="orb-base" cx="42%" cy="38%" r="75%">
                <stop offset="0%"   stopColor="#9ec8ff" />
                <stop offset="30%"  stopColor="#5a78f0" />
                <stop offset="60%"  stopColor="#6233c8" />
                <stop offset="90%"  stopColor="#c145d9" />
                <stop offset="100%" stopColor="#ff4ea0" />
              </radialGradient>

              {/* Pink light source on the left side */}
              <radialGradient id="orb-pink" cx="20%" cy="55%" r="55%">
                <stop offset="0%"   stopColor="#ff7ec4" stopOpacity="0.95" />
                <stop offset="50%"  stopColor="#d040b8" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#a020c0" stopOpacity="0" />
              </radialGradient>

              {/* Cyan light source on the right side */}
              <radialGradient id="orb-cyan" cx="80%" cy="40%" r="55%">
                <stop offset="0%"   stopColor="#a8edff" stopOpacity="0.95" />
                <stop offset="50%"  stopColor="#4cb8f5" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#2860d8" stopOpacity="0" />
              </radialGradient>

              {/* Top-left specular highlight (the "wet" gloss) */}
              <radialGradient id="orb-gloss" cx="34%" cy="28%" r="22%">
                <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* Stacked layers create the chromatic liquid effect */}
            <g>
              {/* Base violet/magenta sphere with strong turbulence */}
              <circle cx="120" cy="120" r="92" fill="url(#orb-base)" filter="url(#orb-liquid-a)" />
              {/* Pink wash on the left, screen-blended */}
              <circle cx="120" cy="120" r="92" fill="url(#orb-pink)" filter="url(#orb-liquid-b)" style={{ mixBlendMode: "screen" }} />
              {/* Cyan wash on the right, screen-blended */}
              <circle cx="120" cy="120" r="92" fill="url(#orb-cyan)" filter="url(#orb-liquid-a)" style={{ mixBlendMode: "screen" }} />
              {/* Gloss highlight on top-left, NOT distorted — gives sphere depth */}
              <ellipse cx="92" cy="82" rx="26" ry="18" fill="url(#orb-gloss)" transform="rotate(-25 92 82)" />
            </g>
          </svg>

          <span className="liquid-orb-label">Parse</span>

          {ripples.map((r) => (
            <span
              key={r.id}
              className="liquid-orb-ripple"
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
        <div className="card bg-[var(--surface-2)] p-4">
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
    </div>
  );
}
