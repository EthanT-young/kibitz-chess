import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js';
import { PIECE_VALUE, materialBalance, moveToUci, opposite } from '../chess/core';
import { hangingPieces, see, seeOfCapture } from '../chess/tactics';
import type { PositionAnalysis } from '../engine/uci';
import { lineOutcome } from './lines';
import type { Classification } from './types';
import { scoreToPawns, scoreToWin } from './winprob';

/**
 * Expected-points thresholds (0..1). A move that drops the mover's expected
 * score by more than these is graded down. These are the commonly published
 * cut-offs used by popular review tools.
 */
export const EPL_THRESHOLDS = {
  excellent: 0.02,
  good: 0.05,
  inaccuracy: 0.1,
  mistake: 0.2,
} as const;

export interface MoveContext {
  move: Move;
  fenBefore: string;
  fenAfter: string;
  /** Position before the opponent's previous move (to judge missed chances). */
  fenPrev?: string;
  prevMove?: Move;
  before: PositionAnalysis;
  after: PositionAnalysis;
  isBook: boolean;
}

export interface SacrificeInfo {
  square: Square;
  piece: PieceSymbol;
  /** Net material given up (negative). */
  net: number;
}

export interface Classified {
  classification: Classification;
  winBefore: number;
  winAfter: number;
  epl: number;
  /** Index of the played move among the engine's lines, -1 if not there. */
  playedLineIndex: number;
  isBest: boolean;
  sacrifice: SacrificeInfo | null;
  onlyMove: boolean;
  /** Mate-in-N that was on the board and not played. */
  missedMate: number | null;
  /** Material the best line would have won (vs. before the opponent's last move). */
  bestGain: number;
  /** Material outcome of the move played (same baseline). */
  playedGain: number;
}

function balanceFor(fen: string, color: 'w' | 'b'): number {
  return materialBalance(new Chess(fen)) * (color === 'w' ? 1 : -1);
}

/** Win chance for the mover after the move that was played. */
export function winAfterMove(ctx: MoveContext): { win: number; lineIndex: number } {
  if (ctx.after.terminal === 'checkmate') return { win: 1, lineIndex: 0 };
  if (ctx.after.terminal) return { win: 0.5, lineIndex: -1 };
  const uci = moveToUci(ctx.move);
  const j = ctx.before.lines.findIndex((l) => l.pv[0] === uci);
  if (j >= 0) return { win: scoreToWin(ctx.before.lines[j].score), lineIndex: j };
  const reply = ctx.after.lines[0];
  return { win: reply ? 1 - scoreToWin(reply.score) : 0.5, lineIndex: -1 };
}

/**
 * Is this move a real sacrifice? After it, the opponent can win at least two
 * points of material by capturing (static exchange), and:
 *  - it isn't a desperado (the moved piece was already lost where it stood),
 *  - it isn't a simple in-between move (after the capture we can't just win
 *    the material straight back).
 * Leaving an attacked piece where it is counts: declining to save a piece is
 * as much a sacrifice as offering one.
 */
export function detectSacrifice(fenBefore: string, move: Move, fenAfter: string): SacrificeInfo | null {
  const mover = move.color;
  const pre = new Chess(fenBefore);
  if (pre.inCheck()) return null;
  const post = new Chess(fenAfter);
  if (post.isGameOver()) return null;
  const matBefore = balanceFor(fenBefore, mover);
  const matAfter = balanceFor(fenAfter, mover);
  let worst: { square: Square; piece: PieceSymbol; gain: number } | null = null;
  for (const row of post.board()) {
    for (const p of row) {
      if (!p || p.color !== mover || p.type === 'k') continue;
      const gain = see(post, p.square);
      if (gain > 0 && (!worst || gain > worst.gain)) worst = { square: p.square, piece: p.type, gain };
    }
  }
  if (!worst) return null;
  const net = matAfter - worst.gain - matBefore;
  if (net > -2) return null;

  // Desperado: the piece that moved was going to be lost anyway.
  if (worst.square === move.to) {
    const was = hangingPieces(fenBefore, mover).find((h) => h.square === move.from);
    if (was && was.gain >= PIECE_VALUE[move.piece] - 1) return null;
  }

  // In-between move: if they take, can we immediately win at least as much back?
  const takes = post
    .moves({ verbose: true })
    .filter((m) => m.to === worst!.square && m.captured)
    .sort((a, b) => PIECE_VALUE[a.piece] - PIECE_VALUE[b.piece])[0];
  if (takes) {
    post.move(takes);
    const mateNow = post.moves({ verbose: true }).some((m) => {
      post.move(m);
      const mate = post.isCheckmate();
      post.undo();
      return mate;
    });
    if (!mateNow) {
      const regain = hangingPieces(post.fen(), opposite(mover))[0]?.gain ?? 0;
      if (regain >= -net) return null;
    }
  }
  return { square: worst.square, piece: worst.piece, net };
}

