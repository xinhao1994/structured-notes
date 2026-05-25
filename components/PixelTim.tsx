"use client";

// PixelTim — a pixel-art teddy bear inspired by Tim from Despicable Me.
// He has a head, body, arms with hand pads, and legs, and does 10
// different things throughout the day:
//   walking, sitting, jumping, waving, holding a heart, dancing,
//   spinning, sleeping (zZz), stretching, and (on tap) eating a banana.
//
// His speech bubble follows his head as he walks. The quote pool
// adapts to the user's local time of day (morning / afternoon /
// evening / night).
//
// His job is to make us happy. Be kind to Tim.

import { useState, useRef, useEffect, useCallback } from "react";

// ── Time-of-day quote pools ─────────────────────────────────────────
function getCurrentPeriod(): "morning" | "afternoon" | "evening" | "night" {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}

function getIntroText(): string {
  switch (getCurrentPeriod()) {
    case "morning":   return "Good morning! I'm Tim ☀️ Tap to feed me!";
    case "afternoon": return "Good afternoon! I'm Tim 🌤️ Tap to feed me!";
    case "evening":   return "Good evening! I'm Tim 🌆 Tap to feed me!";
    case "night":     return "Hi night owl! I'm Tim 🌙 Tap to feed me!";
  }
}

const QUOTES_BY_PERIOD: Record<"morning" | "afternoon" | "evening" | "night", string[]> = {
  morning: [
    "Good morning, friend! ☀️",
    "Don't skip breakfast! 🥐",
    "Drink some water 💧",
    "Stretch a little 🧘",
    "Coffee time! ☕",
    "Today's gonna be great 🌅",
    "Hi sunshine! 🌞",
    "Eat well, do well 🍳",
    "Smile at the mirror 😊",
    "One day at a time 🌼",
    "You're glowing today! ✨",
    "Make today count 💪",
    "Morning hugs! 🤗",
  ],
  afternoon: [
    "Have you eaten lunch? 🍱",
    "Take a quick break ☕",
    "Drink more water! 💧",
    "Halfway there 💪",
    "You're doing great 🌻",
    "Lunch first, work after 🍜",
    "Time for a stretch 🧘",
    "Snack time! 🍪",
    "Don't forget to smile 😊",
    "Keep going, friend 🐾",
    "You got this! 💎",
    "Tim's cheering you on 🧸",
    "Step away from the screen 🌿",
  ],
  evening: [
    "How was your day? 🌆",
    "Dinner time! 🍲",
    "Time to relax 🛋️",
    "Tea, anyone? 🍵",
    "You did amazing today ⭐",
    "Wind down a little 🕯️",
    "Did you eat dinner? 🍛",
    "Hug someone you love 🤗",
    "Be proud of today 🥰",
    "Tim's a little tired 🧸",
    "Catch the sunset 🌅",
    "Slow down, breathe 🫶",
  ],
  night: [
    "Sleep early, friend! 😴",
    "Tomorrow needs you fresh 🌙",
    "Pajamas on! 🛌",
    "Don't scroll too long 📱",
    "Lights out soon? 🕯️",
    "Sweet dreams await 💤",
    "Rest well, friend 🌟",
    "Tim's sleepy too 🧸💤",
    "One more chapter, then bed 📖",
    "Eyes need rest too 😌",
    "Good rest = good day 💪",
    "Brush your teeth! 🦷",
  ],
};

function getQuotePool(): string[] {
  return QUOTES_BY_PERIOD[getCurrentPeriod()];
}

const FEEDING_QUOTES = [
  "Mmm! Yummy! 🍌💕",
  "Nom nom nom 🤤",
  "Thank you, friend! 🥰",
  "Best snack ever! ⭐",
  "I love you! 💖",
];

// ── Mode state ──────────────────────────────────────────────────────
type Mode =
  | "walking"
  | "sitting"
  | "jumping"
  | "waving"
  | "heart"
  | "dancing"
  | "spinning"
  | "sleeping"
  | "stretching";

