import { Chess, type Color } from 'chess.js';
import { parseUci } from '../lib/chess/core';
import { classifyMove, type Classified } from '../lib/analysis/classify';
import type { CoachComment } from '../lib/analysis/types';
import { explainMove } from '../lib/coach/explain';
import type { PositionAnalysis } from '../lib/engine/uci';

export interface Judgement {
  classified: Classified;
  coach: CoachComment;
  san: string;
}

/** Grades and explains a move the user tried on the board (exploration or retry). */
export function judgeMove(
  fenBefore: string,
  uci: string,
  before: PositionAnalysis | null,
  after: PositionAnalysis | null,
  perspective?: Color,
): Judgement | null {
  if (!before || !after || (!before.lines.length && !before.terminal)) return null;
  const chess = new Chess(fenBefore);
  let move;
  try {
    move = chess.move(parseUci(uci));
  } catch {
    return null;
  }
  const fenAfter = chess.fen();
  const classified = classifyMove({ move, fenBefore, fenAfter, before, after, isBook: false });
  const coach = explainMove({
    move,
    fenBefore,
    fenAfter,
    classified,
    before,
    after,
    phase: 'middlegame',
    moveNumber: Number(fenBefore.split(' ')[5]) || 20,
    perspective,
  });
  return { classified, coach, san: move.san };
}
