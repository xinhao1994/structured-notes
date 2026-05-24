"use client";

// PixelTim — a pixel-art teddy bear inspired by Tim from Despicable Me.
// He has a head, body, arms with hands, and legs. He walks, sits down to
// rest, and jumps for joy. Tap him to feed him a banana — he'll wiggle
// with happiness as hearts pop above his head.
//
// His job is to make us happy. Be kind to Tim.

import { useState, useRef, useEffect, useCallback } from "react";

const INTRO_TEXT = "Hi! I'm Tim - tap to feed me! 🧸";

// 17 short non-market cheery quotes. Mix of encouragement, warmth and
// playful Tim-isms. Each under ~32 chars so the bubble fits on a phone.
const MOTIVATIONAL_QUOTES = [
  "Everything's gonna be alright! 🌟",
  "You got this! 💪",
  "Smile - Tim believes in you! 🧸",
  "You make Tim smile! 😊",
  "Sending you a big hug! 🤗",
  "Breathe in. Breathe out. 🫶",
  "You're stronger than you think 💎",
  "Bad day, not a bad life 🌻",
  "One step at a time 🐾",
  "Coffee + courage = today ☕",
  "Even Tim needs hugs 🤗",
  "You're doing amazing 🌷",
  "Be kind to yourself 💛",
  "You're so loved! 💕",
  "Tim's proud of you! 🥹",
  "Today's a good day to smile 🌈",
  "Feed Tim, feel happy 🍌",
];

const FEEDING_QUOTES = [
  "Mmm! Yummy! 🍌💕",
  "Nom nom nom 🤤",
  "Thank you, friend! 🥰",
  "Best snack ever! ⭐",
  "I love you! 💖",
];

type Mode = "walking" | "sitting" | "jumping";

interface Props {
  trackWidth?: number;
  size?: number;
}

