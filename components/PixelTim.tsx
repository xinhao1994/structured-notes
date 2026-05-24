"use client";

// PixelTim — a tiny pixel-art teddy bear (inspired by Agnes's "Tim" from
// Despicable Me) that walks back and forth across the chat header.
// Tap him → he stops walking and eats a little pixel banana for ~1.5s,
// then resumes pacing.
//
// Implementation notes:
//   • Built out of <rect>s in a 16-wide SVG — proper pixel art with
//     shape-rendering: crispEdges so the pixels stay sharp at any size.
//   • Walk cycle is a 2-frame opacity swap with step-end timing (gives the
//     choppy 8-bit gait instead of a smooth tween).
//   • Horizontal pacing is a CSS keyframe with animation-direction: alternate;
//     scaleX(-1) flips Tim around at each end.
//   • Eating state pauses both animations and swaps the SVG for an
//     open-mouth + banana frame.
//   • Uses a plain <style> tag (not styled-jsx) so it works in App Router
//     without extra config.

import { useState, useRef, useEffect } from "react";

interface Props {
  /** Width of the strip Tim paces across, in px. Falls back to 140. */
  trackWidth?: number;
  /** Tim's pixel size (height of the rendered sprite). Default 28. */
  size?: number;
}

export function PixelTim({ trackWidth = 140, size = 28 }: Props) {
  const [eating, setEating] = useState(false);
  const [chompFrame, setChompFrame] = useState(0); // 0 = mouth open, 1 = mouth closed
  const eatTimerRef = useRef<number | null>(null);
  const chompTimerRef = useRef<number | null>(null);

  // Chomp animation — alternate the eating frame while in eating state
  useEffect(() => {
    if (!eating) {
      setChompFrame(0);
      return;
    }
    chompTimerRef.current = window.setInterval(() => {
      setChompFrame((f) => (f === 0 ? 1 : 0));
    }, 220);
    return () => {
      if (chompTimerRef.current) window.clearInterval(chompTimerRef.current);
    };
  }, [eating]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eatTimerRef.current) window.clearTimeout(eatTimerRef.current);
      if (chompTimerRef.current) window.clearInterval(chompTimerRef.current);
    };
  }, []);

  function handleTap() {
    if (eating) return;
    setEating(true);
    if (eatTimerRef.current) window.clearTimeout(eatTimerRef.current);
    eatTimerRef.current = window.setTimeout(() => {
      setEating(false);
    }, 1800);
  }

  // The horizontal distance Tim can walk = track width minus his own width.
  const walkDist = Math.max(0, trackWidth - size);

  // Inline CSS — we interpolate trackWidth/size into the keyframes so each
  // instance can have its own size. The class names are namespaced "tim-*"
  // to avoid colliding with anything else in the app.
  const styles = `
    .tim-track {
      position: relative;
      display: inline-block;
      height: ${size + 4}px;
      width: ${trackWidth}px;
      overflow: hidden;
      -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 8px, #000 calc(100% - 8px), transparent 100%);
              mask-image: linear-gradient(90deg, transparent 0, #000 8px, #000 calc(100% - 8px), transparent 100%);
      cursor: pointer;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      vertical-align: middle;
    }
    .tim-walker {
      position: absolute;
      left: 0;
      top: 2px;
      width: ${size}px;
      height: ${size}px;
      animation: tim-pace-${size} 7.2s linear infinite alternate;
      will-change: transform;
    }
    .tim-walker.paused { animation-play-state: paused; }
    @keyframes tim-pace-${size} {
      0%   { transform: translateX(0) scaleX(1); }
      49%  { transform: translateX(${walkDist}px) scaleX(1); }
      50%  { transform: translateX(${walkDist}px) scaleX(-1); }
      99%  { transform: translateX(0) scaleX(-1); }
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
      position: absolute;
      left: 50%;
      bottom: 0;
      width: ${Math.floor(size * 0.55)}px;
      height: ${Math.floor(size * 0.55)}px;
      transform: translateX(-50%);
      animation: tim-banana-rise 1.8s ease-in forwards;
      pointer-events: none;
    }
    @keyframes tim-banana-rise {
      0%   { transform: translate(-50%, 6px); opacity: 0; }
      20%  { transform: translate(-50%, -2px); opacity: 1; }
      70%  { transform: translate(-50%, -10px); opacity: 1; }
      85%  { transform: translate(-50%, -14px); opacity: 0.6; }
      100% { transform: translate(-50%, -16px); opacity: 0; }
    }

    @media (prefers-reduced-motion: reduce) {
      .tim-walker { animation: none; transform: translateX(${Math.floor(walkDist / 2)}px); }
      .tim-walker .leg-a,
      .tim-walker .leg-b { animation: none; }
      .tim-banana { animation: none; opacity: 0; }
    }
  `;

  return (
    <>
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
        <div className={`tim-walker ${eating ? "paused" : ""}`}>
          {eating ? <TimEatingSprite size={size} chompFrame={chompFrame} /> : <TimWalkingSprite size={size} />}
        </div>
        {eating && <BananaSprite />}
      </div>
    </>
  );
}

/* ─────────── Walking sprite ───────────
   16×16 pixel grid scaled up. Tim is a round brown teddy with:
     - 2 ears (small brown squares on top corners)
     - big head/body merged
     - 2 white eye whites with black pupils
     - small black nose + tiny stitched mouth
     - 2 alternating leg sets for the walk cycle */
