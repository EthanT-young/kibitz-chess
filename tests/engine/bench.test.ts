// Quick timing check: how long does the lite engine take per position?
// Run with: npx vite-node scripts/bench.ts  (or via vitest)
import { Chess } from 'chess.js';
import { UciEngine } from '../../src/lib/engine/engine';
import { nodeTransport } from '../support/nodeEngine';

const pgnMoves =
  'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8'.split(' ');

async function main() {
  const chess = new Chess();
  const fens = [chess.fen()];
  for (const m of pgnMoves) {
    chess.move(m);
    fens.push(chess.fen());
  }
  const engine = new UciEngine(nodeTransport());
  await engine.init({ hashMb: 32 });
  console.log('engine:', engine.name);
  for (const [depth, multiPv] of [[12, 3], [14, 3], [16, 3], [18, 3], [16, 1]]) {
    const t0 = performance.now();
    for (const fen of fens) await engine.analyse(fen, { depth, multiPv });
    const ms = performance.now() - t0;
    console.log(`depth ${depth} multipv ${multiPv}: ${(ms / fens.length).toFixed(0)} ms/position`);
  }
  engine.terminate();
}

import { test } from 'vitest';
test.skipIf(!process.env.BENCH)('benchmark', main);