// Weighted random pick of a non-walking mode. Higher weight = appears more often.
const MODE_WEIGHTS: { mode: Mode; weight: number }[] = [
  { mode: "sitting",    weight: 16 },
  { mode: "jumping",    weight: 14 },
  { mode: "waving",     weight: 16 },
  { mode: "heart",      weight: 10 },
  { mode: "dancing",    weight: 14 },
  { mode: "spinning",   weight: 8  },
  { mode: "sleeping",   weight: 8  },
  { mode: "stretching", weight: 14 },
];

function pickRandomNonWalkingMode(): Mode {
  const total = MODE_WEIGHTS.reduce((s, m) => s + m.weight, 0);
  let r = Math.random() * total;
  for (const m of MODE_WEIGHTS) {
    if (r < m.weight) return m.mode;
    r -= m.weight;
  }
  return "sitting";
}

const MODE_DURATIONS: Record<Exclude<Mode, "walking">, () => number> = {
  sitting:    () => 2200 + Math.random() * 1300,
  jumping:    () => 1500,
  waving:     () => 1800,
  heart:      () => 2200,
  dancing:    () => 2500,
  spinning:   () => 1100,
  sleeping:   () => 4000,
  stretching: () => 1500,
};

interface Props {
  trackWidth?: number;
  size?: number;
}

