/**
 * Sovereign Engine Core — a fast 0x88 mailbox chess engine.
 *
 * chess.js stays the authoritative rules keeper for the UI; this module is a
 * self-contained search machine (movegen + make/unmake + eval + alpha-beta)
 * seeded from a FEN, roughly two orders of magnitude faster than driving
 * chess.js per node.
 *
 * Board: Int8Array(128), 0x88 layout. a1 = 0, h8 = 119.
 * White pieces positive (P=1 N=2 B=3 R=4 Q=5 K=6), black negative.
 */

export const WP = 1;
export const WN = 2;
export const WB = 3;
export const WR = 4;
export const WQ = 5;
export const WK = 6;

const PIECE_VALUE = [0, 100, 320, 330, 500, 900, 20000];

const KNIGHT_OFFSETS = [33, 31, 18, 14, -33, -31, -18, -14];
const KING_OFFSETS = [16, -16, 1, -1, 17, 15, -17, -15];
const BISHOP_DIRS = [17, 15, -17, -15];
const ROOK_DIRS = [16, -16, 1, -1];

// castling rights bits
const CR_WK = 1;
const CR_WQ = 2;
const CR_BK = 4;
const CR_BQ = 8;

const A1 = 0x00;
const E1 = 0x04;
const H1 = 0x07;
const A8 = 0x70;
const E8 = 0x74;
const H8 = 0x77;

interface Move {
  from: number;
  to: number;
  piece: number;
  capt: number; // 0 = none
  promo: number; // 0 = none
  flag: 0 | 1 | 2 | 3 | 4; // 0 normal, 1 double push, 2 en passant, 3 castle K, 4 castle Q
}

interface Undo {
  move: Move;
  capt: number;
  castling: number;
  ep: number; // 0x88 square or -1
  halfmove: number;
}

export class Position {
  board = new Int8Array(128);
  whiteToMove = true;
  castling = 0;
  ep = -1; // 0x88 square behind a double-pushed pawn, or -1
  halfmove = 0;
  wk = E1;
  bk = E8;
  private undoStack: Undo[] = [];

  constructor(fen: string) {
    this.load(fen);
  }

