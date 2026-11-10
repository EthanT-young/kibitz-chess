/**
 * Small, dependable tactical detectors used by the coach to put engine output
 * into words: hanging pieces, static exchange evaluation, forks, pins, mate
 * threats. They are deliberately simple; the engine decides what is good, these
 * only describe *why*.
 */
import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import {
  PIECE_VALUE,
  fileOf,
  rankOf,
  toSquare,
  onBoard,
  opposite,
  nullMoveFen,
} from './core';

type Cell = { square: Square; type: PieceSymbol; color: Color } | null;
type Grid = Cell[][]; // chess.js board(): [0] = rank 8

function cellAt(grid: Grid, file: number, rank: number): Cell {
  return grid[7 - rank][file];
}

const KNIGHT_STEPS = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING_STEPS = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

function dirsFor(type: PieceSymbol): number[][] {
  if (type === 'r') return ROOK_DIRS;
  if (type === 'b') return BISHOP_DIRS;
  if (type === 'q') return [...ROOK_DIRS, ...BISHOP_DIRS];
  return [];
}

/** Squares attacked by the piece standing on `from` (pseudo-legal, ignores pins). */
export function attacksFrom(grid: Grid, from: Square): Square[] {
  const f = fileOf(from);
  const r = rankOf(from);
  const piece = cellAt(grid, f, r);
  if (!piece) return [];
  const out: Square[] = [];
  const add = (df: number, dr: number) => {
    if (onBoard(f + df, r + dr)) out.push(toSquare(f + df, r + dr));
  };
  switch (piece.type) {
    case 'p': {
      const dir = piece.color === 'w' ? 1 : -1;
      add(-1, dir);
      add(1, dir);
      break;
    }
    case 'n':
      KNIGHT_STEPS.forEach(([df, dr]) => add(df, dr));
      break;
    case 'k':
      KING_STEPS.forEach(([df, dr]) => add(df, dr));
      break;
    default:
      for (const [df, dr] of dirsFor(piece.type)) {
        let ff = f + df;
        let rr = r + dr;
        while (onBoard(ff, rr)) {
          out.push(toSquare(ff, rr));
          if (cellAt(grid, ff, rr)) break;
          ff += df;
          rr += dr;
        }
      }
  }
  return out;
}

const SEE_VALUE: Record<PieceSymbol, number> = { ...PIECE_VALUE, k: 100 };

function legalCaptureFrom(chess: Chess, from: Square, to: Square): Move | null {
  const moves = chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  if (!moves.length) return null;
  // Prefer queen promotion when a pawn captures onto the last rank.
  return moves.find((m) => !m.promotion || m.promotion === 'q') ?? moves[0];
}

/**
 * Static exchange evaluation: the material the side to move can win by
 * starting a capture sequence on `target` (each side always recaptures with its
 * cheapest piece and may stop at any time). Returns 0 when capturing is not
 * worth it. Uses legal moves, so pins are respected.
 */
export function see(chess: Chess, target: Square, depth = 0): number {
  if (depth > 14) return 0;
  const victim = chess.get(target);
  if (!victim) return 0;
  const side = chess.turn();
  if (victim.color === side) return 0;
  const attackers = chess
    .attackers(target, side)
    .map((sq) => ({ sq, p: chess.get(sq)! }))
    .sort((a, b) => SEE_VALUE[a.p.type] - SEE_VALUE[b.p.type]);
  for (const { sq } of attackers) {
    const mv = legalCaptureFrom(chess, sq, target);
    if (!mv) continue;
    const gained = PIECE_VALUE[victim.type] + (mv.promotion ? PIECE_VALUE[mv.promotion] - 1 : 0);
    chess.move(mv);
    const reply = see(chess, target, depth + 1);
    chess.undo();
    return Math.max(0, gained - reply);
  }
  return 0;
}

/** SEE value of one specific capture (may be negative: a bad capture). */
export function seeOfCapture(chess: Chess, move: Move): number {
  if (!move.captured) return 0;
  const gained = PIECE_VALUE[move.captured] + (move.promotion ? PIECE_VALUE[move.promotion] - 1 : 0);
  chess.move(move);
  const reply = see(chess, move.to);
  chess.undo();
  return gained - reply;
}

export interface HangingPiece {
  square: Square;
  type: PieceSymbol;
  color: Color;
  /** material the opponent wins by taking it */
  gain: number;
}

/**
 * Pieces of `color` that the opponent could win material from right now (as if
 * it were the opponent's move). Kings are never "hanging".
 */
const hangingCache = new Map<string, HangingPiece[]>();

export function hangingPieces(fen: string, color: Color): HangingPiece[] {
  const key = `${fen}|${color}`;
  const hit = hangingCache.get(key);
  if (hit) return hit;
  const result = computeHanging(fen, color);
  if (hangingCache.size > 4000) hangingCache.clear();
  hangingCache.set(key, result);
  return result;
}

function computeHanging(fen: string, color: Color): HangingPiece[] {
  let probeFen: string | null = fen;
  if (fen.split(' ')[1] === color) probeFen = nullMoveFen(fen);
  if (!probeFen) return [];
  const chess = new Chess(probeFen);
  const out: HangingPiece[] = [];
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p || p.color !== color || p.type === 'k') continue;
      const gain = see(chess, p.square);
      if (gain > 0) out.push({ square: p.square, type: p.type, color, gain });
    }
  }
  return out.sort((a, b) => b.gain - a.gain);
}

