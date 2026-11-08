"use client";

import { useId } from "react";
import type { CSSProperties } from "react";
import type { Color, PieceSymbol } from "chess.js";

/**
 * Sovereign piece set — hand-sculpted geometric SVG pieces.
 * White: pearl ivory with bronze-gold trim. Black: obsidian with gold trim.
 */

interface PieceSvgProps {
  type: PieceSymbol;
  color: Color;
  className?: string;
  style?: CSSProperties;
}

export function PieceSvg({ type, color, className, style }: PieceSvgProps) {
  const uid = useId().replace(/[:]/g, "");
  const bodyId = `body-${uid}`;
  const sheenId = `sheen-${uid}`;

  const isWhite = color === "w";
  const stroke = isWhite ? "#7a5a20" : "#d9b45b";
  const detail = isWhite ? "#7a5a20" : "#d9b45b";
  const strokeWidth = 3;

  const bodyFill = `url(#${bodyId})`;
  const defs = (
    <defs>
      <linearGradient
        id={bodyId}
        gradientUnits="userSpaceOnUse"
        x1="30"
        y1="10"
        x2="70"
        y2="90"
      >
        {isWhite ? (
          <>
            <stop offset="0%" stopColor="#fffdf4" />
            <stop offset="45%" stopColor="#f0e5c9" />
            <stop offset="80%" stopColor="#d6c69d" />
            <stop offset="100%" stopColor="#b9a878" />
          </>
        ) : (
          <>
            <stop offset="0%" stopColor="#585e6e" />
            <stop offset="40%" stopColor="#2c303b" />
            <stop offset="78%" stopColor="#15171d" />
            <stop offset="100%" stopColor="#08090c" />
          </>
        )}
      </linearGradient>
      <radialGradient id={sheenId} cx="0.35" cy="0.25" r="0.55">
        <stop
          offset="0%"
          stopColor="#ffffff"
          stopOpacity={isWhite ? 0.5 : 0.22}
        />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </radialGradient>
    </defs>
  );

  const base = (x = 26, w = 48) => (
    <rect x={x} y={74} width={w} height={12} rx={5} fill={bodyFill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
  );

  const shapes: Record<PieceSymbol, React.ReactNode> = {
    p: (
      <>
        <circle cx="50" cy="32" r="12" fill={bodyFill} stroke={stroke} strokeWidth={strokeWidth} />
        <rect x="38" y="44" width="24" height="4.5" rx="2.25" fill={bodyFill} stroke={stroke} strokeWidth="2.4" />
        <path
          d="M42,49 L58,49 C58,57 63,65 65,74 L35,74 C37,65 42,57 42,49 Z"
          fill={bodyFill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
        {base(29, 42)}
      </>
    ),
    r: (
      <>
        <path
          d="M31,20 L31,34 L69,34 L69,20 L60,20 L60,27 L55,27 L55,20 L45,20 L45,27 L40,27 L40,20 Z"
          fill={bodyFill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
        <path
          d="M35,34 L65,34 L63,41 L37,41 Z"
          fill={bodyFill}
          stroke={stroke}
          strokeWidth="2.6"
          strokeLinejoin="round"
        />
        <path
          d="M38,41 L62,41 L64,74 L36,74 Z"
          fill={bodyFill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
        {base(27, 46)}
      </>
    ),
    n: (
      <>
        <path
          d="M32,74 C32,62 36,55 44,50 C38,48 34,43 34,38 C34,34 36,32 39,31 L45,28 C46,25 48,24 49,21 L51,13 L55,20 C58,19 60,20 61,22 L66,15 L67,24 C74,32 78,44 78,58 C78,68 76,74 74,74 Z"
          fill={bodyFill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx="47" cy="30" r="1.8" fill={detail} opacity="0.9" />
        <path d="M37,35.5 q-2,2.2 0.4,3.6" fill="none" stroke={detail} strokeWidth="1.8" strokeLinecap="round" opacity="0.85" />
        <path
          d="M61,24 C67,33 71,45 71.5,58"
          fill="none"
          stroke={detail}
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.55"
        />
        {base(27, 46)}
      </>
    ),
    b: (
      <>
        <circle cx="50" cy="15" r="4.5" fill={bodyFill} stroke={stroke} strokeWidth="2.6" />
        <path
          d="M50,21 C56,26 63,35 64.5,44 C66,54 59.5,60.5 50,60.5 C40.5,60.5 34,54 35.5,44 C37,35 44,26 50,21 Z"
          fill={bodyFill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
        <path d="M56,28.5 C53.5,32 48.5,39 45,44.5" stroke={detail} strokeWidth="2.8" strokeLinecap="round" opacity="0.85" fill="none" />
        <rect x="38.5" y="60.5" width="23" height="4.5" rx="2.25" fill={bodyFill} stroke={stroke} strokeWidth="2.2" />
        <path
          d="M42,65.5 L58,65.5 C58,70 62,72.5 63.5,74 L36.5,74 C38,72.5 42,70 42,65.5 Z"
          fill={bodyFill}
          stroke={stroke}
          strokeWidth="2.6"
          strokeLinejoin="round"
        />
        {base(28, 44)}
      </>
    ),
    q: (
      <>
        {[
          [25, 23],
          [37, 17],
          [50, 13],
          [63, 17],
          [75, 23],
        ].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="3.4" fill={bodyFill} stroke={stroke} strokeWidth="2.2" />
        ))}
        <path
          d="M28,52 L25,26 L36,41 L37,20 L46,39 L50,16 L54,39 L63,20 L64,41 L75,26 L72,52 Z"
          fill={bodyFill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
        <rect x="32" y="52" width="36" height="5" rx="2.5" fill={bodyFill} stroke={stroke} strokeWidth="2.2" />
        <path
          d="M34,57 C34,63 30,69 28,74 L72,74 C70,69 66,63 66,57 Z"
          fill={bodyFill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
        {base(26, 48)}
      </>
    ),
    k: (
      <>
        <rect x="47.6" y="6" width="5.2" height="15" rx="1.8" fill={bodyFill} stroke={stroke} strokeWidth="2.4" />
        <rect x="42" y="10.5" width="16" height="5.2" rx="1.8" fill={bodyFill} stroke={stroke} strokeWidth="2.4" />
        <path
          d="M35,49 C35,34 42,26 50,26 C58,26 65,34 65,49 Z"
          fill={bodyFill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
        <rect x="31" y="49" width="38" height="6" rx="3" fill={bodyFill} stroke={stroke} strokeWidth="2.4" />
        <path
          d="M37,55.5 L63,55.5 C63,63 67,69 69,74 L31,74 C33,69 37,63 37,55.5 Z"
          fill={bodyFill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
        {base(26, 48)}
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {defs}
      <ellipse cx="50" cy="88" rx="26" ry="4.5" fill="#000" opacity="0.28" />
      {shapes[type]}
      {/* sheen overlay */}
      <ellipse cx="42" cy="34" rx="22" ry="28" fill={`url(#${sheenId})`} pointerEvents="none" />
    </svg>
  );
}

/** Tiny piece glyph used in captured-pieces rows and move lists. */
export function PieceGlyph({
  type,
  color,
  size = 18,
  className,
}: {
  type: PieceSymbol;
  color: Color;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={className}
      style={{ width: size, height: size, display: "inline-block" }}
    >
      <PieceSvg type={type} color={color} style={{ width: "100%", height: "100%" }} />
    </span>
  );
}