  load(fen: string) {
    this.board.fill(0);
    const parts = fen.trim().split(/\s+/);
    const rows = parts[0].split("/");
    for (let r = 0; r < 8; r++) {
      // rows[0] = rank 8
      let file = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) {
          file += Number(ch);
          continue;
        }
        const sq = (7 - r) * 16 + file;
        const code = "PNBRQK".indexOf(ch.toUpperCase()) + 1;
        this.board[sq] = ch === ch.toUpperCase() ? code : -code;
        if (code === 6) {
          if (this.board[sq] > 0) this.wk = sq;
          else this.bk = sq;
        }
        file++;
      }
    }
    this.whiteToMove = parts[1] !== "b";
    this.castling = 0;
    const cr = parts[2] ?? "-";
    if (cr.includes("K")) this.castling |= CR_WK;
    if (cr.includes("Q")) this.castling |= CR_WQ;
    if (cr.includes("k")) this.castling |= CR_BK;
    if (cr.includes("q")) this.castling |= CR_BQ;
    this.ep = parts[3] && parts[3] !== "-" ? this.algToSq(parts[3]) : -1;
    this.halfmove = Number(parts[4] ?? 0) || 0;
    this.undoStack = [];
  }

  algToSq(alg: string): number {
    return (Number(alg[1]) - 1) * 16 + (alg.charCodeAt(0) - 97);
  }

  sqToAlg(sq: number): string {
    return String.fromCharCode(97 + (sq & 7)) + String(1 + (sq >> 4));
  }

  fen(): string {
    let out = "";
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 16 + f];
        if (p === 0) {
          empty++;
          continue;
        }
        if (empty) {
          out += empty;
          empty = 0;
        }
        const letter = " PNBRQK"[Math.abs(p)];
        out += p > 0 ? letter : letter.toLowerCase();
      }
      if (empty) out += empty;
      if (r > 0) out += "/";
    }
    let cr = "";
    if (this.castling & CR_WK) cr += "K";
    if (this.castling & CR_WQ) cr += "Q";
    if (this.castling & CR_BK) cr += "k";
    if (this.castling & CR_BQ) cr += "q";
    return `${out} ${this.whiteToMove ? "w" : "b"} ${cr || "-"} ${
      this.ep >= 0 ? this.sqToAlg(this.ep) : "-"
    } ${this.halfmove} 1`;
  }

  isAttacked(sq: number, byWhite: boolean): boolean {
    const b = this.board;
    // pawns
    if (byWhite) {
      if (sq - 15 >= 0 && !(sq - 15 & 0x88) && b[sq - 15] === WP) return true;
      if (sq - 17 >= 0 && !(sq - 17 & 0x88) && b[sq - 17] === WP) return true;
    } else {
      const bp = -WP;
      if (!(sq + 15 & 0x88) && b[sq + 15] === bp) return true;
      if (!(sq + 17 & 0x88) && b[sq + 17] === bp) return true;
    }
    // knights
    const n = byWhite ? WN : -WN;
    for (const o of KNIGHT_OFFSETS) {
      const t = sq + o;
      if (!(t & 0x88) && b[t] === n) return true;
    }
    // king
    const k = byWhite ? WK : -WK;
    for (const o of KING_OFFSETS) {
      const t = sq + o;
      if (!(t & 0x88) && b[t] === k) return true;
    }
    // sliders
    const r1 = byWhite ? WR : -WR;
    const b1 = byWhite ? WB : -WB;
    const q1 = byWhite ? WQ : -WQ;
    for (const o of ROOK_DIRS) {
      let t = sq + o;
      while (!(t & 0x88)) {
        const p = b[t];
        if (p !== 0) {
          if (p === r1 || p === q1) return true;
          break;
        }
        t += o;
      }
    }
    for (const o of BISHOP_DIRS) {
      let t = sq + o;
      while (!(t & 0x88)) {
        const p = b[t];
        if (p !== 0) {
          if (p === b1 || p === q1) return true;
          break;
        }
        t += o;
      }
    }
    return false;
  }

  inCheck(white: boolean): boolean {
    return this.isAttacked(white ? this.wk : this.bk, !white);
  }

  /** Generate pseudo-legal moves (legality filtered by make/undo in search). */
  generate(onlyCaptures = false, out: Move[] = []): Move[] {
    const b = this.board;
    const white = this.whiteToMove;
    out.length = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const p = b[sq];
      if (p === 0 || (p > 0) !== white) continue;
      const type = Math.abs(p);
      if (type === WP) {
        const up = white ? 16 : -16;
        const startRank = white ? 1 : 6;
        const promoRank = white ? 6 : 1;
        const one = sq + up;
        if (!(one & 0x88) && b[one] === 0) {
          if (sq >> 4 === promoRank) {
            for (const promo of [WQ, WR, WB, WN]) {
              out.push({ from: sq, to: one, piece: p, capt: 0, promo, flag: 0 });
            }
          } else if (!onlyCaptures) {
            out.push({ from: sq, to: one, piece: p, capt: 0, promo: 0, flag: 0 });
            const two = sq + up * 2;
            if (sq >> 4 === startRank && b[two] === 0) {
              out.push({ from: sq, to: two, piece: p, capt: 0, promo: 0, flag: 1 });
            }
          }
        }
        for (const dc of [up - 1, up + 1]) {
          const t = sq + dc;
          if (t & 0x88) continue;
          const target = b[t];
          if (target !== 0 && (target > 0) !== white) {
            if (sq >> 4 === promoRank) {
              for (const promo of [WQ, WR, WB, WN]) {
                out.push({ from: sq, to: t, piece: p, capt: target, promo, flag: 0 });
              }
            } else {
              out.push({ from: sq, to: t, piece: p, capt: target, promo: 0, flag: 0 });
            }
          } else if (target === 0 && t === this.ep) {
            out.push({ from: sq, to: t, piece: p, capt: -WP, promo: 0, flag: 2 });
          }
        }
      } else if (type === WN || type === WK) {
        const offsets = type === WN ? KNIGHT_OFFSETS : KING_OFFSETS;
        for (const o of offsets) {
          const t = sq + o;
          if (t & 0x88) continue;
          const target = b[t];
          if (target !== 0 && (target > 0) === white) continue;
          if (onlyCaptures && target === 0) continue;
          out.push({ from: sq, to: t, piece: p, capt: target, promo: 0, flag: 0 });
        }
      } else {
        const dirs =
          type === WB ? BISHOP_DIRS : type === WR ? ROOK_DIRS : [...BISHOP_DIRS, ...ROOK_DIRS];
        for (const o of dirs) {
          let t = sq + o;
          while (!(t & 0x88)) {
            const target = b[t];
            if (target === 0) {
              if (!onlyCaptures) {
                out.push({ from: sq, to: t, piece: p, capt: 0, promo: 0, flag: 0 });
              }
            } else {
              if ((target > 0) !== white) {
                out.push({ from: sq, to: t, piece: p, capt: target, promo: 0, flag: 0 });
              }
              break;
            }
            t += o;
          }
        }
      }
    }
    // castling
    if (!onlyCaptures) {
      if (white) {
        if (
          this.castling & CR_WK &&
          b[F1] === 0 &&
          b[G1] === 0 &&
          !this.isAttacked(E1, false) &&
          !this.isAttacked(F1, false) &&
          !this.isAttacked(G1, false)
        ) {
          out.push({ from: E1, to: G1, piece: WK, capt: 0, promo: 0, flag: 3 });
        }
        if (
          this.castling & CR_WQ &&
          b[D1] === 0 &&
          b[C1] === 0 &&
          b[B1] === 0 &&
          !this.isAttacked(E1, false) &&
          !this.isAttacked(D1, false) &&
          !this.isAttacked(C1, false)
        ) {
          out.push({ from: E1, to: C1, piece: WK, capt: 0, promo: 0, flag: 4 });
        }
      } else {
        if (
          this.castling & CR_BK &&
          b[F8] === 0 &&
          b[G8] === 0 &&
          !this.isAttacked(E8, true) &&
          !this.isAttacked(F8, true) &&
          !this.isAttacked(G8, true)
        ) {
          out.push({ from: E8, to: G8, piece: -WK, capt: 0, promo: 0, flag: 3 });
        }
        if (
          this.castling & CR_BQ &&
          b[D8] === 0 &&
          b[C8] === 0 &&
          b[B8] === 0 &&
          !this.isAttacked(E8, true) &&
          !this.isAttacked(D8, true) &&
          !this.isAttacked(C8, true)
        ) {
          out.push({ from: E8, to: C8, piece: -WK, capt: 0, promo: 0, flag: 4 });
        }
      }
    }
    return out;
  }

  make(m: Move): boolean {
    const b = this.board;
    this.undoStack.push({
      move: m,
      capt: m.capt,
      castling: this.castling,
      ep: this.ep,
      halfmove: this.halfmove,
    });

    // en passant capture removes the pawn behind
    if (m.flag === 2) {
      const victimSq = m.to + (this.whiteToMove ? -16 : 16);
      b[victimSq] = 0;
    }

    b[m.to] = m.promo ? (this.whiteToMove ? m.promo : -m.promo) : m.piece;
    b[m.from] = 0;

    if (m.flag === 3) {
      // kingside: rook h→f
      const rank = m.from & 0x70;
      b[rank + 5] = b[rank + 7];
      b[rank + 7] = 0;
    } else if (m.flag === 4) {
      // queenside: rook a→d
      const rank = m.from & 0x70;
      b[rank + 3] = b[rank + 0];
      b[rank + 0] = 0;
    }

    if (Math.abs(m.piece) === WK) {
      if (this.whiteToMove) {
        this.wk = m.to;
        this.castling &= ~(CR_WK | CR_WQ);
      } else {
        this.bk = m.to;
        this.castling &= ~(CR_BK | CR_BQ);
      }
    }
    // rook moves / rook captures affect rights
    if (m.from === H1 || m.to === H1) this.castling &= ~CR_WK;
    if (m.from === A1 || m.to === A1) this.castling &= ~CR_WQ;
    if (m.from === H8 || m.to === H8) this.castling &= ~CR_BK;
    if (m.from === A8 || m.to === A8) this.castling &= ~CR_BQ;

    this.ep = m.flag === 1 ? (m.from + m.to) / 2 : -1;
    this.halfmove =
      Math.abs(m.piece) === WP || m.capt !== 0 ? 0 : this.halfmove + 1;

    this.whiteToMove = !this.whiteToMove;

    // legality: own king must not be attacked
    const kingSq = this.whiteToMove ? this.bk : this.wk; // we just flipped
    if (this.isAttacked(kingSq, this.whiteToMove)) {
      this.unmake();
      return false;
    }
    return true;
  }

  unmake() {
    const u = this.undoStack.pop();
    if (!u) return;
    const m = u.move;
    const b = this.board;
    this.whiteToMove = !this.whiteToMove;

    b[m.from] = m.piece;
    b[m.to] = 0;
    if (m.flag === 2) {
      // the captured pawn sits behind the target square, owned by the opponent
      // of the mover (whiteToMove has already been un-flipped = mover again)
      const victimSq = m.to + (this.whiteToMove ? -16 : 16);
      b[victimSq] = this.whiteToMove ? -WP : WP;
    } else if (m.capt !== 0) {
      b[m.to] = m.capt;
    }
    if (m.flag === 3) {
      const rank = m.from & 0x70;
      b[rank + 7] = b[rank + 5];
      b[rank + 5] = 0;
    } else if (m.flag === 4) {
      const rank = m.from & 0x70;
      b[rank + 0] = b[rank + 3];
      b[rank + 3] = 0;
    }
    if (Math.abs(m.piece) === WK) {
      if (this.whiteToMove) this.wk = m.from;
      else this.bk = m.from;
    }
    this.castling = u.castling;
    this.ep = u.ep;
    this.halfmove = u.halfmove;
  }

  /** make + unmake are self-contained; doMove is an alias kept for readability */
  doMove(m: Move): boolean {
    return this.make(m);
  }
}

