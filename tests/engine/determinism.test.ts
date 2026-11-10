import { expect, test } from 'vitest';
import { Chess } from 'chess.js';
import { EnginePool } from '../../src/lib/engine/pool';
import { nodeTransport } from '../support/nodeEngine';

// Same positions, different worker counts => identical results when each
// search starts from a cleared hash.
test('batch analysis is reproducible regardless of worker scheduling', async () => {
  const chess = new Chess();
  const fens = [chess.fen()];
  for (const m of 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Nc3 Nxe4 O-O Bxc3'.split(' ')) {
    chess.move(m);
    fens.push(chess.fen());
  }
  const run = async (size: number) => {
    const pool = new EnginePool(() => nodeTransport(), { size, hashMb: 16 });
    await pool.init();
    const t0 = performance.now();
    const res = await pool.analyseAll(fens, { depth: 14, multiPv: 3 });
    const ms = performance.now() - t0;
    pool.terminate();
    return { res, ms };
  };
  const a = await run(1);
  const b = await run(4);
  console.log(`1 worker: ${a.ms.toFixed(0)} ms, 4 workers: ${b.ms.toFixed(0)} ms for ${fens.length} positions`);
  expect(b.res.map((r) => r.lines.map((l) => [l.pv[0], l.score.value]))).toEqual(
    a.res.map((r) => r.lines.map((l) => [l.pv[0], l.score.value])),
  );
});
