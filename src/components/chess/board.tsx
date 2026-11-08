"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Color, Move, PieceSymbol, Square } from "chess.js";
import { PieceSvg } from "./piece-svg";
import type { PieceView, PromotionPiece } from "@/hooks/use-chess-game";
import { cn } from "@/lib/utils";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

function squareName(file: number, rank: number): Square {
  return `${FILES[file]}${rank}` as Square;
}

/** view coordinates (col, row from top-left) for a square given orientation */
function viewCoords(square: Square, orientation: "white" | "black") {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const col = orientation === "white" ? file : 7 - file;
  const row = orientation === "white" ? 8 - rank : rank - 1;
  return { col, row };
}

interface ChessBoardProps {
  pieces: PieceView[];
  orientation: "white" | "black";
  turnColor: Color;
  selected: Square | null;
  legalTargets: Move[];
  lastMove: { from: Square; to: Square } | null;
  checkedSquare: Square | null;
  hint: { from: Square; to: Square } | null;
  interactive: boolean;
  showLegal: boolean;
  showCoords: boolean;
  pendingPromotion: { from: Square; to: Square } | null;
  promotionColor: Color;
  /** allow selecting pieces of EITHER color (free analysis board) */
  bothSides?: boolean;
  onSelect: (square: Square | null) => void;
  onMoveAttempt: (from: Square, to: Square) => boolean;
  onPromote: (piece: PromotionPiece) => void;
  onCancelPromotion: () => void;
  onFirstGesture: () => void;
}

interface InteractionRef {
  square: Square;
  startX: number;
  startY: number;
  pieceId: string | null;
  moved: boolean;
}

const PROMO_ORDER: PromotionPiece[] = ["q", "n", "r", "b"];

