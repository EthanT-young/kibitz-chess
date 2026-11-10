import { describe, expect, test } from 'vitest';
import { describeTimeControl, formatClock, parsePgn, PgnError } from '../../src/lib/chess/pgn';

describe('PGN parsing', () => {
  test('reads headers, clocks and result', () => {
    const g = parsePgn(`[White "a"]\n[Black "b"]\n[Result "1-0"]\n\n1. e4 {[%clk 0:05:00.2]} 1... e5 {[%clk 0:04:59]} 2. Qh5 Nc6 3. Bc4 Nf6?? 4. Qxf7# 1-0`);
    expect(g.headers.White).toBe('a');
    expect(g.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']);
    expect(g.moves[0].clock).toBeCloseTo(300.2);
    expect(g.moves[1].clock).toBe(299);
    expect(g.result).toBe('1-0');
  });

  test('skips variations, NAGs and comments; accepts bare move lists', () => {
    const g = parsePgn('1. d4 (1. e4 e5 (1... c5)) d5 $1 2. c4 {Queen\'s Gambit} dxc4 *');
    expect(g.moves.map((m) => m.san)).toEqual(['d4', 'd5', 'c4', 'dxc4']);
  });

  test('handles custom start positions', () => {
    const g = parsePgn('[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n\n1. e4 Kd7');
    expect(g.moves).toHaveLength(2);
  });

  test('takes the first game of several', () => {
    const g = parsePgn('[Event "1"]\n\n1. e4 e5 1-0\n\n[Event "2"]\n\n1. d4 d5 0-1');
    expect(g.headers.Event).toBe('1');
    expect(g.moves[0].san).toBe('e4');
  });

  test('reports illegal moves clearly', () => {
    expect(() => parsePgn('1. e4 e5 2. Ke3 Nf6 3. Qxf7')).toThrow(PgnError);
    expect(() => parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 5. Qh8')).toThrow(/move 5/);
  });

  test('time control and clock formatting', () => {
    expect(describeTimeControl('180+2')).toEqual({ label: '3 min + 2s', speed: 'blitz' });
    expect(describeTimeControl('600')?.speed).toBe('rapid');
    expect(describeTimeControl('1/86400')?.speed).toBe('daily');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(9.37)).toBe('0:09.4');
  });
});