export function PixelTim({ trackWidth = 300, size = 38 }: Props) {
  const [mode, setMode] = useState<Mode>("walking");
  const [eating, setEating] = useState(false);
  const [chompFrame, setChompFrame] = useState(0);
  const [bubbleText, setBubbleText] = useState<string | null>(() => getIntroText());
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

  // Mode cycling — walks 3-7s, then 75% chance picks a random fun action,
  // 25% chance to keep walking another cycle. Eating overrides.
  useEffect(() => {
    if (eating) return;
    let timeoutId: number;
    if (mode === "walking") {
      const delay = 5000 + Math.random() * 5000; // walks 5-10s before maybe doing something
      timeoutId = window.setTimeout(() => {
        if (Math.random() < 0.45) setMode(pickRandomNonWalkingMode());
        else setMode("walking"); // schedule another walking cycle
      }, delay);
    } else {
      timeoutId = window.setTimeout(() => setMode("walking"), MODE_DURATIONS[mode]());
    }
    return () => window.clearTimeout(timeoutId);
  }, [mode, eating]);

  // Intro bubble + new quote every 5 seconds (visible 4s, ~1s gap)
  useEffect(() => {
    bubbleTimerRef.current = window.setTimeout(() => {
      setBubbleText(null);
      bubbleTimerRef.current = null;
    }, 7000);

    const cycle = window.setInterval(() => {
      if (eatTimerRef.current) return; // don't override feeding bubble
      const pool = getQuotePool(); // re-checks the current hour every cycle
      const q = pool[Math.floor(Math.random() * pool.length)];
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

  // CSS — interpolates trackWidth + size into the keyframes per instance.
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
      animation: tim-pace ${Math.max(6, Math.round((walkDist * 2) / 55))}s linear infinite;
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
    /* Bubble tracker — invisible div that moves in lockstep with Tim
       (matching duration + easing) but never flips. The bubble sits
       inside it, anchored above Tim's head, so it follows him as he walks. */
    .tim-bubble-tracker {
      position: absolute; top: 0; left: 0;
      width: ${size}px; height: 0;
      animation: tim-pace-bubble ${Math.max(6, Math.round((walkDist * 2) / 55))}s linear infinite;
      pointer-events: none;
      z-index: 60;
    }
    .tim-bubble-tracker.paused { animation-play-state: paused; }
    @keyframes tim-pace-bubble {
      0%   { transform: translateX(0); }
      48%  { transform: translateX(${walkDist}px); }
      50%  { transform: translateX(${walkDist}px); }
      98%  { transform: translateX(0); }
      100% { transform: translateX(0); }
    }

    /* Inner bouncer handles vertical motion, rotations, scales — so the
       horizontal translateX on the outer .tim-walker isn't disturbed. */
    .tim-bouncer {
      width: 100%; height: 100%;
      transform-origin: 50% 90%;
    }
    .tim-bouncer.jumping    { animation: tim-jump 0.55s ease-out infinite; }
    .tim-bouncer.eating     { animation: tim-wiggle 0.35s ease-in-out infinite alternate; }
    .tim-bouncer.dancing    { animation: tim-dance 0.55s ease-in-out infinite alternate; }
    .tim-bouncer.spinning   { animation: tim-spin 1.0s ease-in-out infinite; }
    .tim-bouncer.stretching { animation: tim-stretch 1.0s ease-in-out infinite alternate; }
    .tim-bouncer.sleeping   { animation: tim-breathe 2.5s ease-in-out infinite alternate; }
    .tim-bouncer.waving     { animation: tim-wave-bob 0.4s ease-in-out infinite alternate; }

    @keyframes tim-jump {
      0%, 100% { transform: translateY(0) scaleY(1); }
      20%      { transform: translateY(2px) scaleY(0.92); }
      55%      { transform: translateY(-12px) scaleY(1.05); }
      80%      { transform: translateY(-2px) scaleY(0.98); }
    }
    @keyframes tim-wiggle {
      0%   { transform: rotate(-3deg) scale(1); }
      100% { transform: rotate(3deg) scale(1.03); }
    }
    @keyframes tim-dance {
      0%   { transform: rotate(-9deg) translateY(0); }
      50%  { transform: rotate(0deg) translateY(-2px); }
      100% { transform: rotate(9deg) translateY(0); }
    }
    @keyframes tim-spin {
      /* Flat 2-D spin via scaleX — Tim "turns around" front-to-back */
      0%   { transform: scaleX(1); }
      25%  { transform: scaleX(0.15); }
      50%  { transform: scaleX(-1); }
      75%  { transform: scaleX(-0.15); }
      100% { transform: scaleX(1); }
    }
    @keyframes tim-stretch {
      0%   { transform: scaleY(1) translateY(0); }
      100% { transform: scaleY(1.08) translateY(-2px); }
    }
    @keyframes tim-breathe {
      0%   { transform: scaleY(1) translateY(0); }
      100% { transform: scaleY(0.96) translateY(2px); }
    }
    @keyframes tim-wave-bob {
      0%   { transform: translateY(0); }
      100% { transform: translateY(-1px); }
    }

    /* Walking legs swap via opacity */
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

    /* Waving arm — rotates from its shoulder */
    .tim-bouncer.waving .wave-arm {
      transform-origin: 90% 90%;
      animation: tim-wave-arm 0.45s ease-in-out infinite alternate;
    }
    @keyframes tim-wave-arm {
      0%   { transform: rotate(-20deg); }
      100% { transform: rotate(20deg); }
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
      position: absolute; top: 8px;
      font-size: 13px; font-weight: 900;
      color: #ff5c8d;
      text-shadow: 0 0 2px #ffffff, 0 0 4px #ffffff;
      animation: tim-heart-float 1.3s ease-out infinite;
      pointer-events: none; z-index: 6; line-height: 1;
    }
    .tim-heart.h1 { left: calc(50% - 14px); animation-delay: 0s; }
    .tim-heart.h2 { left: calc(50% + 2px);  animation-delay: 0.35s; }
    .tim-heart.h3 { left: calc(50% + 10px); animation-delay: 0.75s; }
    @keyframes tim-heart-float {
      0%   { transform: translateY(2px) scale(0.3);  opacity: 0; }
      20%  { transform: translateY(-4px) scale(1.1); opacity: 1; }
      80%  { transform: translateY(-22px) scale(0.95); opacity: 0.9; }
      100% { transform: translateY(-30px) scale(0.5); opacity: 0; }
    }

    /* Floating Z's during sleeping */
    .tim-z {
      position: absolute; top: 4px;
      font-size: 14px; font-weight: 800; font-family: -apple-system, system-ui, sans-serif;
      color: #6b80a8;
      text-shadow: 0 0 2px #ffffff;
      animation: tim-z-float 2.5s ease-out infinite;
      pointer-events: none; z-index: 6; line-height: 1;
    }
    .tim-z.z1 { left: calc(50% - 6px); animation-delay: 0s; }
    .tim-z.z2 { left: calc(50% + 4px); animation-delay: 0.85s; }
    .tim-z.z3 { left: calc(50% + 14px); animation-delay: 1.7s; }
    @keyframes tim-z-float {
      0%   { transform: translateY(2px) scale(0.5);  opacity: 0; }
      15%  { transform: translateY(-2px) scale(1);   opacity: 1; }
      80%  { transform: translateY(-18px) scale(1.2); opacity: 0.7; }
      100% { transform: translateY(-24px) scale(1.4); opacity: 0; }
    }

    /* Big heart that floats above Tim during "heart" mode */
    .tim-big-heart {
      position: absolute; top: -4px; left: 50%;
      transform: translateX(-50%);
      font-size: 16px; font-weight: 900;
      color: #ff3d6e;
      text-shadow: 0 0 3px #ffffff, 0 0 6px rgba(255,93,141,0.5);
      animation: tim-big-heart-pulse 1.0s ease-in-out infinite;
      pointer-events: none; z-index: 6; line-height: 1;
    }
    @keyframes tim-big-heart-pulse {
      0%, 100% { transform: translateX(-50%) scale(1); }
      50%      { transform: translateX(-50%) scale(1.25); }
    }

    /* ── Comic-style speech bubble ─────────────────── */
    .tim-bubble {
      position: absolute;
      bottom: 10px;     /* sits 10px above Tim's head */
      left: 50%;
      transform: translateX(-50%);
      max-width: 220px;
      background: #ffffff; color: #1a1a1a;
      border: 2px solid #1a1a1a;
      border-radius: 14px;
      padding: 6px 11px;
      font-size: 11.5px; font-weight: 700; line-height: 1.3;
      box-shadow: 2px 2px 0 rgba(0,0,0,0.22);
      animation: tim-bubble-pop 220ms cubic-bezier(.34,1.56,.64,1);
      letter-spacing: 0.01em;
      white-space: normal;
      width: max-content;
    }
    /* Tail pointing DOWN at Tim's head — black outline */
    .tim-bubble::before {
      content: ''; position: absolute;
      top: 100%; left: 50%;
      transform: translateX(-50%);
      width: 0; height: 0;
      border-left: 8px solid transparent;
      border-right: 8px solid transparent;
      border-top: 10px solid #1a1a1a;
    }
    /* Tail pointing DOWN at Tim's head — white fill on top of the outline */
    .tim-bubble::after {
      content: ''; position: absolute;
      top: 100%; left: 50%;
      transform: translateX(-50%) translateY(-2px);
      width: 0; height: 0;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-top: 8px solid #ffffff;
    }
    @keyframes tim-bubble-pop {
      0%   { transform: translateX(-50%) scale(0.6) translateY(-4px); opacity: 0; }
      100% { transform: translateX(-50%) scale(1) translateY(0); opacity: 1; }
    }

    @media (prefers-reduced-motion: reduce) {
      .tim-walker, .tim-bubble-tracker { animation: none; transform: translateX(${Math.floor(walkDist / 2)}px); }
      .tim-walker .leg-a, .tim-walker .leg-b { animation: none; }
      .tim-bouncer.jumping, .tim-bouncer.eating, .tim-bouncer.dancing,
      .tim-bouncer.spinning, .tim-bouncer.stretching, .tim-bouncer.sleeping,
      .tim-bouncer.waving { animation: none; }
      .tim-banana, .tim-heart, .tim-z, .tim-big-heart { animation: none; opacity: 0; }
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
          <div className={`tim-bouncer ${eating ? "eating" : (mode !== "walking" && mode !== "sitting") ? mode : ""}`}>
            {eating ? (
              <TimEatingSprite size={size} chompFrame={chompFrame} />
            ) : mode === "jumping" ? (
              <TimJumpingSprite size={size} />
            ) : mode === "sitting" ? (
              <TimSittingSprite size={size} />
            ) : mode === "waving" ? (
              <TimWavingSprite size={size} />
            ) : mode === "heart" ? (
              <TimHeartSprite size={size} />
            ) : mode === "sleeping" ? (
              <TimSleepingSprite size={size} />
            ) : mode === "stretching" ? (
              <TimStretchingSprite size={size} />
            ) : (
              /* walking, dancing, spinning use the standing sprite */
              <TimWalkingSprite size={size} />
            )}
          </div>
        </div>
        {eating && <BananaSprite />}
        {eating && <span className="tim-heart h1">♥</span>}
        {eating && <span className="tim-heart h2">♥</span>}
        {eating && <span className="tim-heart h3">♥</span>}
        {mode === "sleeping" && !eating && <span className="tim-z z1">Z</span>}
        {mode === "sleeping" && !eating && <span className="tim-z z2">Z</span>}
        {mode === "sleeping" && !eating && <span className="tim-z z3">Z</span>}
        {mode === "heart" && !eating && <span className="tim-big-heart">♥</span>}
      </div>

      {/* Bubble tracker — moves in lockstep with Tim above his head */}
      <div className={`tim-bubble-tracker ${horizontalPaused ? "paused" : ""}`}>
        {bubbleText && <div className="tim-bubble">{bubbleText}</div>}
      </div>
    </div>
  );
}

/* ============================================================
   SHARED HEAD — used by every sprite. Pass eyeMode to switch
   between open beads, happy squint, or closed (sleeping).
   ============================================================ */
function TimHead({ eyeMode = "open" }: { eyeMode?: "open" | "happy" | "closed" }) {
  return (
    <g>
      <rect x="3" y="1" width="2" height="1" fill="#5a3a1c" />
      <rect x="15" y="1" width="2" height="1" fill="#5a3a1c" />
      <rect x="2" y="2" width="4" height="2" fill="#6b4423" />
      <rect x="14" y="2" width="4" height="2" fill="#6b4423" />
      <rect x="3" y="3" width="2" height="1" fill="#ee9d9d" />
      <rect x="15" y="3" width="2" height="1" fill="#ee9d9d" />

      <rect x="2" y="4" width="16" height="10" fill="#8b5e34" />
      <rect x="1" y="5" width="18" height="8" fill="#8b5e34" />
      <rect x="3" y="4" width="14" height="1" fill="#6b4423" />

      <rect x="14" y="6" width="2" height="2" fill="#7a4e2a" />
      <rect x="14" y="6" width="1" height="1" fill="#5a3a1c" />
      <rect x="15" y="7" width="1" height="1" fill="#5a3a1c" />

      {eyeMode === "happy" ? (
        <>
          <rect x="5" y="7" width="2" height="1" fill="#1a1a1a" />
          <rect x="6" y="6" width="1" height="1" fill="#1a1a1a" />
          <rect x="13" y="7" width="2" height="1" fill="#1a1a1a" />
          <rect x="14" y="6" width="1" height="1" fill="#1a1a1a" />
        </>
      ) : eyeMode === "closed" ? (
        <>
          {/* Closed sleeping eyes — flat dashes */}
          <rect x="5" y="7" width="2" height="1" fill="#1a1a1a" />
          <rect x="13" y="7" width="2" height="1" fill="#1a1a1a" />
        </>
      ) : (
        <>
          <rect x="5" y="6" width="2" height="3" fill="#1a1a1a" />
          <rect x="13" y="6" width="2" height="3" fill="#1a1a1a" />
          <rect x="6" y="6" width="1" height="1" fill="#ffffff" />
          <rect x="14" y="6" width="1" height="1" fill="#ffffff" />
        </>
      )}

      <rect x="6" y="9" width="8" height="4" fill="#d4a877" />
      <rect x="7" y="13" width="6" height="1" fill="#d4a877" />
      <rect x="9" y="10" width="2" height="1" fill="#1a1a1a" />
      <rect x="9" y="11" width="2" height="1" fill="#1a1a1a" />
      <rect x="8" y="12" width="1" height="1" fill="#3a2418" />
      <rect x="9" y="13" width="2" height="1" fill="#3a2418" />
      <rect x="11" y="12" width="1" height="1" fill="#3a2418" />
    </g>
  );
}

function TimBody({ tuft = true }: { tuft?: boolean }) {
  return (
    <g>
      <rect x="4" y="14" width="12" height="4" fill="#8b5e34" />
      <rect x="3" y="15" width="14" height="2" fill="#8b5e34" />
      {tuft && <rect x="7" y="15" width="6" height="3" fill="#a98759" />}
      <rect x="9" y="14" width="1" height="4" fill="#5a3a1c" opacity="0.4" />
    </g>
  );
}

/* ============================================================
   WALKING — arms at sides, alternating legs
   ============================================================ */
function TimWalkingSprite({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 22" width={size} height={size}
         shapeRendering="crispEdges" style={{ display: "block" }}>
      <TimHead />
      <TimBody />
      {/* Arms */}
      <rect x="1" y="14" width="2" height="4" fill="#8b5e34" />
      <rect x="17" y="14" width="2" height="4" fill="#8b5e34" />
      <rect x="1" y="17" width="2" height="1" fill="#6b4423" />
      <rect x="17" y="17" width="2" height="1" fill="#6b4423" />
      {/* Legs — frame A: left forward (lighter), right back */}
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
   SITTING — body squashed, arms in lap, legs tucked
   ============================================================ */
function TimSittingSprite({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 22" width={size} height={size}
         shapeRendering="crispEdges" style={{ display: "block" }}>
      <TimHead eyeMode="happy" />
      <rect x="4" y="14" width="12" height="5" fill="#8b5e34" />
      <rect x="3" y="15" width="14" height="3" fill="#8b5e34" />
      <rect x="7" y="15" width="6" height="4" fill="#a98759" />
      <rect x="9" y="14" width="1" height="5" fill="#5a3a1c" opacity="0.4" />
      {/* Arms forward in lap */}
      <rect x="2" y="15" width="2" height="3" fill="#8b5e34" />
      <rect x="3" y="17" width="2" height="2" fill="#8b5e34" />
      <rect x="4" y="18" width="2" height="1" fill="#6b4423" />
      <rect x="16" y="15" width="2" height="3" fill="#8b5e34" />
      <rect x="15" y="17" width="2" height="2" fill="#8b5e34" />
      <rect x="14" y="18" width="2" height="1" fill="#6b4423" />
      {/* Foot pads peeking */}
      <rect x="5" y="19" width="3" height="2" fill="#8b5e34" />
      <rect x="12" y="19" width="3" height="2" fill="#8b5e34" />
      <rect x="5" y="21" width="3" height="1" fill="#3a2418" />
      <rect x="12" y="21" width="3" height="1" fill="#3a2418" />
    </svg>
  );
}

/* ============================================================
   JUMPING — arms raised up, legs together
   ============================================================ */
function TimJumpingSprite({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 22" width={size} height={size}
         shapeRendering="crispEdges" style={{ display: "block" }}>
      {/* Arms raised first so head overlaps them */}
      <rect x="1" y="11" width="2" height="4" fill="#8b5e34" />
      <rect x="1" y="8"  width="2" height="3" fill="#8b5e34" />
      <rect x="1" y="7"  width="2" height="1" fill="#6b4423" />
      <rect x="17" y="11" width="2" height="4" fill="#8b5e34" />
      <rect x="17" y="8"  width="2" height="3" fill="#8b5e34" />
      <rect x="17" y="7"  width="2" height="1" fill="#6b4423" />
      <TimHead eyeMode="happy" />
      <TimBody />
      {/* Legs together pointing down */}
      <rect x="6" y="18" width="3" height="3" fill="#8b5e34" />
      <rect x="11" y="18" width="3" height="3" fill="#8b5e34" />
      <rect x="6" y="21" width="3" height="1" fill="#3a2418" />
      <rect x="11" y="21" width="3" height="1" fill="#3a2418" />
      <rect x="4" y="21" width="1" height="1" fill="#a98759" opacity="0.5" />
      <rect x="15" y="21" width="1" height="1" fill="#a98759" opacity="0.5" />
    </svg>
  );
}

/* ============================================================
   WAVING — left arm at side, right arm raised; right hand wiggles
   ============================================================ */
function TimWavingSprite({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 22" width={size} height={size}
         shapeRendering="crispEdges" style={{ display: "block" }}>
      {/* Raised waving arm (right side) — wraps in group so CSS can rotate it */}
      <g className="wave-arm">
        <rect x="17" y="11" width="2" height="4" fill="#8b5e34" />
        <rect x="17" y="7"  width="2" height="4" fill="#8b5e34" />
        <rect x="16" y="5"  width="3" height="2" fill="#8b5e34" />
        <rect x="16" y="4"  width="3" height="1" fill="#6b4423" />
      </g>
      <TimHead eyeMode="happy" />
      <TimBody />
      {/* Left arm at side */}
      <rect x="1" y="14" width="2" height="4" fill="#8b5e34" />
      <rect x="1" y="17" width="2" height="1" fill="#6b4423" />
      {/* Legs (static — Tim stands still while waving) */}
      <rect x="5" y="18" width="3" height="3" fill="#8b5e34" />
      <rect x="12" y="18" width="3" height="3" fill="#8b5e34" />
      <rect x="5" y="21" width="3" height="1" fill="#3a2418" />
      <rect x="12" y="21" width="3" height="1" fill="#3a2418" />
    </svg>
  );
}

/* ============================================================
   HEART — both arms reach up, hands meet above head
   ============================================================ */
function TimHeartSprite({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 22" width={size} height={size}
         shapeRendering="crispEdges" style={{ display: "block" }}>
      {/* Arms reaching up + inward to meet above head */}
      <rect x="1"  y="11" width="2" height="4" fill="#8b5e34" />
      <rect x="2"  y="8"  width="2" height="3" fill="#8b5e34" />
      <rect x="4"  y="5"  width="2" height="3" fill="#8b5e34" />
      <rect x="6"  y="3"  width="2" height="2" fill="#8b5e34" />
      <rect x="7"  y="2"  width="2" height="1" fill="#6b4423" />
      <rect x="17" y="11" width="2" height="4" fill="#8b5e34" />
      <rect x="16" y="8"  width="2" height="3" fill="#8b5e34" />
      <rect x="14" y="5"  width="2" height="3" fill="#8b5e34" />
      <rect x="12" y="3"  width="2" height="2" fill="#8b5e34" />
      <rect x="11" y="2"  width="2" height="1" fill="#6b4423" />
      <TimHead eyeMode="happy" />
      <TimBody />
      <rect x="5" y="18" width="3" height="3" fill="#8b5e34" />
      <rect x="12" y="18" width="3" height="3" fill="#8b5e34" />
      <rect x="5" y="21" width="3" height="1" fill="#3a2418" />
      <rect x="12" y="21" width="3" height="1" fill="#3a2418" />
    </svg>
  );
}

/* ============================================================
   SLEEPING — sitting pose, eyes closed, body squashed
   ============================================================ */
function TimSleepingSprite({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 22" width={size} height={size}
         shapeRendering="crispEdges" style={{ display: "block" }}>
      <TimHead eyeMode="closed" />
      <rect x="4" y="14" width="12" height="5" fill="#8b5e34" />
      <rect x="3" y="15" width="14" height="3" fill="#8b5e34" />
      <rect x="7" y="15" width="6" height="4" fill="#a98759" />
      <rect x="9" y="14" width="1" height="5" fill="#5a3a1c" opacity="0.4" />
      {/* Arms resting at sides */}
      <rect x="2" y="15" width="2" height="3" fill="#8b5e34" />
      <rect x="2" y="18" width="2" height="1" fill="#6b4423" />
      <rect x="16" y="15" width="2" height="3" fill="#8b5e34" />
      <rect x="16" y="18" width="2" height="1" fill="#6b4423" />
      {/* Foot pads */}
      <rect x="5" y="19" width="3" height="2" fill="#8b5e34" />
      <rect x="12" y="19" width="3" height="2" fill="#8b5e34" />
      <rect x="5" y="21" width="3" height="1" fill="#3a2418" />
      <rect x="12" y="21" width="3" height="1" fill="#3a2418" />
    </svg>
  );
}

/* ============================================================
   STRETCHING — arms straight up, body tall
   ============================================================ */
function TimStretchingSprite({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 22" width={size} height={size}
         shapeRendering="crispEdges" style={{ display: "block" }}>
      {/* Arms straight up */}
      <rect x="1"  y="4" width="2" height="11" fill="#8b5e34" />
      <rect x="1"  y="3" width="2" height="1"  fill="#6b4423" />
      <rect x="17" y="4" width="2" height="11" fill="#8b5e34" />
      <rect x="17" y="3" width="2" height="1"  fill="#6b4423" />
      <TimHead eyeMode="happy" />
      <TimBody />
      {/* Legs straight, slightly apart */}
      <rect x="5" y="18" width="3" height="3" fill="#8b5e34" />
      <rect x="12" y="18" width="3" height="3" fill="#8b5e34" />
      <rect x="5" y="21" width="3" height="1" fill="#3a2418" />
      <rect x="12" y="21" width="3" height="1" fill="#3a2418" />
    </svg>
  );
}

/* ============================================================
   EATING — sits, happy face, mouth chomps, blush, arms forward
   ============================================================ */
function TimEatingSprite({ size, chompFrame }: { size: number; chompFrame: number }) {
  const mouthOpen = chompFrame === 0;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 22" width={size} height={size}
         shapeRendering="crispEdges" style={{ display: "block" }}>
      <rect x="3" y="1" width="2" height="1" fill="#5a3a1c" />
      <rect x="15" y="1" width="2" height="1" fill="#5a3a1c" />
      <rect x="2" y="2" width="4" height="2" fill="#6b4423" />
      <rect x="14" y="2" width="4" height="2" fill="#6b4423" />
      <rect x="3" y="3" width="2" height="1" fill="#ee9d9d" />
      <rect x="15" y="3" width="2" height="1" fill="#ee9d9d" />
      <rect x="2" y="4" width="16" height="10" fill="#8b5e34" />
      <rect x="1" y="5" width="18" height="8" fill="#8b5e34" />
      <rect x="3" y="4" width="14" height="1" fill="#6b4423" />
      <rect x="14" y="6" width="2" height="2" fill="#7a4e2a" />
      <rect x="14" y="6" width="1" height="1" fill="#5a3a1c" />
      <rect x="15" y="7" width="1" height="1" fill="#5a3a1c" />
      <rect x="5" y="7" width="2" height="1" fill="#1a1a1a" />
      <rect x="6" y="6" width="1" height="1" fill="#1a1a1a" />
      <rect x="13" y="7" width="2" height="1" fill="#1a1a1a" />
      <rect x="14" y="6" width="1" height="1" fill="#1a1a1a" />
      {/* Blush */}
      <rect x="3" y="9" width="2" height="1" fill="#ee9d9d" />
      <rect x="15" y="9" width="2" height="1" fill="#ee9d9d" />
      <rect x="6" y="9" width="8" height="4" fill="#d4a877" />
      <rect x="7" y="13" width="6" height="1" fill="#d4a877" />
      <rect x="9" y="10" width="2" height="1" fill="#1a1a1a" />
      {mouthOpen ? (
        <>
          <rect x="8" y="11" width="4" height="3" fill="#3a2418" />
          <rect x="9" y="12" width="2" height="1" fill="#e88aa6" />
        </>
      ) : (
        <rect x="8" y="12" width="4" height="1" fill="#3a2418" />
      )}
      <rect x="4" y="14" width="12" height="5" fill="#8b5e34" />
      <rect x="3" y="15" width="14" height="3" fill="#8b5e34" />
      <rect x="7" y="15" width="6" height="4" fill="#a98759" />
      <rect x="9" y="14" width="1" height="5" fill="#5a3a1c" opacity="0.4" />
      {/* Arms forward */}
      <rect x="2" y="15" width="2" height="3" fill="#8b5e34" />
      <rect x="3" y="17" width="3" height="2" fill="#8b5e34" />
      <rect x="5" y="18" width="2" height="1" fill="#6b4423" />
      <rect x="16" y="15" width="2" height="3" fill="#8b5e34" />
      <rect x="14" y="17" width="3" height="2" fill="#8b5e34" />
      <rect x="13" y="18" width="2" height="1" fill="#6b4423" />
      <rect x="5" y="19" width="3" height="2" fill="#8b5e34" />
      <rect x="12" y="19" width="3" height="2" fill="#8b5e34" />
      <rect x="5" y="21" width="3" height="1" fill="#3a2418" />
      <rect x="12" y="21" width="3" height="1" fill="#3a2418" />
    </svg>
  );
}

function BananaSprite() {
  return (
    <svg className="tim-banana" xmlns="http://www.w3.org/2000/svg"
         viewBox="0 0 12 12" shapeRendering="crispEdges">
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