export function PixelTim({ trackWidth = 150, size = 38 }: Props) {
  const [mode, setMode] = useState<Mode>("walking");
  const [eating, setEating] = useState(false);
  const [chompFrame, setChompFrame] = useState(0);
  const [bubbleText, setBubbleText] = useState<string | null>(INTRO_TEXT);
  const eatTimerRef = useRef<number | null>(null);
  const chompTimerRef = useRef<number | null>(null);
  const bubbleTimerRef = useRef<number | null>(null);

  const showBubble = useCallback((text: string, durationMs: number) => {
    setBubbleText(text);
    if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = window.setTimeout(() => {
      setBubbleText(null);
      bubbleTimerRef.current = null;
    }, durationMs);
  }, []);

  // Chomp animation while eating
  useEffect(() => {
    if (!eating) { setChompFrame(0); return; }
    chompTimerRef.current = window.setInterval(() => {
      setChompFrame((f) => (f === 0 ? 1 : 0));
    }, 200);
    return () => {
      if (chompTimerRef.current) window.clearInterval(chompTimerRef.current);
    };
  }, [eating]);

  // Mode cycling — walks for 3-7s, then maybe sits (2-3.5s) or jumps (1.4s),
  // then resumes walking. Skip cycling while eating.
  useEffect(() => {
    if (eating) return;
    let timeoutId: number;
    if (mode === "walking") {
      const delay = 3500 + Math.random() * 3500;
      timeoutId = window.setTimeout(() => {
        const r = Math.random();
        if (r < 0.30) setMode("sitting");
        else if (r < 0.60) setMode("jumping");
        else setMode("walking"); // schedule another walking cycle
      }, delay);
    } else if (mode === "sitting") {
      timeoutId = window.setTimeout(() => setMode("walking"), 2200 + Math.random() * 1300);
    } else if (mode === "jumping") {
      timeoutId = window.setTimeout(() => setMode("walking"), 1400);
    }
    return () => window.clearTimeout(timeoutId);
  }, [mode, eating]);

  // Intro bubble + new quote every 5 seconds
  useEffect(() => {
    // Hide intro after 7s
    bubbleTimerRef.current = window.setTimeout(() => {
      setBubbleText(null);
      bubbleTimerRef.current = null;
    }, 7000);

    // Then a fresh quote every 5 seconds (visible for 4s, ~1s gap)
    const cycle = window.setInterval(() => {
      if (eatTimerRef.current) return; // don't override feeding bubble
      const q = MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
      showBubble(q, 4000);
    }, 5000);

    return () => {
      window.clearInterval(cycle);
      if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);
      if (eatTimerRef.current) window.clearTimeout(eatTimerRef.current);
      if (chompTimerRef.current) window.clearInterval(chompTimerRef.current);
    };
  }, [showBubble]);

  function handleTap() {
    if (eating) return;
    setEating(true);
    setMode("sitting"); // Tim sits down to eat
    const q = FEEDING_QUOTES[Math.floor(Math.random() * FEEDING_QUOTES.length)];
    showBubble(q, 2400);
    if (eatTimerRef.current) window.clearTimeout(eatTimerRef.current);
    eatTimerRef.current = window.setTimeout(() => {
      setEating(false);
      setMode("walking");
      eatTimerRef.current = null;
    }, 2200);
  }

  const walkDist = Math.max(0, trackWidth - size);
  const horizontalPaused = mode !== "walking" || eating;

  const styles = `
    .tim-wrap { position: relative; display: inline-block; vertical-align: middle; }
    .tim-track {
      position: relative; display: inline-block;
      height: ${size + 6}px; width: ${trackWidth}px;
      overflow: hidden;
      -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 8px, #000 calc(100% - 8px), transparent 100%);
              mask-image: linear-gradient(90deg, transparent 0, #000 8px, #000 calc(100% - 8px), transparent 100%);
      cursor: pointer; user-select: none;
      -webkit-tap-highlight-color: transparent;
    }
    .tim-walker {
      position: absolute; left: 0; top: 2px;
      width: ${size}px; height: ${size}px;
      animation: tim-pace 8s linear infinite alternate;
      will-change: transform;
    }
    .tim-walker.paused { animation-play-state: paused; }
    @keyframes tim-pace {
      0%   { transform: translateX(0) scaleX(1); }
      48%  { transform: translateX(${walkDist}px) scaleX(1); }
      50%  { transform: translateX(${walkDist}px) scaleX(-1); }
      98%  { transform: translateX(0) scaleX(-1); }
      100% { transform: translateX(0) scaleX(1); }
    }
    /* Vertical motion lives on an inner container so it doesn't fight
       the outer translateX (CSS can't combine two transforms on one node). */
    .tim-bouncer {
      width: 100%; height: 100%;
      transform-origin: 50% 90%;
    }
    .tim-bouncer.jumping {
      animation: tim-jump 0.55s ease-out infinite;
    }
    @keyframes tim-jump {
      0%, 100% { transform: translateY(0) scaleY(1); }
      20%      { transform: translateY(2px) scaleY(0.92); }
      55%      { transform: translateY(-9px) scaleY(1.04); }
      80%      { transform: translateY(-2px) scaleY(0.98); }
    }
    .tim-bouncer.eating {
      animation: tim-wiggle 0.35s ease-in-out infinite alternate;
    }
    @keyframes tim-wiggle {
      0%   { transform: rotate(-3deg) scale(1); }
      100% { transform: rotate(3deg) scale(1.03); }
    }
    /* Walking — two leg frames alternate via opacity. step-end timing for
       the choppy 8-bit feel. */
    .tim-walker .leg-a { animation: tim-step-a 0.32s steps(1, end) infinite; }
    .tim-walker .leg-b { animation: tim-step-b 0.32s steps(1, end) infinite; }
    .tim-walker.paused .leg-a,
    .tim-walker.paused .leg-b { animation-play-state: paused; }
    @keyframes tim-step-a {
      0%, 49%   { opacity: 1; }
      50%, 100% { opacity: 0; }
    }
    @keyframes tim-step-b {
      0%, 49%   { opacity: 0; }
      50%, 100% { opacity: 1; }
    }
    /* Banana wobbles up to Tim's mouth */
    .tim-banana {
      position: absolute; left: 50%; bottom: 0;
      width: ${Math.floor(size * 0.45)}px;
      height: ${Math.floor(size * 0.45)}px;
      transform: translateX(-50%);
      animation: tim-banana-rise 1.8s ease-out forwards;
      pointer-events: none;
      z-index: 5;
    }
    @keyframes tim-banana-rise {
      0%   { transform: translate(-50%, 8px) rotate(-15deg); opacity: 0; }
      15%  { transform: translate(-55%, 0px) rotate(10deg); opacity: 1; }
      35%  { transform: translate(-45%, -4px) rotate(-12deg); opacity: 1; }
      55%  { transform: translate(-55%, -8px) rotate(8deg); opacity: 1; }
      75%  { transform: translate(-50%, -10px) rotate(-3deg); opacity: 0.7; }
      100% { transform: translate(-50%, -14px) rotate(0deg); opacity: 0; }
    }
    /* Floating hearts during eating */
    .tim-heart {
      position: absolute;
      top: 8px;
      font-size: 13px;
      font-weight: 900;
      color: #ff5c8d;
      text-shadow: 0 0 2px #ffffff, 0 0 4px #ffffff;
      animation: tim-heart-float 1.3s ease-out infinite;
      pointer-events: none;
      z-index: 6;
      line-height: 1;
    }
    .tim-heart.h1 { left: calc(50% - 14px); animation-delay: 0s; }
    .tim-heart.h2 { left: calc(50% + 2px); animation-delay: 0.35s; }
    .tim-heart.h3 { left: calc(50% + 10px); animation-delay: 0.75s; }
    @keyframes tim-heart-float {
      0%   { transform: translateY(2px) scale(0.3); opacity: 0; }
      20%  { transform: translateY(-4px) scale(1.1); opacity: 1; }
      80%  { transform: translateY(-22px) scale(0.95); opacity: 0.9; }
      100% { transform: translateY(-30px) scale(0.5); opacity: 0; }
    }
    /* Comic-style speech bubble */
    .tim-bubble {
      position: absolute; top: calc(100% + 9px); right: 0;
      max-width: 230px;
      background: #ffffff; color: #1a1a1a;
      border: 2px solid #1a1a1a;
      border-radius: 14px;
      padding: 6px 11px;
      font-size: 11.5px; font-weight: 700; line-height: 1.3;
      box-shadow: 2px 2px 0 rgba(0,0,0,0.22);
      z-index: 60;
      animation: tim-bubble-pop 220ms cubic-bezier(.34,1.56,.64,1);
      pointer-events: none;
      letter-spacing: 0.01em;
      white-space: normal;
      width: max-content;
    }
    .tim-bubble::before {
      content: ''; position: absolute;
      bottom: 100%; right: 24px;
      width: 0; height: 0;
      border-left: 8px solid transparent;
      border-right: 8px solid transparent;
      border-bottom: 10px solid #1a1a1a;
    }
    .tim-bubble::after {
      content: ''; position: absolute;
      bottom: 100%; right: 26px;
      transform: translateY(2px);
      width: 0; height: 0;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-bottom: 8px solid #ffffff;
    }
    @keyframes tim-bubble-pop {
      0%   { transform: scale(0.6) translateY(-4px); opacity: 0; }
      100% { transform: scale(1) translateY(0); opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .tim-walker { animation: none; transform: translateX(${Math.floor(walkDist / 2)}px); }
      .tim-walker .leg-a, .tim-walker .leg-b { animation: none; }
      .tim-bouncer.jumping, .tim-bouncer.eating { animation: none; }
      .tim-banana, .tim-heart { animation: none; opacity: 0; }
      .tim-bubble { animation: none; }
    }
  `;

  return (
    <div className="tim-wrap">
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div
        className="tim-track"
        onClick={handleTap}
        role="button"
        tabIndex={0}
        aria-label={eating ? "Tim is eating" : "Tap to feed Tim"}
        title={eating ? "Yum!" : "Tap to feed Tim"}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleTap(); }}
      >
        <div className={`tim-walker ${horizontalPaused ? "paused" : ""}`}>
          <div className={`tim-bouncer ${mode === "jumping" && !eating ? "jumping" : ""} ${eating ? "eating" : ""}`}>
            {eating ? (
              <TimEatingSprite size={size} chompFrame={chompFrame} />
            ) : mode === "jumping" ? (
              <TimJumpingSprite size={size} />
            ) : mode === "sitting" ? (
              <TimSittingSprite size={size} />
            ) : (
              <TimWalkingSprite size={size} />
            )}
          </div>
        </div>
        {eating && <BananaSprite />}
        {eating && <span className="tim-heart h1">♥</span>}
        {eating && <span className="tim-heart h2">♥</span>}
        {eating && <span className="tim-heart h3">♥</span>}
      </div>
      {bubbleText && <div className="tim-bubble">{bubbleText}</div>}
    </div>
  );
}

