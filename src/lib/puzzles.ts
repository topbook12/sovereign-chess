/**
 * Learning curriculum: verified tactics puzzles and opening mini-lessons.
 *
 * Each puzzle line lists the SANs the solver must find (userMoves) and the
 * acceptable opponent replies after each of them (replies[i] — the first legal
 * one is auto-played). Multiple lines allow equivalent first moves.
 */

export type Tier = "easy" | "medium" | "hard";

export interface PuzzleLine {
  userMoves: string[];
  /** replies[i] = acceptable opponent answers after userMoves[i] */
  replies: string[][];
}

export interface Puzzle {
  id: string;
  title: string;
  fen: string;
  tier: Tier;
  theme: string;
  goal: string;
  hint: string;
  insight: string;
  lines: PuzzleLine[];
}

export const PUZZLES: Puzzle[] = [
  {
    id: "back-rank-1",
    title: "Back-Rank Strike",
    fen: "6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1",
    tier: "easy",
    theme: "Back rank",
    goal: "White to move — mate in 1",
    hint: "The king's escape squares are blocked by his own pawns…",
    insight:
      "A rook to the 8th rank mates because the pawn shield that protects the king also imprisons it. Watch your own back rank too!",
    lines: [{ userMoves: ["Re8#"], replies: [[]] }],
  },
  {
    id: "punish-queen",
    title: "Punish the Queen",
    fen: "3q2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1",
    tier: "easy",
    theme: "Hanging piece",
    goal: "White to move — find the winning strike",
    hint: "Is anything defended on the 8th rank?",
    insight:
      "The undefended queen on d8 walks straight into a rook — and because the king is buried behind its pawns, the rook lands with checkmate.",
    lines: [{ userMoves: ["Rxd8#"], replies: [[]] }],
  },
  {
    id: "queen-coronation",
    title: "Queen's Coronation",
    fen: "6k1/5ppp/8/8/8/8/5PPP/3Q2K1 w - - 0 1",
    tier: "easy",
    theme: "Back rank",
    goal: "White to move — mate in 1",
    hint: "The queen travels the whole open file in one step.",
    insight:
      "Queens rule open files. With f8 and h8 covered by the queen's long range, the king has nowhere to run.",
    lines: [{ userMoves: ["Qd8#"], replies: [[]] }],
  },
  {
    id: "philidor-legacy",
    title: "Philidor's Legacy",
    fen: "6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1",
    tier: "medium",
    theme: "Smothered mate",
    goal: "White to move — mate in 1",
    hint: "The king's own rook and pawns are his jailers.",
    insight:
      "The smothered mate: a knight checks a king that is boxed in by its own army. This is the final step of one of the oldest combinations in chess.",
    lines: [{ userMoves: ["Nf7#"], replies: [[]] }],
  },
  {
    id: "knights-fork",
    title: "The Knight's Fork",
    fen: "6k1/3q1p1p/8/8/4N3/8/8/6K1 w - - 0 1",
    tier: "medium",
    theme: "Fork",
    goal: "White to move — win the queen",
    hint: "Find the square that touches both the king and the queen.",
    insight:
      "Nf6+ hits the king and queen at once — a royal fork. Checks come first: Black must step out of check, then the knight collects the queen.",
    lines: [
      {
        userMoves: ["Nf6+", "Nxd7"],
        replies: [["Kf8", "Kh8"], []],
      },
    ],
  },
  {
    id: "long-diagonal",
    title: "The Long Diagonal",
    fen: "1k6/8/8/8/4B3/8/5K2/7q w - - 0 1",
    tier: "medium",
    theme: "Skewer",
    goal: "White to move — win the queen",
    hint: "Bishops love long diagonals with two targets in a row.",
    insight:
      "A skewer: the bishop checks the king through to the queen behind it. The king steps aside, and the bishop claims the prize down the same line.",
    lines: [
      {
        userMoves: ["Bd5+", "Bxh1"],
        replies: [["Ka6", "Ka7", "Kb8", "Kc7", "Kc8"], []],
      },
    ],
  },
  {
    id: "royal-fork-rook",
    title: "The Royal Fork",
    fen: "2r3k1/5ppp/2N5/8/8/8/8/6K1 w - - 0 1",
    tier: "medium",
    theme: "Fork",
    goal: "White to move — win the rook",
    hint: "One square touches the king and the rook at the same time.",
    insight:
      "Ne7+ forks king and rook in one gesture. Knights are the only pieces that attack over walls — that leap is their superpower.",
    lines: [
      {
        userMoves: ["Ne7+", "Nxc8"],
        replies: [["Kf8", "Kh8"], []],
      },
    ],
  },
  {
    id: "king-opposition",
    title: "Triangulate & Crown",
    fen: "7k/8/8/6K1/8/8/8/Q7 w - - 0 1",
    tier: "hard",
    theme: "King + Queen mate",
    goal: "White to move — mate in 2",
    hint: "Bring the KING first — the queen alone cannot deliver.",
    insight:
      "In king-and-queen endings the king does the squeezing: Kg6 takes the opposition, and the queen delivers from a distance. Queens mate best from afar.",
    lines: [{ userMoves: ["Kg6", "Qa8#"], replies: [["Kg8"], []] }],
  },
  {
    id: "rook-king-technique",
    title: "King Leads, Rook Delivers",
    fen: "7k/8/5K2/8/8/8/8/R7 w - - 0 1",
    tier: "hard",
    theme: "King + Rook mate",
    goal: "White to move — mate in 2",
    hint: "The rook wants the 8th rank — but only after the king arrives.",
    insight:
      "Golden rook-endgame rule: the king walks in FRONT, the rook checks from behind. Kg6 traps the king on the back rank; Ra8# ends it.",
    lines: [{ userMoves: ["Kg6", "Ra8#"], replies: [["Kg8"], []] }],
  },
  {
    id: "rook-ladder",
    title: "The Ladder",
    fen: "7k/8/8/8/8/8/1R6/R6K w - - 0 1",
    tier: "hard",
    theme: "Two rooks",
    goal: "White to move — mate in 2",
    hint: "One rook cuts the 7th rank, the other checks the 8th.",
    insight:
      "Two rooks mate by ladder: the far rook fences off a rank, the near rook delivers check. Rooks are strongest when they work in relay.",
    lines: [
      { userMoves: ["Ra7", "Rb8#"], replies: [["Kg8"], []] },
      { userMoves: ["Rb7", "Ra8#"], replies: [["Kg8"], []] },
    ],
  },
];

