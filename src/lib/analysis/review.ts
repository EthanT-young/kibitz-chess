import { Chess, type Color, type Move } from 'chess.js';
import { parseUci, uciLineToSan, sideToMove } from '../chess/core';
import type { Opening, OpeningBook } from '../chess/openings';
import type { ParsedGame } from '../chess/pgn';
import { explainMove } from '../coach/explain';
import { resultText, summarizeGame } from '../coach/summary';
import { cyrb53 } from '../chess/hash';
import type { PositionAnalysis, Score } from '../engine/uci';
import { averageAccuracy, estimateGameRating, moveScore } from './accuracy';
import { classifyMove } from './classify';
import { phaseOfPositions } from './phases';
import {
  CLASSIFICATIONS,
  type Classification,
  type EngineLineView,
  type GameReport,
  type MoveReview,
  type Phase,
  type PlayerSummary,
} from './types';
import { scoreToCp, scoreToWin, toWhite } from './winprob';

export interface ReportMeta {
  engineName: string;
  depth: number;
  multiPv: number;
  perspective?: Color;
}

/** Score of a position from White's point of view (terminal positions handled). */
export function positionEval(a: PositionAnalysis): { score: Score; whiteWin: number } {
  const stm = sideToMove(a.fen);
  if (a.terminal === 'checkmate') {
    // The side to move has been mated.
    return { score: { kind: 'mate', value: 0 }, whiteWin: stm === 'w' ? 0 : 1 };
  }
  if (a.terminal) return { score: { kind: 'cp', value: 0 }, whiteWin: 0.5 };
  const line = a.lines[0];
  if (!line) return { score: { kind: 'cp', value: 0 }, whiteWin: 0.5 };
  const score = toWhite(line.score, stm);
  return { score, whiteWin: scoreToWin(score) };
}

function lineView(fen: string, a: PositionAnalysis, idx: number): EngineLineView | undefined {
  const l = a.lines[idx];
  if (!l) return undefined;
  const line = uciLineToSan(fen, l.pv, 12);
  return { uci: l.pv[0], san: line[0] ?? l.pv[0], score: toWhite(l.score, sideToMove(fen)), line };
}

const clampCp = (cp: number) => Math.max(-1000, Math.min(1000, cp));

function emptyCounts(): Record<Classification, number> {
  return Object.fromEntries([...CLASSIFICATIONS, 'forced'].map((c) => [c, 0])) as Record<Classification, number>;
}

function phaseGrade(acc: number | null, hadBrilliant: boolean): Classification | null {
  if (acc === null) return null;
  if (hadBrilliant && acc >= 75) return 'brilliant';
  if (acc >= 95) return 'best';
  if (acc >= 85) return 'excellent';
  if (acc >= 75) return 'good';
  if (acc >= 60) return 'inaccuracy';
  if (acc >= 45) return 'mistake';
  return 'blunder';
}

export function reportId(game: ParsedGame, depth: number): string {
  return cyrb53(`${game.startFen}|${game.moves.map((m) => m.uci).join(' ')}|${depth}`).toString(36);
}

/**
 * Builds the full review from per-position engine analysis.
 * `positions[i]` must be the analysis of the position before move i
 * (positions.length === moves.length + 1).
 */
