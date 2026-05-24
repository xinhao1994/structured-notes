"use client";

// PixelTim — a pixel-art teddy bear inspired by Tim from Despicable Me.
// He paces back and forth across the chat header, occasionally speaks
// motivational quotes in a classic comic-style white speech bubble, and
// can be tapped to be fed a pixel banana.
//
// Tim's job is to make us happy. Be kind to Tim.

import { useState, useRef, useEffect, useCallback } from "react";

const INTRO_TEXT = "Hi! I'm Tim - tap to feed me! 🧸";

const MOTIVATIONAL_QUOTES = [
  "Everything's gonna be alright! 🌟",
  "You got this! 💪",
  "Smile - Tim believes in you! 🧸",
  "Tough day? Feed me a banana 🍌",
  "Markets close, hope doesn't ✨",
  "Breathe in. Breathe out. Keep going 🫶",
  "You're stronger than you think 💎",
  "Bad day, not bad life 🌻",
  "One step at a time 🐾",
  "Coffee + courage = today ☕",
  "Even Tim needs hugs 🤗",
  "You're doing amazing 🌷",
  "Tomorrow's a fresh chart 📈",
  "Be kind to yourself 💛",
  "Win or learn - never lose 🏆",
];

const FEEDING_QUOTES = [
  "Mmm! Yummy! 🍌",
  "Nom nom nom 🤤",
  "Thank you, friend! 🥰",
  "Best snack ever! ⭐",
];

interface Props {
  trackWidth?: number;
  size?: number;
}