export interface ForkInfo {
  attacker: Square;
  attackerType: PieceSymbol;
  targets: { square: Square; type: PieceSymbol }[];
}

/**
 * Does the piece on `square` attack two or more worthwhile targets? A target is
 * worthwhile when it is the king, worth more than the attacker, or undefended.
 */
export function forkFrom(chess: Chess, square: Square): ForkInfo | null {
  const piece = chess.get(square);
  if (!piece) return null;
  const grid = chess.board() as Grid;
  const enemy = opposite(piece.color);
  const targets: { square: Square; type: PieceSymbol }[] = [];
  for (const sq of attacksFrom(grid, square)) {
    const t = chess.get(sq);
    if (!t || t.color !== enemy || t.type === 'p') continue;
    const defended = chess.attackers(sq, enemy).length > 0;
    const worth =
      t.type === 'k' || PIECE_VALUE[t.type] > PIECE_VALUE[piece.type] || (!defended && PIECE_VALUE[t.type] >= 3);
    if (worth) targets.push({ square: sq, type: t.type });
  }
  if (targets.length < 2) return null;
  // A fork only works if the opponent cannot simply take the forking piece
  // without losing material. (Only checkable when it is the opponent's move.)
  if (chess.turn() === enemy) {
    for (const from of chess.attackers(square, enemy)) {
      for (const m of chess.moves({ square: from, verbose: true })) {
        if (m.to === square && m.captured && seeOfCapture(chess, m) >= 0) return null;
      }
    }
  }
  targets.sort((a, b) => SEE_VALUE[b.type] - SEE_VALUE[a.type]);
  return { attacker: square, attackerType: piece.type, targets };
}

export interface PinInfo {
  pinner: Square;
  pinnerType: PieceSymbol;
  pinned: Square;
  pinnedType: PieceSymbol;
  behind: Square;
  behindType: PieceSymbol;
  /** skewer: the more valuable piece is in front */
  kind: 'pin' | 'skewer';
}

/** Pins and skewers created by the slider on `square`. */
export function pinsFrom(chess: Chess, square: Square): PinInfo[] {
  const piece = chess.get(square);
  if (!piece || !['b', 'r', 'q'].includes(piece.type)) return [];
  const enemy = opposite(piece.color);
  const out: PinInfo[] = [];
  const f0 = fileOf(square);
  const r0 = rankOf(square);
  const pinnerVal = PIECE_VALUE[piece.type];
  for (const [df, dr] of dirsFor(piece.type)) {
    let f = f0 + df;
    let r = r0 + dr;
    let front: { sq: Square; type: PieceSymbol } | null = null;
    while (onBoard(f, r)) {
      const sq = toSquare(f, r);
      const p = chess.get(sq);
      if (p) {
        if (p.color !== enemy) break;
        if (!front) {
          front = { sq, type: p.type };
          f += df;
          r += dr;
          continue;
        }
        const frontVal = SEE_VALUE[front.type];
        const backVal = SEE_VALUE[p.type];
        const base = { pinner: square, pinnerType: piece.type, pinned: front.sq, pinnedType: front.type, behind: sq, behindType: p.type };
        if (front.type !== 'p' && front.type !== 'k' && backVal > frontVal) {
          // Pin: the front piece cannot move without exposing something bigger.
          out.push({ ...base, kind: 'pin' });
        } else if (frontVal > backVal && backVal >= 3 && (front.type === 'k' || frontVal > pinnerVal)) {
          // Skewer: the front piece must move and the one behind falls.
          out.push({ ...base, kind: 'skewer' });
        }
        break;
      }
      f += df;
      r += dr;
    }
  }
  return out;
}

/** If `color` could move twice in a row, could it deliver mate? Returns the mating SAN. */
export function mateThreat(fen: string, color: Color): string | null {
  let probe: string | null = fen;
  if (fen.split(' ')[1] !== color) probe = nullMoveFen(fen);
  if (!probe) return null;
  // chess.js already marks mating moves with '#' when it writes SAN.
  return new Chess(probe).moves().find((san) => san.endsWith('#')) ?? null;
}

export function isPassedPawn(chess: Chess, square: Square): boolean {
  const p = chess.get(square);
  if (!p || p.type !== 'p') return false;
  const f = fileOf(square);
  const r = rankOf(square);
  const dir = p.color === 'w' ? 1 : -1;
  for (let ff = f - 1; ff <= f + 1; ff++) {
    if (ff < 0 || ff > 7) continue;
    for (let rr = r + dir; rr >= 0 && rr < 8; rr += dir) {
      const q = chess.get(toSquare(ff, rr));
      if (q && q.type === 'p' && q.color !== p.color) return false;
    }
  }
  return true;
}

/** Enemy pieces newly attacked by `color` that are worth something to attack. */
export function attackedTargets(chess: Chess, color: Color): { square: Square; type: PieceSymbol; by: Square[] }[] {
  const enemy = opposite(color);
  const out: { square: Square; type: PieceSymbol; by: Square[] }[] = [];
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p || p.color !== enemy) continue;
      const by = chess.attackers(p.square, color);
      if (by.length) out.push({ square: p.square, type: p.type, by });
    }
  }
  return out;
}

export function kingSquare(chess: Chess, color: Color): Square | null {
  return chess.findPiece({ type: 'k', color })[0] ?? null;
}
