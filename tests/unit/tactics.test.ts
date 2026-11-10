import { describe, expect, test } from 'vitest';
import { Chess } from 'chess.js';
import { forkFrom, hangingPieces, mateThreat, pinsFrom, see } from '../../src/lib/chess/tactics';
import { describeMaterial } from '../../src/lib/coach/explain';
import { lineOutcome } from '../../src/lib/analysis/lines';

describe('static exchange evaluation', () => {
  test('free piece is worth its full value', () => {
    // Black knight on e5 attacked by Nf3, undefended.
    const chess = new Chess('rnbqkb1r/pppppppp/8/4n3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1');
    expect(see(chess, 'e5')).toBe(3);
  });

  test('defended pawn attacked by a knight is not worth taking', () => {
    const chess = new Chess('rnbqkbnr/pppp1ppp/8/4p3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1');
    // e5 pawn defended by nothing? (d6/f6 empty) -> it's free. Defend it with d6:
    chess.load('rnbqkbnr/ppp2ppp/3p4/4p3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1');
    expect(see(chess, 'e5')).toBe(0);
  });

  test('respects pins: a pinned attacker cannot capture', () => {
    // White knight on d4 pinned to the king by the rook on d8; black bishop on e6 is "attacked" by it? No: c6 pawn target.
    const chess = new Chess('3r2k1/8/2p5/8/3N4/8/8/3K4 w - - 0 1');
    expect(see(chess, 'c6')).toBe(0);
  });
});

describe('hanging pieces', () => {
  test('finds an undefended queen attacked by a pawn', () => {
    const fen = 'rnb1kbnr/pppp1ppp/8/4p3/3q4/2P5/PP1PPPPP/RNBQKBNR b KQkq - 0 3';
    const hanging = hangingPieces(fen, 'b');
    expect(hanging[0]).toMatchObject({ square: 'd4', type: 'q' });
  });
});

describe('forks and pins', () => {
  test('knight fork of king and rook', () => {
    // White knight on c7 checks the king on e8 and attacks the rook on a8.
    const chess = new Chess('r3k3/2N5/8/8/8/8/8/4K3 b - - 0 1');
    const fork = forkFrom(chess, 'c7');
    expect(fork?.targets.map((t) => t.type).sort()).toEqual(['k', 'r']);
  });

  test('a fork that can simply be captured is not a fork', () => {
    const chess = new Chess('r3k3/2N5/1q6/8/8/8/8/4K3 b - - 0 1');
    expect(forkFrom(chess, 'c7')).toBeNull();
  });

  test('bishop pins knight to king', () => {
    const chess = new Chess('4k3/8/2n5/8/B7/8/8/4K3 b - - 0 1');
    const pins = pinsFrom(chess, 'a4');
    expect(pins[0]).toMatchObject({ kind: 'pin', pinnedType: 'n', behindType: 'k' });
  });

  test('rook skewers king and queen', () => {
    const chess = new Chess('8/8/8/8/R2k2q1/8/8/4K3 b - - 0 1');
    const pins = pinsFrom(chess, 'a4');
    expect(pins[0]).toMatchObject({ kind: 'skewer', pinnedType: 'k', behindType: 'q' });
  });

  test('mate threat: scholar-style Qxf7#', () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
    expect(mateThreat(fen, 'w')).toBe('Qxf7#');
  });
});

describe('line outcomes', () => {
  test('measures material after a capture sequence settles', () => {
    // White queen takes a defended pawn on d5 and gets taken back.
    const fen = 'rnbqkbnr/ppp1pppp/8/3p4/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const chess = new Chess(fen);
    chess.load('rnbqkbnr/ppp2ppp/4p3/3p4/8/3Q4/PPPPPPPP/RNB1KBNR w KQkq - 0 1');
    const out = lineOutcome(chess.fen(), ['d3h7', 'h8h7', 'b1c3'], 'w');
    expect(out.delta).toBe(-8);
    expect(out.captures.map((c) => c.captured)).toEqual(['p', 'q']);
  });

  test('describes material in words', () => {
    expect(describeMaterial(['q'], ['r'], -4)).toBe('a queen for a rook');
    expect(describeMaterial(['r'], ['b'], -2)).toBe('the exchange');
    expect(describeMaterial(['n'], [], -3)).toBe('a knight');
    expect(describeMaterial(['p'], [], -1)).toBe('a pawn');
    expect(describeMaterial(['p', 'p'], [], -2)).toBe('two pawns');
  });
});