export function PixelTim({ trackWidth = 140, size = 34 }: Props) {
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

  useEffect(() => {
    if (!eating) { setChompFrame(0); return; }
    chompTimerRef.current = window.setInterval(() => {
      setChompFrame((f) => (f === 0 ? 1 : 0));
    }, 220);
    return () => {
      if (chompTimerRef.current) window.clearInterval(chompTimerRef.current);
    };
  }, [eating]);

  useEffect(() => {
    bubbleTimerRef.current = window.setTimeout(() => {
      setBubbleText(null);
      bubbleTimerRef.current = null;
    }, 8000);

    const cycle = window.setInterval(() => {
      if (eatTimerRef.current) return;
      const q = MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
      showBubble(q, 6000);
    }, 20000);

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
    const q = FEEDING_QUOTES[Math.floor(Math.random() * FEEDING_QUOTES.length)];
    showBubble(q, 2400);
    if (eatTimerRef.current) window.clearTimeout(eatTimerRef.current);
    eatTimerRef.current = window.setTimeout(() => {
      setEating(false);
      eatTimerRef.current = null;
    }, 1900);
  }

  const walkDist = Math.max(0, trackWidth - size);
  const isSpeaking = bubbleText !== null;

  const styles = `
    .tim-wrap { position: relative; display: inline-block; vertical-align: middle; }
    .tim-track {
      position: relative; display: inline-block;
      height: ${size + 4}px; width: ${trackWidth}px;
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
    .tim-banana {
      position: absolute; left: 50%; bottom: 0;
      width: ${Math.floor(size * 0.5)}px;
      height: ${Math.floor(size * 0.5)}px;
      transform: translateX(-50%);
      animation: tim-banana-rise 1.9s ease-in forwards;
      pointer-events: none;
    }
    @keyframes tim-banana-rise {
      0%   { transform: translate(-50%, 6px); opacity: 0; }
      20%  { transform: translate(-50%, -2px); opacity: 1; }
      70%  { transform: translate(-50%, -10px); opacity: 1; }
      85%  { transform: translate(-50%, -14px); opacity: 0.6; }
      100% { transform: translate(-50%, -16px); opacity: 0; }
    }
    .tim-bubble {
      position: absolute; top: calc(100% + 9px); right: 0;
      max-width: 220px;
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
      .tim-banana { animation: none; opacity: 0; }
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
        <div className={`tim-walker ${eating || isSpeaking ? "paused" : ""}`}>
          {eating ? <TimEatingSprite size={size} chompFrame={chompFrame} /> : <TimWalkingSprite size={size} />}
        </div>
        {eating && <BananaSprite />}
      </div>
      {bubbleText && <div className="tim-bubble">{bubbleText}</div>}
    </div>
  );
}

function TimWalkingSprite({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 18 18"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ display: "block" }}
    >
      <rect x="2" y="1" width="2" height="1" fill="#5a3a1c" />
      <rect x="14" y="1" width="2" height="1" fill="#5a3a1c" />
      <rect x="1" y="2" width="4" height="2" fill="#6b4423" />
      <rect x="13" y="2" width="4" height="2" fill="#6b4423" />
      <rect x="2" y="3" width="2" height="1" fill="#ee9d9d" />
      <rect x="14" y="3" width="2" height="1" fill="#ee9d9d" />
      <rect x="2" y="4" width="14" height="11" fill="#8b5e34" />
      <rect x="1" y="5" width="16" height="9" fill="#8b5e34" />
      <rect x="2" y="4" width="14" height="1" fill="#6b4423" />
      <rect x="13" y="6" width="2" height="2" fill="#7a4e2a" />
      <rect x="13" y="6" width="1" height="1" fill="#5a3a1c" />
      <rect x="14" y="7" width="1" height="1" fill="#5a3a1c" />
      <rect x="4" y="6" width="2" height="3" fill="#1a1a1a" />
      <rect x="11" y="6" width="2" height="3" fill="#1a1a1a" />
      <rect x="5" y="6" width="1" height="1" fill="#ffffff" />
      <rect x="12" y="6" width="1" height="1" fill="#ffffff" />
      <rect x="5" y="9" width="8" height="5" fill="#d4a877" />
      <rect x="6" y="14" width="6" height="1" fill="#d4a877" />
      <rect x="8" y="10" width="2" height="1" fill="#1a1a1a" />
      <rect x="8" y="11" width="2" height="1" fill="#1a1a1a" />
      <rect x="7" y="12" width="1" height="1" fill="#3a2418" />
      <rect x="8" y="13" width="2" height="1" fill="#3a2418" />
      <rect x="10" y="12" width="1" height="1" fill="#3a2418" />
      <rect x="8" y="15" width="1" height="2" fill="#5a3a1c" opacity="0.5" />
      <g className="leg-a">
        <rect x="3" y="15" width="3" height="2" fill="#6b4423" />
        <rect x="11" y="15" width="3" height="2" fill="#7a4e2a" />
        <rect x="3" y="17" width="3" height="1" fill="#3a2418" />
        <rect x="11" y="17" width="3" height="1" fill="#3a2418" />
      </g>
      <g className="leg-b">
        <rect x="4" y="15" width="3" height="2" fill="#7a4e2a" />
        <rect x="10" y="15" width="3" height="2" fill="#6b4423" />
        <rect x="4" y="17" width="3" height="1" fill="#3a2418" />
        <rect x="10" y="17" width="3" height="1" fill="#3a2418" />
      </g>
    </svg>
  );
}

function TimEatingSprite({ size, chompFrame }: { size: number; chompFrame: number }) {
  const mouthOpen = chompFrame === 0;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 18 18"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ display: "block" }}
    >
      <rect x="2" y="1" width="2" height="1" fill="#5a3a1c" />
      <rect x="14" y="1" width="2" height="1" fill="#5a3a1c" />
      <rect x="1" y="2" width="4" height="2" fill="#6b4423" />
      <rect x="13" y="2" width="4" height="2" fill="#6b4423" />
      <rect x="2" y="3" width="2" height="1" fill="#ee9d9d" />
      <rect x="14" y="3" width="2" height="1" fill="#ee9d9d" />
      <rect x="2" y="4" width="14" height="11" fill="#8b5e34" />
      <rect x="1" y="5" width="16" height="9" fill="#8b5e34" />
      <rect x="2" y="4" width="14" height="1" fill="#6b4423" />
      <rect x="13" y="6" width="2" height="2" fill="#7a4e2a" />
      <rect x="13" y="6" width="1" height="1" fill="#5a3a1c" />
      <rect x="14" y="7" width="1" height="1" fill="#5a3a1c" />
      <rect x="4" y="7" width="2" height="1" fill="#1a1a1a" />
      <rect x="11" y="7" width="2" height="1" fill="#1a1a1a" />
      <rect x="5" y="9" width="8" height="5" fill="#d4a877" />
      <rect x="6" y="14" width="6" height="1" fill="#d4a877" />
      <rect x="8" y="10" width="2" height="1" fill="#1a1a1a" />
      {mouthOpen ? (
        <>
          <rect x="7" y="11" width="4" height="3" fill="#3a2418" />
          <rect x="8" y="12" width="2" height="1" fill="#e88aa6" />
        </>
      ) : (
        <rect x="7" y="12" width="4" height="1" fill="#3a2418" />
      )}
      <rect x="3" y="10" width="1" height="1" fill="#ee9d9d" />
      <rect x="14" y="10" width="1" height="1" fill="#ee9d9d" />
      <rect x="8" y="15" width="1" height="2" fill="#5a3a1c" opacity="0.5" />
      <rect x="3" y="15" width="3" height="2" fill="#6b4423" />
      <rect x="11" y="15" width="3" height="2" fill="#6b4423" />
      <rect x="3" y="17" width="3" height="1" fill="#3a2418" />
      <rect x="11" y="17" width="3" height="1" fill="#3a2418" />
    </svg>
  );
}

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