export function ChessBoard({
  pieces,
  orientation,
  turnColor,
  selected,
  legalTargets,
  lastMove,
  checkedSquare,
  hint,
  interactive,
  showLegal,
  showCoords,
  pendingPromotion,
  promotionColor,
  bothSides = false,
  onSelect,
  onMoveAttempt,
  onPromote,
  onCancelPromotion,
  onFirstGesture,
}: ChessBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<InteractionRef | null>(null);
  const [drag, setDrag] = useState<{
    pieceId: string;
    x: number;
    y: number;
  } | null>(null);
  const [dragOver, setDragOver] = useState<Square | null>(null);

  const targetSet = useMemo(
    () => new Set(legalTargets.map((m) => m.to)),
    [legalTargets]
  );
  const captureSet = useMemo(
    () =>
      new Set(
        legalTargets.filter((m) => m.captured || m.flags.includes("e")).map((m) => m.to)
      ),
    [legalTargets]
  );

  const pieceAt = useCallback(
    (square: Square) => pieces.find((p) => p.square === square && !p.captured),
    [pieces]
  );

  const squareFromEvent = useCallback(
    (clientX: number, clientY: number): Square | null => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const col = Math.floor(((clientX - rect.left) / rect.width) * 8);
      const row = Math.floor(((clientY - rect.top) / rect.height) * 8);
      if (col < 0 || col > 7 || row < 0 || row > 7) return null;
      const file = orientation === "white" ? col : 7 - col;
      const rank = orientation === "white" ? 8 - row : row + 1;
      return squareName(file, rank);
    },
    [orientation]
  );

  // ---- pointer handlers ----
  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      onFirstGesture();
      if (!interactive || e.button !== 0) {
        // safety: never leave stale drag visuals when interaction is locked
        interactionRef.current = null;
        setDrag(null);
        setDragOver(null);
        return;
      }
      const square = squareFromEvent(e.clientX, e.clientY);
      if (!square) return;
      const piece = pieceAt(square);
      const selectable =
        piece && (bothSides || piece.color === turnColor);
      interactionRef.current = {
        square,
        startX: e.clientX,
        startY: e.clientY,
        pieceId: selectable ? piece!.id : null,
        moved: false,
      };
      // NOTE: selection happens on pointer-up (click) or drag-start, never here,
      // otherwise pointerdown+pointerup would toggle the piece right back off.
      try {
        boardRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    },
    [interactive, squareFromEvent, pieceAt, turnColor, bothSides, onFirstGesture]
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const it = interactionRef.current;
      if (!it || !it.pieceId) return;
      const dx = e.clientX - it.startX;
      const dy = e.clientY - it.startY;
      if (!it.moved && Math.hypot(dx, dy) < 6) return;
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (!it.moved) {
        it.moved = true;
        onSelect(it.square); // reveal legal targets while dragging
      }
      const squareSize = rect.width / 8;
      const p = pieces.find((x) => x.id === it.pieceId);
      const base = p ? viewCoords(p.square, orientation) : { col: 0, row: 0 };
      setDrag({
        pieceId: it.pieceId,
        x: base.col * squareSize + dx,
        y: base.row * squareSize + dy,
      });
      const over = squareFromEvent(e.clientX, e.clientY);
      setDragOver(over && over !== it.square && targetSet.has(over) ? over : null);
    },
    [onSelect, orientation, pieces, squareFromEvent, targetSet]
  );

  const finishDrag = useCallback(
    (it: InteractionRef, clientX: number, clientY: number) => {
      setDrag(null);
      setDragOver(null);
      if (!it.moved || !it.pieceId) return;
      const target = squareFromEvent(clientX, clientY);
      if (target && target !== it.square) {
        onMoveAttempt(it.square, target);
      }
    },
    [squareFromEvent, onMoveAttempt]
  );

  const handleClick = useCallback(
    (square: Square) => {
      const piece = pieceAt(square);
      if (piece && (bothSides || piece.color === turnColor)) {
        onSelect(square); // toggles if same
        return;
      }
      if (selected && targetSet.has(square)) {
        onMoveAttempt(selected, square);
        return;
      }
      onSelect(null);
    },
    [pieceAt, turnColor, bothSides, onSelect, selected, targetSet, onMoveAttempt]
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const it = interactionRef.current;
      interactionRef.current = null;
      if (!it) return;
      if (it.moved) {
        finishDrag(it, e.clientX, e.clientY);
      } else if (interactive) {
        handleClick(it.square);
      } else {
        setDrag(null);
        setDragOver(null);
      }
    },
    [finishDrag, handleClick, interactive]
  );

  const handlePointerCancel = useCallback(() => {
    interactionRef.current = null;
    setDrag(null);
    setDragOver(null);
  }, []);

  // ---- promotion picker geometry ----
  const promo = useMemo(() => {
    if (!pendingPromotion) return null;
    const { col, row } = viewCoords(pendingPromotion.to, orientation);
    const fromTop = row === 0;
    return { col, fromTop };
  }, [pendingPromotion, orientation]);

  // ---- hint arrow geometry (viewBox 0 0 800 800) ----
  const arrow = useMemo(() => {
    if (!hint) return null;
    const a = viewCoords(hint.from, orientation);
    const b = viewCoords(hint.to, orientation);
    const ax = a.col * 100 + 50;
    const ay = a.row * 100 + 50;
    const bx = b.col * 100 + 50;
    const by = b.row * 100 + 50;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const endX = (ax + dx * 0.72) * 8;
    const endY = (ay + dy * 0.72) * 8;
    const tipX = (ax + dx * 0.94) * 8;
    const tipY = (ay + dy * 0.94) * 8;
    const wing = 26;
    const p1x = tipX + px * wing;
    const p1y = tipY + py * wing;
    const p2x = ax * 8 + dx * 0.78 * 8;
    const p2y = ay * 8 + dy * 0.78 * 8;
    const p3x = tipX - px * wing;
    const p3y = tipY - py * wing;
    return { ax: ax * 8, ay: ay * 8, endX, endY, tipX, tipY, points: `${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y}` };
  }, [hint, orientation]);

  return (
    <div
      ref={boardRef}
      className={cn(
        "relative aspect-square w-full overflow-hidden rounded-lg select-none touch-none",
        interactive ? "cursor-pointer" : "cursor-default"
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      role="grid"
      aria-label="Chess board"
    >
      {/* squares */}
      <div className="absolute inset-0 grid grid-cols-8 grid-rows-8">
        {Array.from({ length: 64 }, (_, i) => {
          const col = i % 8;
          const row = Math.floor(i / 8);
          const file = orientation === "white" ? col : 7 - col;
          const rank = orientation === "white" ? 8 - row : row + 1;
          const square = squareName(file, rank);
          const isLight = (file + rank) % 2 === 1;
          return (
            <div
              key={square}
              className={cn("relative", isLight ? "sq-light" : "sq-dark")}
            >
              {showCoords && row === 7 && (
                <span
                  className={cn(
                    "coord-label absolute bottom-0.5 right-1",
                    isLight ? "text-[#1d4a3c]" : "text-[#e6d3a0]"
                  )}
                >
                  {FILES[file]}
                </span>
              )}
              {showCoords && col === 0 && (
                <span
                  className={cn(
                    "coord-label absolute left-1 top-0.5",
                    isLight ? "text-[#1d4a3c]" : "text-[#e6d3a0]"
                  )}
                >
                  {rank}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* highlight overlays */}
      <div className="pointer-events-none absolute inset-0">
        {lastMove && (
          <>
            <HighlightCell square={lastMove.from} orientation={orientation} className="hl-lastmove" />
            <HighlightCell square={lastMove.to} orientation={orientation} className="hl-lastmove" />
          </>
        )}
        {selected && (
          <HighlightCell square={selected} orientation={orientation} className="hl-selected" />
        )}
        {hint && (
          <>
            <HighlightCell square={hint.from} orientation={orientation} className="hl-hint-from" />
            <HighlightCell square={hint.to} orientation={orientation} className="hl-hint-to" />
          </>
        )}
        {dragOver && (
          <HighlightCell square={dragOver} orientation={orientation} className="hl-hint-to" />
        )}
        {checkedSquare && (
          <HighlightCell square={checkedSquare} orientation={orientation} className="hl-check" />
        )}
        {showLegal &&
          selected &&
          legalTargets.map((m) => {
            const { col, row } = viewCoords(m.to, orientation);
            const isCapture = captureSet.has(m.to);
            return (
              <div
                key={`t-${m.from}${m.to}${m.promotion ?? ""}`}
                className="absolute flex items-center justify-center"
                style={{
                  left: `${col * 12.5}%`,
                  top: `${row * 12.5}%`,
                  width: "12.5%",
                  height: "12.5%",
                }}
              >
                {isCapture ? (
                  <span className="dot-capture" />
                ) : (
                  <span className="dot-move" />
                )}
              </div>
            );
          })}
      </div>

      {/* pieces */}
      <div className="pointer-events-none absolute inset-0">
        {pieces.map((p) => {
          const { col, row } = viewCoords(p.square, orientation);
          const isDragging = drag?.pieceId === p.id && !p.captured;
          const style: CSSProperties = {
            left: 0,
            top: 0,
            width: "12.5%",
            height: "12.5%",
            zIndex: isDragging ? 50 : p.captured ? 5 : 10,
            transform: isDragging
              ? `translate(${drag!.x}px, ${drag!.y}px) scale(1.16)`
              : `translate(${col * 100}%, ${row * 100}%)`,
            transition: isDragging ? "none" : undefined,
          };
          return (
            <div
              key={p.id}
              className={cn("absolute", !isDragging && "piece-anim")}
              style={style}
            >
              <div
                className={cn(
                  "h-full w-full",
                  p.captured
                    ? "piece-captured"
                    : p.spawn
                      ? "piece-spawn"
                      : "piece-shadow",
                  !isDragging &&
                    !p.captured &&
                    interactive &&
                    (bothSides || p.color === turnColor) &&
                    "piece-hoverable"
                )}
                style={p.spawn ? { animationDelay: `${p.spawnDelay ?? 0}ms` } : undefined}
              >
                <PieceSvg
                  type={p.type}
                  color={p.color}
                  style={{ width: "100%", height: "100%", display: "block" }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* hint arrow */}
      {arrow && (
        <svg
          viewBox="0 0 800 800"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="hint-arrow-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#38e0af" />
              <stop offset="100%" stopColor="#e9c96b" />
            </linearGradient>
          </defs>
          <line
            x1={arrow.ax}
            y1={arrow.ay}
            x2={arrow.endX}
            y2={arrow.endY}
            stroke="url(#hint-arrow-grad)"
            strokeWidth="22"
            strokeLinecap="round"
            opacity="0.9"
          />
          <polygon points={arrow.points} fill="#38e0af" opacity="0.95" />
        </svg>
      )}

      {/* promotion picker */}
      {promo && (
        <div
          className="absolute inset-0 z-[60] bg-black/55 backdrop-blur-[2px]"
          onPointerDown={(e) => {
            e.stopPropagation();
            onCancelPromotion();
          }}
        >
          <div
            className="absolute flex flex-col shadow-2xl"
            style={{
              left: `${promo.col * 12.5}%`,
              top: promo.fromTop ? 0 : undefined,
              bottom: promo.fromTop ? undefined : 0,
              width: "12.5%",
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {PROMO_ORDER.map((pieceType, i) => (
              <button
                key={pieceType}
                type="button"
                aria-label={`Promote to ${pieceType}`}
                className="group relative aspect-square w-full outline-none ring-gold/60 focus-visible:ring-2"
                style={{ order: promo.fromTop ? i : PROMO_ORDER.length - i }}
                onClick={() => onPromote(pieceType)}
              >
                <span className="absolute inset-0 bg-gradient-to-b from-[#0e342c]/95 to-[#1c5a48]/95 transition-colors group-hover:from-[#e9c96b]/90 group-hover:to-[#c9a24b]/90" />
                <span className="absolute inset-[8%] transition-transform group-hover:scale-110">
                  <PieceSvg
                    type={pieceType as PieceSymbol}
                    color={promotionColor}
                    style={{ width: "100%", height: "100%" }}
                  />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* inner border */}
      <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-black/40" />
    </div>
  );
}

function HighlightCell({
  square,
  orientation,
  className,
}: {
  square: Square;
  orientation: "white" | "black";
  className?: string;
}) {
  const { col, row } = viewCoords(square, orientation);
  return (
    <div
      className={cn("absolute", className)}
      style={{
        left: `${col * 12.5}%`,
        top: `${row * 12.5}%`,
        width: "12.5%",
        height: "12.5%",
      }}
    />
  );
}