function TimWalkingSprite({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ display: "block" }}
    >
      {/* Ears */}
      <rect x="2" y="2" width="2" height="2" fill="#6b4a2b" />
      <rect x="12" y="2" width="2" height="2" fill="#6b4a2b" />
      <rect x="2" y="4" width="1" height="1" fill="#f5b7a8" />
      <rect x="13" y="4" width="1" height="1" fill="#f5b7a8" />

      {/* Head/body — main brown blob */}
      <rect x="3" y="3" width="10" height="10" fill="#8b6a40" />
      {/* Lighter belly tuft for depth */}
      <rect x="6" y="9"  width="4" height="3" fill="#a98759" />
      <rect x="6" y="8"  width="4" height="1" fill="#9a774c" />

      {/* Eye whites */}
      <rect x="5" y="6" width="2" height="2" fill="#ffffff" />
      <rect x="9" y="6" width="2" height="2" fill="#ffffff" />
      {/* Pupils */}
      <rect x="6" y="7" width="1" height="1" fill="#1a1a1a" />
      <rect x="10" y="7" width="1" height="1" fill="#1a1a1a" />

      {/* Nose */}
      <rect x="7" y="9" width="2" height="1" fill="#3a2418" />
      {/* Mouth — tiny stitch */}
      <rect x="7" y="10" width="1" height="1" fill="#3a2418" />
      <rect x="8" y="10" width="1" height="1" fill="#3a2418" />

      {/* Cheek blush */}
      <rect x="4" y="8" width="1" height="1" fill="#e89b8c" />
      <rect x="11" y="8" width="1" height="1" fill="#e89b8c" />

      {/* Legs — frame A (left forward, right back) */}
      <g className="leg-a">
        <rect x="4" y="13" width="3" height="2" fill="#6b4a2b" />
        <rect x="9" y="13" width="3" height="2" fill="#7a5635" />
        <rect x="4" y="15" width="3" height="1" fill="#3a2418" />
        <rect x="9" y="15" width="3" height="1" fill="#3a2418" />
      </g>
      {/* Legs — frame B (left back, right forward) */}
      <g className="leg-b">
        <rect x="5" y="13" width="3" height="2" fill="#7a5635" />
        <rect x="8" y="13" width="3" height="2" fill="#6b4a2b" />
        <rect x="5" y="15" width="3" height="1" fill="#3a2418" />
        <rect x="8" y="15" width="3" height="1" fill="#3a2418" />
      </g>
    </svg>
  );
}

/* ─────────── Eating sprite ───────────
   Mouth opens (rectangle in middle) and alternates open/closed via chompFrame.
   Eyes squint to closed (happy "^_^") to convey enjoyment.
   Legs stay still. */
function TimEatingSprite({ size, chompFrame }: { size: number; chompFrame: number }) {
  const mouthOpen = chompFrame === 0;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ display: "block" }}
    >
      {/* Ears */}
      <rect x="2" y="2" width="2" height="2" fill="#6b4a2b" />
      <rect x="12" y="2" width="2" height="2" fill="#6b4a2b" />
      <rect x="2" y="4" width="1" height="1" fill="#f5b7a8" />
      <rect x="13" y="4" width="1" height="1" fill="#f5b7a8" />

      {/* Head/body */}
      <rect x="3" y="3" width="10" height="10" fill="#8b6a40" />
      <rect x="6" y="9"  width="4" height="3" fill="#a98759" />
      <rect x="6" y="8"  width="4" height="1" fill="#9a774c" />

      {/* Happy-squint eyes — small dashes */}
      <rect x="5" y="7" width="2" height="1" fill="#1a1a1a" />
      <rect x="9" y="7" width="2" height="1" fill="#1a1a1a" />

      {/* Nose */}
      <rect x="7" y="9" width="2" height="1" fill="#3a2418" />

      {/* Mouth — opens & closes */}
      {mouthOpen ? (
        <>
          <rect x="6" y="10" width="4" height="2" fill="#3a2418" />
          {/* Pink tongue inside */}
          <rect x="7" y="11" width="2" height="1" fill="#e88aa6" />
        </>
      ) : (
        <rect x="6" y="10" width="4" height="1" fill="#3a2418" />
      )}

      {/* Cheek blush — brighter when eating */}
      <rect x="4" y="8" width="1" height="1" fill="#e0857d" />
      <rect x="11" y="8" width="1" height="1" fill="#e0857d" />

      {/* Static legs */}
      <rect x="4" y="13" width="3" height="2" fill="#6b4a2b" />
      <rect x="9" y="13" width="3" height="2" fill="#6b4a2b" />
      <rect x="4" y="15" width="3" height="1" fill="#3a2418" />
      <rect x="9" y="15" width="3" height="1" fill="#3a2418" />
    </svg>
  );
}

/* ─────────── Banana sprite ───────────
   A tiny pixel banana that floats up to Tim's mouth and disappears. */
function BananaSprite() {
  return (
    <svg
      className="tim-banana"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
    >
      {/* Banana curve — yellow with darker outline */}
      <rect x="2" y="3" width="1" height="3" fill="#caa312" />
      <rect x="3" y="2" width="1" height="2" fill="#caa312" />
      <rect x="3" y="4" width="4" height="3" fill="#f4d04a" />
      <rect x="4" y="7" width="4" height="2" fill="#f4d04a" />
      <rect x="6" y="8" width="3" height="1" fill="#caa312" />
      <rect x="8" y="6" width="1" height="2" fill="#caa312" />
      <rect x="9" y="5" width="1" height="1" fill="#caa312" />
      {/* Stem */}
      <rect x="3" y="1" width="1" height="1" fill="#5a4419" />
      <rect x="4" y="0" width="1" height="1" fill="#5a4419" />
      {/* Highlight */}
      <rect x="5" y="5" width="2" height="1" fill="#fde487" />
    </svg>
  );
}