const F1 = 0x05;
const G1 = 0x06;
const D1 = 0x03;
const C1 = 0x02;
const B1 = 0x01;
const F8 = 0x75;
const G8 = 0x76;
const D8 = 0x73;
const C8 = 0x72;
const B8 = 0x71;

/* ------------------ Evaluation ------------------ */

// prettier-ignore
const PST_PAWN = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];
// prettier-ignore
const PST_KNIGHT = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
];
// prettier-ignore
const PST_BISHOP = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20,
];
// prettier-ignore
const PST_ROOK = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10, 10, 10, 10, 10,  5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   0,  0,  0,  5,  5,  0,  0,  0,
];
// prettier-ignore
const PST_QUEEN = [
  -20,-10,-10, -5, -5,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5,  5,  5,  5,  0,-10,
   -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
  -10,  5,  5,  5,  5,  5,  0,-10,
  -10,  0,  5,  0,  0,  0,  0,-10,
  -20,-10,-10, -5, -5,-10,-10,-20,
];
// prettier-ignore
const PST_KING_MID = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20,
];
// prettier-ignore
const PST_KING_END = [
  -50,-40,-30,-20,-20,-30,-40,-50,
  -30,-20,-10,  0,  0,-10,-20,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-30,  0,  0,  0,  0,-30,-30,
  -50,-30,-30,-30,-30,-30,-30,-50,
];