/* ============================================================
   SHARED HEAD — used by every sprite so the face stays consistent.
   Renders: ears, head silhouette, eyes, muzzle, nose, mouth.
   Pass eyeMode="open" for normal beads, "happy" for ^_^ squint.
   ============================================================ */
function TimHead({ eyeMode = "open" }: { eyeMode?: "open" | "happy" }) {
  return (
    <g>
      {/* Ear tops */}
      <rect x="3" y="1" width="2" height="1" fill="#5a3a1c" />
      <rect x="15" y="1" width="2" height="1" fill="#5a3a1c" />
      {/* Ears */}
      <rect x="2" y="2" width="4" height="2" fill="#6b4423" />
      <rect x="14" y="2" width="4" height="2" fill="#6b4423" />
      {/* Pink inner ear */}
      <rect x="3" y="3" width="2" height="1" fill="#ee9d9d" />
      <rect x="15" y="3" width="2" height="1" fill="#ee9d9d" />

      {/* Head silhouette — round-ish */}
      <rect x="2" y="4" width="16" height="10" fill="#8b5e34" />
      <rect x="1" y="5" width="18" height="8" fill="#8b5e34" />
      {/* Top-of-head shadow band */}
      <rect x="3" y="4" width="14" height="1" fill="#6b4423" />

      {/* Patch (Tim's worn-out toy detail) */}
      <rect x="14" y="6" width="2" height="2" fill="#7a4e2a" />
      <rect x="14" y="6" width="1" height="1" fill="#5a3a1c" />
      <rect x="15" y="7" width="1" height="1" fill="#5a3a1c" />

      {/* Eyes */}
      {eyeMode === "happy" ? (
        <>
          {/* Squinting happy ^_^ eyes */}
          <rect x="5" y="7" width="2" height="1" fill="#1a1a1a" />
          <rect x="6" y="6" width="1" height="1" fill="#1a1a1a" />
          <rect x="13" y="7" width="2" height="1" fill="#1a1a1a" />
          <rect x="14" y="6" width="1" height="1" fill="#1a1a1a" />
        </>
      ) : (
        <>
          {/* Big bead eyes with white highlight */}
          <rect x="5" y="6" width="2" height="3" fill="#1a1a1a" />
          <rect x="13" y="6" width="2" height="3" fill="#1a1a1a" />
          <rect x="6" y="6" width="1" height="1" fill="#ffffff" />
          <rect x="14" y="6" width="1" height="1" fill="#ffffff" />
        </>
      )}

      {/* Cream muzzle */}
      <rect x="6" y="9" width="8" height="4" fill="#d4a877" />
      <rect x="7" y="13" width="6" height="1" fill="#d4a877" />

      {/* Nose */}
      <rect x="9" y="10" width="2" height="1" fill="#1a1a1a" />
      <rect x="9" y="11" width="2" height="1" fill="#1a1a1a" />

      {/* Smile */}
      <rect x="8" y="12" width="1" height="1" fill="#3a2418" />
      <rect x="9" y="13" width="2" height="1" fill="#3a2418" />
      <rect x="11" y="12" width="1" height="1" fill="#3a2418" />
    </g>
  );
}

