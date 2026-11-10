// Regression tests for the issues found in the pre-release security review.
import { describe, expect, test } from 'vitest';
import { MAX_PGN_LENGTH, parsePgn, PgnError } from '../../src/lib/chess/pgn';
import { sanitizeSettings } from '../../src/app/settings';
import { UciEngine, type UciTransport } from '../../src/lib/engine/engine';
import { annotatedPgn } from '../../src/app/annotatedPgn';
import type { GameReport } from '../../src/lib/analysis/types';

const withFen = (fen: string) => `[SetUp "1"]\n[FEN "${fen}"]\n\n1. Kh1`;

describe('PGN input that would crash the engine is rejected', () => {
  test.each([
    ['side not to move in check', '4k3/8/8/8/8/8/8/4R1K1 w - - 0 1'],
    ['more than 32 pieces', 'rnbqkbnr/pppppppp/pppppppp/8/8/PPPPPPPP/PPPPPPPP/RNBQKBNR w - - 0 1'],
    ['adjacent kings', '8/8/8/8/8/8/4k3/4K3 w - - 0 1'],
  ])('%s', (_, fen) => {
    expect(() => parsePgn(withFen(fen))).toThrow(PgnError);
  });

  test('huge move counters are clamped and the FEN is normalised', () => {
    const g = parsePgn('[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K3 w - - 99999999999 7junk"]\n\n1. Kd2');
    expect(g.startFen).toBe('4k3/8/8/8/8/8/8/4K3 w - - 99 7');
  });
});

describe('PGN parsing stays fast on hostile input', () => {
  test('rejects oversized text', () => {
    expect(() => parsePgn(' '.repeat(MAX_PGN_LENGTH + 1))).toThrow(/too large/);
  });

  test('200 KB of blank lines or glyphs parses in well under a second', () => {
    let t = performance.now();
    parsePgn('\n'.repeat(200_000) + '1. e4 e5');
    expect(performance.now() - t).toBeLessThan(1000);
    t = performance.now();
    expect(() => parsePgn('1. e4 ' + '!'.repeat(200_000) + 'a')).toThrow(PgnError);
    expect(performance.now() - t).toBeLessThan(1000);
  });

  test('header values cannot span lines and Result must be a real result', () => {
    // A header broken across lines is not read as a header (and here isn't a move either).
    expect(() => parsePgn('[White "a\n[Black "evil"]\n\n1. e4 e5')).toThrow(PgnError);
    const g = parsePgn('[Result "1-0 }{ injected"]\n\n1. e4 e5');
    expect(g.result).toBe('*');
  });
});

describe('engine failures end the job instead of hanging', () => {
  test('a CRITICAL ERROR line rejects the running search', async () => {
    const listeners: ((l: string) => void)[] = [];
    const transport: UciTransport = {
      post: (cmd) => {
        const say = (l: string) => queueMicrotask(() => listeners.forEach((f) => f(l)));
        if (cmd === 'uci') say('uciok');
        if (cmd === 'isready') say('readyok');
        if (cmd.startsWith('go')) say('info string CRITICAL ERROR: Unsupported position');
      },
      onLine: (fn) => listeners.push(fn),
      terminate: () => {},
    };
    const engine = new UciEngine(transport);
    await expect(engine.analyse('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', { depth: 5 })).rejects.toThrow(/rejected/);
    expect(engine.alive).toBe(false);
  });
});

describe('stored data is treated as untrusted', () => {
  test('settings are whitelisted and clamped', () => {
    const s = sanitizeSettings({ pieceSet: 'x) url(https://evil', boardTheme: '"><', workers: 9999, depth: 1e9, animationMs: -5, sound: 'yes' });
    expect(s).toMatchObject({ pieceSet: 'cburnett', boardTheme: 'green', workers: 0, depth: 16, animationMs: 250, sound: true });
    expect(sanitizeSettings(null).depth).toBe(16);
  });

  test('exported PGN headers cannot inject lines', () => {
    const report = {
      headers: { White: 'a"]\n[Evil "1', 'Bad Key': 'x' },
      engine: { name: 'SF', depth: 16 },
      white: { accuracy: 90 },
      black: { accuracy: 80 },
      result: '1-0 {x}',
      moves: [],
    } as unknown as GameReport;
    const pgn = annotatedPgn(report);
    const headerLines = pgn.split('\n\n')[0].split('\n');
    expect(headerLines.every((l) => /^\[\w+ ".*"\]$/.test(l))).toBe(true);
    expect(headerLines.some((l) => l.startsWith('[Evil'))).toBe(false);
    expect(pgn.trim().endsWith('*')).toBe(true);
  });
});