const PSTS = [null, PST_PAWN, PST_KNIGHT, PST_BISHOP, PST_ROOK, PST_QUEEN, null];

/** Static eval in centipawns, positive = good for White. */
function evaluate(pos: Position): number {
  const b = pos.board;
  let score = 0;
  let nonPawn = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const p = b[sq];
    if (p === 0) continue;
    const type = Math.abs(p);
    if (type !== WP && type !== WK) nonPawn += PIECE_VALUE[type];
  }
  const endgame = nonPawn < 1400;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const p = b[sq];
    if (p === 0) continue;
    const type = Math.abs(p);
    const rank = sq >> 4;
    const file = sq & 7;
    let val = PIECE_VALUE[type];
    if (type === WK) {
      const table = endgame ? PST_KING_END : PST_KING_MID;
      val += p > 0 ? table[(7 - rank) * 8 + file] : table[rank * 8 + file];
    } else {
      const table = PSTS[type]!;
      val += p > 0 ? table[(7 - rank) * 8 + file] : table[rank * 8 + file];
    }
    score += p > 0 ? val : -val;
  }
  return score;
}

/* ------------------ Search ------------------ */

const MATE = 900_000;
const INF = 1_000_000;

interface SearchState {
  nodes: number;
  deadline: number;
  aborted: boolean;
}