/* ============================================================
   WALKING SPRITE — standing pose, arms down, legs alternate
   ============================================================ */
function TimWalkingSprite({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 22"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ display: "block" }}
    >
      <TimHead />

      {/* Body */}
      <rect x="4" y="14" width="12" height="4" fill="#8b5e34" />
      <rect x="3" y="15" width="14" height="2" fill="#8b5e34" />
      {/* Belly tuft (lighter cream/tan) */}
      <rect x="7" y="15" width="6" height="3" fill="#a98759" />
      {/* Belly stitching down the centre */}
      <rect x="9" y="14" width="1" height="4" fill="#5a3a1c" opacity="0.4" />

      {/* Arms hanging down at sides */}
      <rect x="1" y="14" width="2" height="4" fill="#8b5e34" />
      <rect x="17" y="14" width="2" height="4" fill="#8b5e34" />
      {/* Hand pads (slightly darker) */}
      <rect x="1" y="17" width="2" height="1" fill="#6b4423" />
      <rect x="17" y="17" width="2" height="1" fill="#6b4423" />

      {/* Legs — frame A: left leg forward (lighter), right leg back (darker) */}
      <g className="leg-a">
        <rect x="5" y="18" width="3" height="3" fill="#8b5e34" />
        <rect x="12" y="18" width="3" height="3" fill="#6b4423" />
        <rect x="5" y="21" width="3" height="1" fill="#3a2418" />
        <rect x="12" y="21" width="3" height="1" fill="#3a2418" />
      </g>
      {/* Legs — frame B: left back, right forward */}
      <g className="leg-b">
        <rect x="5" y="18" width="3" height="3" fill="#6b4423" />
        <rect x="12" y="18" width="3" height="3" fill="#8b5e34" />
        <rect x="5" y="21" width="3" height="1" fill="#3a2418" />
        <rect x="12" y="21" width="3" height="1" fill="#3a2418" />
      </g>
    </svg>
  );
}