export function buildReport(
  game: ParsedGame,
  positions: PositionAnalysis[],
  book: OpeningBook,
  meta: ReportMeta,
): GameReport {
  const fens = [game.startFen, ...game.moves.map((m) => m.fenAfter)];
  if (positions.length !== fens.length) throw new Error('Analysis does not match the game.');
  const evals = positions.map(positionEval);
  const phases = phaseOfPositions(fens);
  const chessMoves: Move[] = game.moves.map((m) => new Chess(m.fenBefore).move(parseUci(m.uci)));

  let currentOpening: Opening | undefined;
  const moves: MoveReview[] = [];
  game.moves.forEach((m, i) => {
    const move = chessMoves[i];
    const before = positions[i];
    const after = positions[i + 1];
    const startMoveNo = Number(game.startFen.split(' ')[5]) || 1;
    const moveNumber = Number(m.fenBefore.split(' ')[5]) || startMoveNo;
    const named = book.nameOf(m.fenAfter);
    const openingSoFar = currentOpening;
    if (named) currentOpening = named;
    const isBook = i < 40 && book.isBook(m.fenAfter);
    const classified = classifyMove({
      move,
      fenBefore: m.fenBefore,
      fenAfter: m.fenAfter,
      fenPrev: i > 0 ? game.moves[i - 1].fenBefore : undefined,
      prevMove: i > 0 ? chessMoves[i - 1] : undefined,
      before,
      after,
      isBook,
    });
    const phase: Phase = phases[i];
    const coach = explainMove({
      move,
      fenBefore: m.fenBefore,
      fenAfter: m.fenAfter,
      prevMove: i > 0 ? chessMoves[i - 1] : undefined,
      prevClassification: i > 0 ? moves[i - 1].classification : undefined,
      classified,
      before,
      after,
      opening: named,
      currentOpening: openingSoFar,
      phase,
      moveNumber,
      perspective: meta.perspective,
      next: i + 1 < game.moves.length ? { move: chessMoves[i + 1], after: positions[i + 2] } : undefined,
    });

    // Centipawn loss from the mover's point of view, capped like Lichess.
    const sign = m.color === 'w' ? 1 : -1;
    const cpBefore = clampCp(scoreToCp(evals[i].score) * sign);
    let cpAfter: number;
    if (classified.playedLineIndex >= 0 && before.lines[classified.playedLineIndex]) {
      cpAfter = clampCp(scoreToCp(before.lines[classified.playedLineIndex].score));
    } else if (after.terminal === 'checkmate') {
      cpAfter = 1000;
    } else {
      cpAfter = clampCp(scoreToCp(evals[i + 1].score) * sign);
    }
    // Book and forced moves count as perfect: there was nothing to find.
    const free = classified.classification === 'book' || classified.classification === 'forced';
    const cpLoss = free ? 0 : Math.max(0, cpBefore - cpAfter);

    const alternatives = before.lines.map((_, j) => lineView(m.fenBefore, before, j)).filter(Boolean) as EngineLineView[];
    const replyUci = after.lines[0]?.pv ?? [];
    moves.push({
      ply: i + 1,
      moveNumber,
      color: m.color,
      san: m.san,
      uci: m.uci,
      fenBefore: m.fenBefore,
      fenAfter: m.fenAfter,
      clock: m.clock,
      classification: classified.classification,
      winBefore: classified.winBefore,
      winAfter: classified.winAfter,
      epl: classified.epl,
      accuracy: free ? 100 : moveScore(classified.winBefore, classified.winAfter),
      cpLoss,
      evalAfter: evals[i + 1].score,
      best: alternatives[0],
      alternatives,
      replyLine: uciLineToSan(m.fenAfter, replyUci, 12),
      replyLineUci: replyUci.slice(0, 12),
      phase,
      opening: currentOpening,
      coach,
    });
  });

  const whiteWin = evals.map((e) => e.whiteWin);
  const daily = (game.headers.TimeControl ?? '').includes('/');
  const isFree = (m: MoveReview) => m.classification === 'book' || m.classification === 'forced';

  const summarize = (color: Color): PlayerSummary => {
    const mine = moves.filter((m) => m.color === color);
    const counts = emptyCounts();
    mine.forEach((m) => counts[m.classification]++);
    const scored = mine.filter((m) => !isFree(m));
    const acpl = scored.length ? scored.reduce((a, m) => a + m.cpLoss, 0) / scored.length : NaN;
    const accuracy = averageAccuracy(scored.map((m) => m.accuracy));
    const phaseAcc = (ph: Phase) => {
      const xs = mine.filter((m) => m.phase === ph && !isFree(m));
      if (!xs.length) return { accuracy: null, grade: null };
      const a = xs.reduce((s, m) => s + m.accuracy, 0) / xs.length;
      return { accuracy: a, grade: phaseGrade(a, xs.some((m) => m.classification === 'brilliant')) };
    };
    const h = game.headers;
    const nameRaw = color === 'w' ? h.White : h.Black;
    const ratingRaw = color === 'w' ? h.WhiteElo : h.BlackElo;
    return {
      name: nameRaw && nameRaw !== '?' ? nameRaw : color === 'w' ? 'White' : 'Black',
      rating: ratingRaw && ratingRaw !== '?' ? ratingRaw : undefined,
      accuracy,
      counts,
      acpl,
      estimatedRating: estimateGameRating(accuracy, Number.parseInt(ratingRaw ?? '', 10) || null, scored.length, daily),
      phases: { opening: phaseAcc('opening'), middlegame: phaseAcc('middlegame'), endgame: phaseAcc('endgame') },
    };
  };

  const finalPos = new Chess(fens[fens.length - 1]);
  let result = game.result;
  if (result === '*' && finalPos.isCheckmate()) result = finalPos.turn() === 'w' ? '0-1' : '1-0';
  const partial: Omit<GameReport, 'intro'> = {
    id: reportId(game, meta.depth),
    createdAt: Date.now(),
    headers: game.headers,
    startFen: game.startFen,
    result,
    resultText: resultText(game.headers, result, finalPos.isCheckmate(), meta.perspective),
    white: summarize('w'),
    black: summarize('b'),
    moves,
    whiteWin,
    evals: evals.map((e) => e.score),
    opening: currentOpening,
    keyMoments: moves
      .filter((m) => ['brilliant', 'great', 'miss', 'mistake', 'blunder'].includes(m.classification))
      .map((m) => m.ply),
    perspective: meta.perspective,
    engine: { name: meta.engineName, depth: meta.depth, multiPv: meta.multiPv },
    positions,
  };
  return { ...partial, intro: summarizeGame(partial) };
}
