# Task 6-b — OpeningsLesson component

## Status: COMPLETE ✅

## File created (only one app file)
- `src/components/chess/openings-lesson.tsx` — interactive "Opening Lesson" (learn-by-playing) component.

## Export signature (exact, as specified)
```tsx
export interface OpeningsLessonProps {
  opening: Opening;          // from "@/lib/puzzles"
  onClose: () => void;
  onComplete: (id: string) => void; // fired ONCE (ref-guarded) when user completes the line in PLAY mode
}
export function OpeningsLesson({ opening, onClose, onComplete }: OpeningsLessonProps)
```

## Implementation notes (for integrating agents)
- **Play mode (default)**: learner plays `opening.side`. Board is interactive only in play mode & before line completion. Correct scripted move → applied with `move`/`capture` sound; opponent's scripted reply auto-applies after ~450 ms via a cleanup-safe effect (also covers side="Black" where White must auto-open). Wrong moves → framer-motion shake (x keyframes `[0,-8,8,-5,5,0]` via `useAnimationControls`), inline message `The <ShortName> goes <san> here — try again`, `illegal` sound, auto-clears after 2.8 s. SAN comparison normalizes `+`/`#` suffixes and forces `=Q` promotion normalization; auto-queen applied directly (promotion picker never shown: `pendingPromotion` is always `null`).
- **Watch mode**: `startWatch` (event-handler context, not an effect body — required by the new `react-hooks/set-state-in-effect` lint rule) resets the line and schedules one move per ~950 ms into `watchTimersRef`; Stop clears timers synchronously and returns to play mode from move 0. Reset inside watch mode restarts the demo.
- **Step controls**: back/forward (play mode only; forward replays scripted moves via full position rebuild), reset. Progress dots: filled=done, gold ring=current; a `role="progressbar"` wrapper + `x/y` counter.
- **Completion**: final move played by the USER in play mode → `onComplete(opening.id)` exactly once (`completedRef` guard), gold/emerald confetti (`["#e9c96b","#c9a24b","#38e0af","#fdf6dc"]`), banner "Opening mastered +10 XP". Final note + "Start over" shown when line complete.
- **React 19 lint compliance (important for other chess components)**: eslint-config-next 16 enables `react-hooks/refs` and `react-hooks/set-state-in-effect`. Therefore: NO `ref.current` access during render (render-derived values use a pure `useMemo(() => new Chess(fen), [fen])` view; the mutable `gameRef` is touched only in handlers/effects/timers), and NO synchronous setState in effect bodies (watch reset lives in the event handler).
- **Sounds used**: `move`, `capture`, `select`, `illegal` (from `@/lib/sounds`). `promote` intentionally unused — openings never promote.
- **Icons used**: Check, Eye, GraduationCap, Lightbulb, Play, Quote, RotateCcw, Square (aliased `SquareIcon` to avoid chess.js `Square` type clash), StepBack, StepForward, X.
- **Styles**: `glass-panel rounded-2xl p-4 sm:p-6`, `font-display` + `text-gold-gradient` heading, ECO pill badge, gold/ghost Button overrides matching sidebars.tsx, `rounded-xl border border-white/8 bg-white/[0.03]` cards, `board-frame` wrapper around `ChessBoard`, responsive `lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]`, mobile board `max-w-[440px] mx-auto`, all controls h-10 with aria-labels.
- **Verification**: `bun run lint` → zero findings for this file (remaining repo warnings are pre-existing in `src/hooks/use-analysis.ts`); `bunx tsc --noEmit` → clean for this file. TypeScript strict, no `any`, no imports from `@/hooks/use-chess-game` (local `PromotionPiece = "q" | "r" | "b" | "n"` union instead).
- All timeouts cleared on unmount (watch timers ref + message timer ref).