/* ============================================================
   SITTING SPRITE — Tim sits, arms forward in lap, legs tucked
   ============================================================ */
function TimSittingSprite({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 22"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ display: "block" }}
    >
      <TimHead eyeMode="happy" />

      {/* Body — slightly squashed (legs folded so body sits lower) */}
      <rect x="4" y="14" width="12" height="5" fill="#8b5e34" />
      <rect x="3" y="15" width="14" height="3" fill="#8b5e34" />
      <rect x="7" y="15" width="6" height="4" fill="#a98759" />
      <rect x="9" y="14" width="1" height="5" fill="#5a3a1c" opacity="0.4" />

      {/* Arms forward, resting in lap — angled inward */}
      <rect x="2" y="15" width="2" height="3" fill="#8b5e34" />
      <rect x="3" y="17" width="2" height="2" fill="#8b5e34" />
      <rect x="4" y="18" width="2" height="1" fill="#6b4423" />
      <rect x="16" y="15" width="2" height="3" fill="#8b5e34" />
      <rect x="15" y="17" width="2" height="2" fill="#8b5e34" />
      <rect x="14" y="18" width="2" height="1" fill="#6b4423" />

      {/* Legs tucked underneath — just two little foot pads sticking out */}
      <rect x="5" y="19" width="3" height="2" fill="#8b5e34" />
      <rect x="12" y="19" width="3" height="2" fill="#8b5e34" />
      <rect x="5" y="21" width="3" height="1" fill="#3a2418" />
      <rect x="12" y="21" width="3" height="1" fill="#3a2418" />
    </svg>
  );
}

/* ============================================================
   JUMPING SPRITE — arms raised up high, legs together pointing down
   ============================================================ */
function TimJumpingSprite({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 22"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ display: "block" }}
    >
      {/* Arms raised UP first so head overlaps them at the top */}
      {/* Left arm reaching up */}
      <rect x="1" y="11" width="2" height="4" fill="#8b5e34" />
      <rect x="1" y="8" width="2" height="3" fill="#8b5e34" />
      <rect x="1" y="7" width="2" height="1" fill="#6b4423" />
      {/* Right arm reaching up */}
      <rect x="17" y="11" width="2" height="4" fill="#8b5e34" />
      <rect x="17" y="8" width="2" height="3" fill="#8b5e34" />
      <rect x="17" y="7" width="2" height="1" fill="#6b4423" />

      <TimHead eyeMode="happy" />

      {/* Body */}
      <rect x="4" y="14" width="12" height="4" fill="#8b5e34" />
      <rect x="3" y="15" width="14" height="2" fill="#8b5e34" />
      <rect x="7" y="15" width="6" height="3" fill="#a98759" />
      <rect x="9" y="14" width="1" height="4" fill="#5a3a1c" opacity="0.4" />

      {/* Legs together, pointing down (mid-jump) */}
      <rect x="6" y="18" width="3" height="3" fill="#8b5e34" />
      <rect x="11" y="18" width="3" height="3" fill="#8b5e34" />
      <rect x="6" y="21" width="3" height="1" fill="#3a2418" />
      <rect x="11" y="21" width="3" height="1" fill="#3a2418" />

      {/* Tiny motion lines below feet — sells the jump */}
      <rect x="4" y="21" width="1" height="1" fill="#a98759" opacity="0.5" />
      <rect x="15" y="21" width="1" height="1" fill="#a98759" opacity="0.5" />
    </svg>
  );
}

/* ============================================================
   EATING SPRITE — sitting + chomping mouth + happy eyes + blush
   ============================================================ */
