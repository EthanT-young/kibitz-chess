import { expect, test } from 'vitest';
import { UciEngine } from '../../src/lib/engine/engine';
import { EnginePool } from '../../src/lib/engine/pool';
import { nodeTransport } from '../support/nodeEngine';

// Stockfish exits on positions it can't handle. Make sure that ends the
// analysis with an error instead of leaving the review spinning forever.
const BAD = 'rnbqkbnr/pppppppp/pppppppp/8/8/PPPPPPPP/PPPPPPPP/RNBQKBNR w - - 0 1';

test('a position the real engine rejects fails fast', async () => {
  const engine = new UciEngine(nodeTransport());
  await engine.init();
  const t0 = Date.now();
  await expect(engine.analyse(BAD, { depth: 10 })).rejects.toThrow(/rejected/);
  expect(Date.now() - t0).toBeLessThan(10_000);
  engine.terminate();
});

test('the batch analysis rejects too (so the UI can show an error)', async () => {
  const pool = new EnginePool(() => nodeTransport(), { size: 2 });
  await pool.init();
  await expect(pool.analyseAll(['8/8/8/8/8/8/8/K1k4R w - - 0 1', BAD], { depth: 8, multiPv: 1 })).rejects.toThrow();
  pool.terminate();
});