class Timeout extends Error {}

function timeCheck(st: SearchState) {
  if ((st.nodes & 1023) === 0 && Date.now() > st.deadline) {
    st.aborted = true;
    throw new Timeout();
  }
}

function quiesce(pos: Position, st: SearchState, alpha: number, beta: number, qdepth: number): number {
  st.nodes++;
  timeCheck(st);
  const sign = pos.whiteToMove ? 1 : -1;
  const stand = sign * evaluate(pos);
  // fail-soft: return the true best value found, not clamped bounds
  let best = stand;
  if (best >= beta) return best;
  if (best > alpha) alpha = best;
  if (qdepth <= 0) return best;

  const caps = pos.generate(true);
  // MVV-LVA ordering
  caps.sort(
    (a, b) =>
      PIECE_VALUE[Math.abs(b.capt)] * 10 -
      PIECE_VALUE[Math.abs(b.piece)] -
      (PIECE_VALUE[Math.abs(a.capt)] * 10 - PIECE_VALUE[Math.abs(a.piece)])
  );
  for (const m of caps) {
    if (!pos.doMove(m)) continue;
    const score = -quiesce(pos, st, -beta, -alpha, qdepth - 1);
    pos.unmake();
    if (score > best) best = score;
    if (best >= beta) return best;
    if (best > alpha) alpha = best;
  }
  return best;
}

function orderScore(m: Move, pv?: Move): number {
  let s = 0;
  if (pv && m.from === pv.from && m.to === pv.to && m.promo === pv.promo) s += 100_000;
  if (m.capt !== 0) s += 10_000 + PIECE_VALUE[Math.abs(m.capt)] * 10 - PIECE_VALUE[Math.abs(m.piece)];
  if (m.promo) s += 8_000 + PIECE_VALUE[m.promo];
  return s;
}

/** Is the side-to-move currently in check? */
function sideInCheck(pos: Position): boolean {
  return pos.whiteToMove ? pos.isAttacked(pos.wk, false) : pos.isAttacked(pos.bk, true);
}

function negamaxClean(
  pos: Position,
  st: SearchState,
  depth: number,
  ply: number,
  alpha: number,
  beta: number,
  pv?: Move
): number {
  st.nodes++;
  timeCheck(st);

  if (pos.halfmove >= 100) return 0;
  if (depth <= 0) return quiesce(pos, st, alpha, beta, 8);

  const moves = pos.generate();
  moves.sort((a, b) => orderScore(b, pv) - orderScore(a, pv));

  let legalCount = 0;
  let best = -INF;
  for (const m of moves) {
    if (!pos.doMove(m)) continue;
    legalCount++;
    const score = -negamaxClean(pos, st, depth - 1, ply + 1, -beta, -alpha);
    pos.unmake();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }

  if (legalCount === 0) {
    // side to move has no legal moves
    return sideInCheck(pos) ? -(MATE - ply) : 0;
  }
  return best;
}

/* ------------------ Perft (validation) ------------------ */

export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  let nodes = 0;
  const moves = pos.generate();
  for (const m of moves) {
    if (!pos.doMove(m)) continue;
    nodes += depth === 1 ? 1 : perft(pos, depth - 1);
    pos.unmake();
  }
  return nodes;
}

/* ------------------ Public API ------------------ */

export interface CoreEngineResult {
  from: string;
  to: string;
  promotion?: string;
  scoreCp: number; // from the mover's perspective
  depth: number;
  nodes: number;
  timeMs: number;
}