function TimEatingSprite({ size, chompFrame }: { size: number; chompFrame: number }) {
  const mouthOpen = chompFrame === 0;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 22"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ display: "block" }}
    >
      {/* Ears */}
      <rect x="3" y="1" width="2" height="1" fill="#5a3a1c" />
      <rect x="15" y="1" width="2" height="1" fill="#5a3a1c" />
      <rect x="2" y="2" width="4" height="2" fill="#6b4423" />
      <rect x="14" y="2" width="4" height="2" fill="#6b4423" />
      <rect x="3" y="3" width="2" height="1" fill="#ee9d9d" />
      <rect x="15" y="3" width="2" height="1" fill="#ee9d9d" />

      {/* Head */}
      <rect x="2" y="4" width="16" height="10" fill="#8b5e34" />
      <rect x="1" y="5" width="18" height="8" fill="#8b5e34" />
      <rect x="3" y="4" width="14" height="1" fill="#6b4423" />

      {/* Patch */}
      <rect x="14" y="6" width="2" height="2" fill="#7a4e2a" />
      <rect x="14" y="6" width="1" height="1" fill="#5a3a1c" />
      <rect x="15" y="7" width="1" height="1" fill="#5a3a1c" />

      {/* Happy squinting eyes ^_^ */}
      <rect x="5" y="7" width="2" height="1" fill="#1a1a1a" />
      <rect x="6" y="6" width="1" height="1" fill="#1a1a1a" />
      <rect x="13" y="7" width="2" height="1" fill="#1a1a1a" />
      <rect x="14" y="6" width="1" height="1" fill="#1a1a1a" />

      {/* Bright pink blush cheeks */}
      <rect x="3" y="9" width="2" height="1" fill="#ee9d9d" />
      <rect x="15" y="9" width="2" height="1" fill="#ee9d9d" />

      {/* Cream muzzle */}
      <rect x="6" y="9" width="8" height="4" fill="#d4a877" />
      <rect x="7" y="13" width="6" height="1" fill="#d4a877" />

      {/* Nose */}
      <rect x="9" y="10" width="2" height="1" fill="#1a1a1a" />

      {/* Mouth — opens / closes; pink tongue when open */}
      {mouthOpen ? (
        <>
          <rect x="8" y="11" width="4" height="3" fill="#3a2418" />
          <rect x="9" y="12" width="2" height="1" fill="#e88aa6" />
        </>
      ) : (
        <rect x="8" y="12" width="4" height="1" fill="#3a2418" />
      )}

      {/* Body (sitting pose) */}
      <rect x="4" y="14" width="12" height="5" fill="#8b5e34" />
      <rect x="3" y="15" width="14" height="3" fill="#8b5e34" />
      <rect x="7" y="15" width="6" height="4" fill="#a98759" />
      <rect x="9" y="14" width="1" height="5" fill="#5a3a1c" opacity="0.4" />

      {/* Arms reaching forward to hold the banana */}
      <rect x="2" y="15" width="2" height="3" fill="#8b5e34" />
      <rect x="3" y="17" width="3" height="2" fill="#8b5e34" />
      <rect x="5" y="18" width="2" height="1" fill="#6b4423" />
      <rect x="16" y="15" width="2" height="3" fill="#8b5e34" />
      <rect x="14" y="17" width="3" height="2" fill="#8b5e34" />
      <rect x="13" y="18" width="2" height="1" fill="#6b4423" />

      {/* Foot pads sticking out from under */}
      <rect x="5" y="19" width="3" height="2" fill="#8b5e34" />
      <rect x="12" y="19" width="3" height="2" fill="#8b5e34" />
      <rect x="5" y="21" width="3" height="1" fill="#3a2418" />
      <rect x="12" y="21" width="3" height="1" fill="#3a2418" />
    </svg>
  );
}

/* ============================================================
   BANANA — yellow pixel banana that wobbles up to Tim's mouth
   ============================================================ */
function BananaSprite() {
  return (
    <svg
      className="tim-banana"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
    >
      <rect x="2" y="3" width="1" height="3" fill="#caa312" />
      <rect x="3" y="2" width="1" height="2" fill="#caa312" />
      <rect x="3" y="4" width="4" height="3" fill="#f4d04a" />
      <rect x="4" y="7" width="4" height="2" fill="#f4d04a" />
      <rect x="6" y="8" width="3" height="1" fill="#caa312" />
      <rect x="8" y="6" width="1" height="2" fill="#caa312" />
      <rect x="9" y="5" width="1" height="1" fill="#caa312" />
      <rect x="3" y="1" width="1" height="1" fill="#5a4419" />
      <rect x="4" y="0" width="1" height="1" fill="#5a4419" />
      <rect x="5" y="5" width="2" height="1" fill="#fde487" />
    </svg>
  );
}