/* ------------------------------ openings ------------------------------ */

export interface OpeningMove {
  san: string;
  note: string;
}

export interface Opening {
  id: string;
  name: string;
  eco: string;
  side: "White" | "Black";
  tagline: string;
  moves: OpeningMove[];
  ideas: string[];
  motto: string;
}

export const OPENINGS: Opening[] = [
  {
    id: "italian",
    name: "Italian Game",
    eco: "C50",
    side: "White",
    tagline: "The classical gateway to chess strategy",
    moves: [
      { san: "e4", note: "Claim the centre and open diagonals for king and queen." },
      { san: "e5", note: "Black mirrors — the classical, principled answer." },
      { san: "Nf3", note: "Develop with tempo, attacking the e5-pawn." },
      { san: "Nc6", note: "Black defends e5 while developing a piece." },
      { san: "Bc4", note: "The Italian bishop stares at f7 — Black's weakest square." },
    ],
    ideas: [
      "Fast, natural development",
      "Pressure f7 for an early kingside attack",
      "The perfect first opening to learn",
    ],
    motto: "Develop knights before bishops, pawns before pieces.",
  },
  {
    id: "sicilian",
    name: "Sicilian Defense",
    eco: "B20",
    side: "Black",
    tagline: "The sharpest counter-punch in chess",
    moves: [
      { san: "e4", note: "White stakes a claim in the centre." },
      { san: "c5", note: "Black strikes back — an asymmetrical, fighting reply." },
      { san: "Nf3", note: "White develops and prepares d4." },
      { san: "d6", note: "Black supports a future ...Nf6 and keeps the c5 grip." },
      { san: "d4", note: "White opens the centre — the critical test." },
      { san: "cxd4", note: "Black trades, unbalancing the pawn structure." },
      { san: "Nxd4", note: "White recaptures and enjoys extra central space." },
      { san: "Nf6", note: "Black develops and hits the e4-pawn." },
    ],
    ideas: [
      "Counter-attack instead of mirroring",
      "Trade a wing pawn for a central one",
      "Rich, double-edged middlegames",
    ],
    motto: "Meet force with counter-force.",
  },
  {
    id: "queens-gambit",
    name: "Queen's Gambit",
    eco: "D06",
    side: "White",
    tagline: "The most classical gambit in the royal game",
    moves: [
      { san: "d4", note: "Control the centre with the queen's pawn." },
      { san: "d5", note: "Black stakes an equal claim." },
      { san: "c4", note: "The gambit! A wing pawn is offered to deflect d5." },
      { san: "e6", note: "Black declines — keeping the centre solid." },
      { san: "Nc3", note: "Natural development, adding pressure on d5." },
      { san: "Nf6", note: "Black develops and defends d5 indirectly." },
    ],
    ideas: [
      "Trade a wing pawn for lasting central control",
      "Play cxd5 anytime to open the c-file",
      "Enduring strategic richness for both sides",
    ],
    motto: "A pawn is a small price for the centre.",
  },
  {
    id: "london",
    name: "London System",
    eco: "D02",
    side: "White",
    tagline: "A rock-solid system you can play forever",
    moves: [
      { san: "d4", note: "A solid central pawn stake." },
      { san: "d5", note: "Black takes up the central challenge." },
      { san: "Nf3", note: "Development before commitment." },
      { san: "Nf6", note: "Black mirrors healthy development." },
      { san: "Bf4", note: "The London bishop — parked safely outside the pawn chain." },
      { san: "e6", note: "Black builds the e6–d5 fortress." },
      { san: "e3", note: "White completes the famous golden triangle." },
    ],
    ideas: [
      "A system, not a memory test",
      "The same safe setup against almost anything",
      "Perfect for rapid and blitz",
    ],
    motto: "Build the fortress, then storm out of it.",
  },
];
