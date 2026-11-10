import { describe, expect, test } from 'vitest';
import { Chess } from 'chess.js';
import { averageAccuracy, estimateGameRating, gameAccuracy, moveAccuracy, moveScore } from '../../src/lib/analysis/accuracy';
import { classifyMove, detectSacrifice } from '../../src/lib/analysis/classify';
import { cpToWin, formatScore } from '../../src/lib/analysis/winprob';
import type { PositionAnalysis, PvLine } from '../../src/lib/engine/uci';
import { parseInfo } from '../../src/lib/engine/uci';

const line = (pv: string[], cp: number, multipv = 1): PvLine => ({ multipv, depth: 16, score: { kind: 'cp', value: cp }, pv });
const analysis = (fen: string, lines: PvLine[]): PositionAnalysis => ({ fen, depth: 16, lines });

describe('win probability & accuracy', () => {
  test('logistic curve is symmetric and centred', () => {
    expect(cpToWin(0)).toBeCloseTo(0.5);
    expect(cpToWin(300) + cpToWin(-300)).toBeCloseTo(1);
    expect(cpToWin(5000)).toBeCloseTo(cpToWin(1000)); // clamped
  });

  test('perfect move is 100, big drop is low', () => {
    expect(moveAccuracy(0.6, 0.6)).toBe(100);
    expect(moveAccuracy(0.6, 0.65)).toBe(100);
    expect(moveAccuracy(0.6, 0.2)).toBeLessThan(25);
  });

  test('game accuracy punishes a single blunder', () => {
    const wins = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.1, 0.1, 0.1];
    const accs = [100, 100, 100, 100, 100, 10, 100, 100];
    const movers = accs.map((_, i) => i % 2 === 0);
    const r = gameAccuracy(wins, accs, movers);
    expect(r.white).toBeGreaterThan(95);
    expect(r.black).toBeLessThan(70);
  });

  test('calibrated move score: perfect is 100, blunders near 0, mates handled', () => {
    expect(moveScore(0.6, 0.6)).toBe(100);
    expect(moveScore(0.5, 0.48)).toBeGreaterThan(85);
    expect(moveScore(0.5, 0.2)).toBeLessThan(5);
    expect(moveScore(1, 1)).toBe(100);
    expect(moveScore(1, 0)).toBeLessThan(1);
    expect(averageAccuracy([])).toBe(100);
  });

  test('game rating is anchored on the real rating', () => {
    // A user's real game (both players ~750): Chess.com showed 90.0 -> 1550 and 59.7 -> 450.
    expect(estimateGameRating(90.0, 750, 25)).toBe(1550);
    expect(estimateGameRating(59.7, 750, 25)).toBe(450);
    // Same accuracy, higher rating -> higher estimate; no rating -> no estimate.
    expect(estimateGameRating(85, 2000, 30)!).toBeGreaterThan(estimateGameRating(85, 1000, 30)!);
    expect(estimateGameRating(85, null, 30)).toBeNull();
    expect(estimateGameRating(85, 1500, 3)).toBeNull();
  });

  test('formats scores', () => {
    expect(formatScore({ kind: 'cp', value: 123 })).toBe('+1.23');
    expect(formatScore({ kind: 'mate', value: -3 })).toBe('-M3');
  });
});

describe('UCI parsing', () => {
  test('parses multipv info lines with mate scores', () => {
    const info = parseInfo('info depth 18 seldepth 25 multipv 2 score mate -3 nodes 1234 nps 5 time 9 pv e2e4 e7e5 g1f3');
    expect(info).toMatchObject({ depth: 18, multipv: 2, score: { kind: 'mate', value: -3 }, pv: ['e2e4', 'e7e5', 'g1f3'] });
  });
  test('flags bound scores', () => {
    expect(parseInfo('info depth 10 multipv 1 score cp 20 lowerbound pv e2e4')?.bound).toBe('lower');
  });
});

describe('classification', () => {
  const START = new Chess().fen();
  const play = (fen: string, san: string) => {
    const c = new Chess(fen);
    const m = c.move(san);
    return { move: m, fenAfter: c.fen() };
  };

  test('engine top move is "best"; big drops become mistakes/blunders', () => {
    const { move, fenAfter } = play(START, 'e4');
    const before = analysis(START, [line(['e2e4'], 30), line(['d2d4'], 25, 2)]);
    const after = analysis(fenAfter, [line(['e7e5'], -30)]);
    expect(classifyMove({ move, fenBefore: START, fenAfter, before, after, isBook: false }).classification).toBe('best');

    const bad = play(START, 'f3');
    const before2 = analysis(START, [line(['e2e4'], 30)]);
    const after2 = analysis(bad.fenAfter, [line(['e7e5'], 250)]);
    expect(classifyMove({ move: bad.move, fenBefore: START, fenAfter: bad.fenAfter, before: before2, after: after2, isBook: false }).classification).toBe('blunder');

    const after3 = analysis(bad.fenAfter, [line(['e7e5'], 120)]);
    expect(classifyMove({ move: bad.move, fenBefore: START, fenAfter: bad.fenAfter, before: before2, after: after3, isBook: false }).classification).toBe('mistake');

    const after4 = analysis(bad.fenAfter, [line(['e7e5'], 0)]);
    expect(classifyMove({ move: bad.move, fenBefore: START, fenAfter: bad.fenAfter, before: before2, after: after4, isBook: false }).classification).toBe('good');
  });

  test('book and forced moves', () => {
    const { move, fenAfter } = play(START, 'e4');
    const before = analysis(START, [line(['d2d4'], 30)]);
    const after = analysis(fenAfter, [line(['e7e5'], -20)]);
    expect(classifyMove({ move, fenBefore: START, fenAfter, before, after, isBook: true }).classification).toBe('book');

    // Only one legal move: king must step out of check.
    const fen = '4k3/8/8/8/8/8/5PP1/r5K1 w - - 0 1';
    expect(new Chess(fen).moves()).toEqual(['Kh2']);
    const forced = play(fen, 'Kh2');
    const res = classifyMove({
      move: forced.move, fenBefore: fen, fenAfter: forced.fenAfter,
      before: analysis(fen, [line([forced.move.lan], -900)]), after: analysis(forced.fenAfter, [line(['a1a2'], 900)]), isBook: false,
    });
    expect(res.classification).toBe('forced');
  });

  test('queen sacrifice that mates is detected as a sacrifice', () => {
    // Opera game: 16.Qb8+!! Nxb8 17.Rd8#
    const before = '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 1 16';
    const { move, fenAfter } = play(before, 'Qb8+');
    expect(detectSacrifice(before, move, fenAfter)).toMatchObject({ piece: 'q' });
  });
});