export interface LevelConfig {
  depth: number;
  timeMs: number;
  noise: number;
  blunder: number;
}

export const LEVELS: Record<string, LevelConfig> = {
  easy: { depth: 2, timeMs: 400, noise: 60, blunder: 0.35 },
  medium: { depth: 4, timeMs: 900, noise: 20, blunder: 0.08 },
  hard: { depth: 6, timeMs: 1800, noise: 4, blunder: 0 },
  master: { depth: 12, timeMs: 3200, noise: 0, blunder: 0 },
};

export function searchBestMove(fen: string, level: string): CoreEngineResult | null {
  const pos = new Position(fen);
  const cfg = LEVELS[level] ?? LEVELS.medium;
  const st: SearchState = { nodes: 0, deadline: Date.now() + cfg.timeMs, aborted: false };

  const rootMoves = pos.generate();
  const legalRoot: Move[] = [];
  for (const m of rootMoves) {
    if (pos.doMove(m)) {
      pos.unmake();
      legalRoot.push(m);
    }
  }
  if (legalRoot.length === 0) return null;

  let bestMove = legalRoot[0];
  let bestScore = -INF;
  let completedDepth = 0;
  let scored: { m: Move; score: number }[] = [];

  try {
    for (let depth = 1; depth <= cfg.depth; depth++) {
      // order: previous best first, then captures
      legalRoot.sort(
        (a, b) =>
          orderScore(b, completedDepth > 0 ? bestMove : undefined) -
          orderScore(a, completedDepth > 0 ? bestMove : undefined)
      );
      const current: { m: Move; score: number }[] = [];
      let alpha = -INF;
      let localBest: Move | null = null;
      let localScore = -INF;

      for (const m of legalRoot) {
        // a move only has an EXACT score when it raises alpha; with a narrowed
        // (−INF, −alpha) window, non-raising moves fail and their scores are
        // bounds, not truth — keep them out of the noise/blunder pool.
        const prevAlpha = alpha;
        pos.doMove(m);
        const score = -negamaxClean(pos, st, depth - 1, 1, -INF, -alpha);
        pos.unmake();
        if (score > prevAlpha) {
          current.push({ m, score });
          if (score > localScore) {
            localScore = score;
            localBest = m;
          }
        }
        if (score > alpha) alpha = score;
      }

      bestMove = localBest ?? bestMove;
      bestScore = localScore;
      completedDepth = depth;
      scored = current;

      if (Math.abs(bestScore) > MATE - 1000) break;
    }
  } catch (e) {
    if (!(e instanceof Timeout)) throw e;
    // keep best from the last fully completed depth; the position object is
    // left mid-search by the unwound stack — restore it for any later use
    pos.load(fen);
    if (scored.length === 0) {
      bestScore = (pos.whiteToMove ? 1 : -1) * evaluate(pos);
    }
  }

  // human-like imperfection for the gentler levels — but never squander a
  // forced mate that the search already found
  const mateFound = Math.abs(bestScore) > MATE - 1000;
  if (!mateFound && scored.length > 1) {
    if (cfg.blunder > 0 && Math.random() < cfg.blunder) {
      const sorted = [...scored].sort((a, b) => b.score - a.score);
      const pool = sorted.slice(0, Math.min(4, sorted.length));
      bestMove = pool[Math.floor(Math.random() * pool.length)].m;
    } else if (cfg.noise > 0) {
      const noisy = scored.map((r) => ({
        m: r.m,
        score: r.score + (Math.random() * 2 - 1) * cfg.noise,
      }));
      noisy.sort((a, b) => b.score - a.score);
      bestMove = noisy[0].m;
    }
  }

  const finalScore =
    scored.find((r) => r.m === bestMove)?.score ?? bestScore;

  return {
    from: pos.sqToAlg(bestMove.from),
    to: pos.sqToAlg(bestMove.to),
    promotion: bestMove.promo ? "pnbrqk"[bestMove.promo - 1] : undefined,
    scoreCp: Math.round(finalScore),
    depth: Math.max(1, completedDepth),
    nodes: st.nodes,
    timeMs: cfg.timeMs - Math.max(0, st.deadline - Date.now()),
  };
}
