import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import { materialBalance, playUci } from '../chess/core';

export interface LineCapture {
  ply: number;
  by: Color;
  piece: PieceSymbol;
  captured: PieceSymbol;
  square: Square;
  san: string;
}

export interface QuietPoint {
  /** plies played from the start of the line */
  ply: number;
  /** material change for `pov` since the start of the line */
  delta: number;
}

export interface LineOutcome {
  /** Material change for `pov` at the chosen settle point. */
  delta: number;
  /** Number of plies until that point. */
  settledPly: number;
  /** Captures up to the settle point. */
  captures: LineCapture[];
  promotions: { ply: number; by: Color; san: string }[];
  moves: Move[];
  endsInMate: boolean;
  /** Every point in the line where the forcing play pauses. */
  points: QuietPoint[];
}

/**
 * Plays an engine line and measures the material swing once the forcing part
 * (captures, checks, promotions) is over. This is how the coach turns
 * "eval -3.1" into "you lose a knight".
 *
 * Lines often contain a quiet move or two before the material actually falls
 * (Qxg2, d3, d5, Bxd5, Qxh1+). If `expectedBalance` (the engine's evaluation
 * in pawns, from `pov`'s side) is given, the settle point is the pause in the
 * line whose material balance best matches that evaluation.
 */
export function lineOutcome(
  fen: string,
  uciLine: string[],
  pov: Color,
  maxPlies = 12,
  expectedBalance?: number | null,
): LineOutcome {
  const chess = new Chess(fen);
  const sign = pov === 'w' ? 1 : -1;
  const start = materialBalance(chess) * sign;
  const moves: Move[] = [];
  for (const uci of uciLine.slice(0, maxPlies + 1)) {
    const m = playUci(chess, uci);
    if (!m) break;
    moves.push(m);
  }
  const replay = new Chess(fen);
  const allCaptures: LineCapture[] = [];
  const allPromotions: { ply: number; by: Color; san: string }[] = [];
  const points: QuietPoint[] = [];
  let endsInMate = false;
  let lastDelta = 0;
  const limit = Math.min(moves.length, maxPlies);
  for (let k = 0; k < limit; k++) {
    const m = moves[k];
    replay.move(m);
    if (m.captured) {
      allCaptures.push({ ply: k + 1, by: m.color, piece: m.piece, captured: m.captured, square: m.to, san: m.san });
    }
    if (m.promotion) allPromotions.push({ ply: k + 1, by: m.color, san: m.san });
    lastDelta = materialBalance(replay) * sign - start;
    if (replay.isCheckmate()) {
      endsInMate = true;
      points.push({ ply: k + 1, delta: lastDelta });
      break;
    }
    const next = moves[k + 1];
    const forcingNext = next && (next.captured || next.promotion || next.san.includes('+'));
    if (k + 1 >= 2 && !replay.inCheck() && !forcingNext) points.push({ ply: k + 1, delta: lastDelta });
  }
  if (!points.length) points.push({ ply: limit, delta: lastDelta });

  let chosen = points[0];
  if (expectedBalance !== undefined && expectedBalance !== null && Number.isFinite(expectedBalance)) {
    const target = Math.max(-15, Math.min(15, expectedBalance));
    const off = (p: QuietPoint) => Math.abs(start + p.delta - target);
    for (const p of points) {
      // Only read further into the line when it clearly explains the evaluation better.
      if (off(p) < off(chosen) - 1.5) chosen = p;
    }
  }
  return {
    delta: chosen.delta,
    settledPly: chosen.ply,
    captures: allCaptures.filter((c) => c.ply <= chosen.ply),
    promotions: allPromotions.filter((p) => p.ply <= chosen.ply),
    moves: moves.slice(0, chosen.ply),
    endsInMate: endsInMate && chosen.ply === points[points.length - 1].ply,
    points,
  };
}

/** The biggest piece each side gave up in a line (for "you lose your queen for a rook"). */
export function biggestLosses(outcome: LineOutcome, pov: Color): { lost: PieceSymbol[]; won: PieceSymbol[] } {
  const lost: PieceSymbol[] = [];
  const won: PieceSymbol[] = [];
  for (const c of outcome.captures) {
    if (c.by === pov) won.push(c.captured);
    else lost.push(c.captured);
  }
  return { lost, won };
}