function isRecapture(move: Move, prev?: Move): boolean {
  return !!(prev && prev.captured && move.captured && prev.to === move.to);
}

/** Taking a piece for free, or completing an even trade: natural, never "great". */
function obviousCapture(fenBefore: string, move: Move): boolean {
  if (!move.captured || PIECE_VALUE[move.captured] < 3) return false;
  return seeOfCapture(new Chess(fenBefore), move) >= 0;
}

function baseGrade(epl: number): Classification {
  if (epl <= EPL_THRESHOLDS.excellent) return 'excellent';
  if (epl <= EPL_THRESHOLDS.good) return 'good';
  if (epl <= EPL_THRESHOLDS.inaccuracy) return 'inaccuracy';
  if (epl <= EPL_THRESHOLDS.mistake) return 'mistake';
  return 'blunder';
}

export function classifyMove(ctx: MoveContext): Classified {
  const { move, before, after } = ctx;
  const mover = move.color;
  const uci = moveToUci(move);
  const bestLine = before.lines[0];
  const winBefore = bestLine ? scoreToWin(bestLine.score) : 0.5;
  const { win: winAfter, lineIndex } = winAfterMove(ctx);
  const epl = Math.max(0, winBefore - winAfter);
  const isBest = after.terminal === 'checkmate' || (!!bestLine && bestLine.pv[0] === uci);

  // Material bookkeeping for "miss" detection, measured from before the
  // opponent's last move so that simple recaptures aren't counted as wins.
  const baseFen = ctx.fenPrev ?? ctx.fenBefore;
  const base = balanceFor(baseFen, mover);
  let bestGain = 0;
  if (bestLine) {
    const out = lineOutcome(ctx.fenBefore, bestLine.pv, mover, 12, scoreToPawns(bestLine.score));
    bestGain = balanceFor(ctx.fenBefore, mover) + out.delta - base;
  }
  let playedGain = balanceFor(ctx.fenAfter, mover) - base;
  if (!after.terminal && after.lines[0]) {
    playedGain += lineOutcome(ctx.fenAfter, after.lines[0].pv, mover, 12, -scoreToPawns(after.lines[0].score)).delta;
  }

  const bestMate = bestLine && bestLine.score.kind === 'mate' && bestLine.score.value > 0 ? bestLine.score.value : null;
  const keepsMate = winAfter === 1;
  const missedMate = bestMate !== null && !keepsMate ? bestMate : null;

  const result: Classified = {
    classification: 'good',
    winBefore,
    winAfter,
    epl,
    playedLineIndex: lineIndex,
    isBest,
    sacrifice: null,
    onlyMove: false,
    missedMate,
    bestGain,
    playedGain,
  };

  const legalMoves = new Chess(ctx.fenBefore).moves().length;
  if (legalMoves === 1) return { ...result, classification: 'forced' };
  if (ctx.isBook) return { ...result, classification: 'book' };

  // Brilliant: a genuine sacrifice that the engine approves of, played when
  // the position wasn't already trivially won, and that doesn't leave you worse.
  if (isBest || epl <= EPL_THRESHOLDS.excellent) {
    const sac = detectSacrifice(ctx.fenBefore, move, ctx.fenAfter);
    if (sac) {
      result.sacrifice = sac;
      const second = before.lines.find((l) => l.pv[0] !== uci);
      const alreadyWinning = second ? scoreToWin(second.score) >= 0.92 : false;
      if (!alreadyWinning && winAfter >= 0.45) return { ...result, classification: 'brilliant' };
    }
  }

  if (isBest) {
    const second = before.lines[1];
    if (second && after.terminal !== 'checkmate') {
      const gap = winBefore - scoreToWin(second.score);
      const trivial = isRecapture(move, ctx.prevMove) || obviousCapture(ctx.fenBefore, move);
      if (gap >= 0.15 && winBefore >= 0.35 && !trivial) {
        return { ...result, onlyMove: true, classification: 'great' };
      }
    }
    return { ...result, classification: 'best' };
  }

  const grade = baseGrade(epl);
  const couldPunish =
    (missedMate !== null) ||
    (bestGain >= (grade === 'inaccuracy' ? 3 : 2) && playedGain >= -1 && bestGain - playedGain >= 2);
  if ((grade === 'inaccuracy' || grade === 'mistake' || grade === 'blunder') && couldPunish && winAfter >= 0.3) {
    return { ...result, classification: 'miss' };
  }
  // Missing a short mate is always worth flagging, even when you stay winning.
  if (missedMate !== null && missedMate <= 2) return { ...result, classification: 'miss' };
  return { ...result, classification: grade };
}
