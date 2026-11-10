import { describe, expect, test } from 'vitest';
import { printReport, reviewPgn } from '../support/runReview';
import {
  CLUB_GAME_WITH_CLOCKS,
  GAME_OF_THE_CENTURY,
  IMMORTAL_GAME,
  LEGALS_MATE,
  OPERA_GAME,
} from '../fixtures/games';

const show = !!process.env.SHOW;
const byMove = (r: Awaited<ReturnType<typeof reviewPgn>>, label: string) =>
  r.moves.find((m) => `${m.moveNumber}${m.color === 'w' ? '.' : '...'}${m.san}` === label)!;

describe('full review with real Stockfish', () => {
  test('Opera Game', async () => {
    const r = await reviewPgn(OPERA_GAME);
    if (show) console.log(printReport(r));
    expect(byMove(r, '1.e4').classification).toBe('book');
    expect(byMove(r, '17.Rd8#').coach.title).toBe('Rd8# is checkmate');
    expect(byMove(r, '16.Qb8+').classification).toBe('brilliant');
    expect(r.white.accuracy).toBeGreaterThan(r.black.accuracy);
  });

  test("Legal's mate", async () => {
    const r = await reviewPgn(LEGALS_MATE);
    if (show) console.log(printReport(r));
    expect(byMove(r, '5...Bxd1').classification).toBe('blunder');
    expect(byMove(r, '5...Bxd1').coach.body.join(' ')).toMatch(/checkmate/i);
  });

  test('club game with clocks (perspective: black)', async () => {
    const r = await reviewPgn(CLUB_GAME_WITH_CLOCKS, { perspective: 'b' });
    if (show) console.log(printReport(r));
    expect(r.moves[0].clock).toBeCloseTo(598.1, 1);
    expect(r.resultText).toBe('You won by checkmate.');
    const nxe5 = byMove(r, '4.Nxe5');
    expect(['mistake', 'blunder']).toContain(nxe5.classification);
  });

  test('a hanging queen that is not taken is a miss', async () => {
    const r = await reviewPgn('1. e4 e5 2. Nf3 Qh4 3. d3 Qxe4+ 4. Be2');
    if (show) console.log(printReport(r));
    expect(byMove(r, '2...Qh4').classification).toBe('blunder');
    expect(byMove(r, '2...Qh4').coach.body.join(' ')).toMatch(/Nxh4/);
    const miss = byMove(r, '3.d3');
    expect(miss.classification).toBe('miss');
    expect(miss.coach.body[0]).toBe('The queen on h4 was free to take with Nxh4.');
  });

  test('Immortal Game', async () => {
    const r = await reviewPgn(IMMORTAL_GAME);
    if (show) console.log(printReport(r));
    expect(byMove(r, '23.Be7#').coach.title).toContain('checkmate');
  });

  test('Game of the Century', async () => {
    const r = await reviewPgn(GAME_OF_THE_CENTURY);
    if (show) console.log(printReport(r));
    expect(byMove(r, '41...Rc2#').coach.title).toContain('checkmate');
  });
});
