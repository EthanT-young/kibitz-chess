import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Color } from 'chess.js';
import { bookFromData, type OpeningBook } from '../../src/lib/chess/openings';
import { parsePgn } from '../../src/lib/chess/pgn';
import { buildReport } from '../../src/lib/analysis/review';
import type { GameReport } from '../../src/lib/analysis/types';
import { EnginePool } from '../../src/lib/engine/pool';
import { nodeTransport } from './nodeEngine';
import type { PositionAnalysis } from '../../src/lib/engine/uci';

let book: OpeningBook | null = null;
export function nodeBook(): OpeningBook {
  if (!book) {
    const data = JSON.parse(readFileSync(join(__dirname, '..', '..', 'src', 'data', 'openings.json'), 'utf8'));
    book = bookFromData(data);
  }
  return book;
}

const cache = new Map<string, PositionAnalysis[]>();

export async function reviewPgn(pgn: string, opts: { depth?: number; multiPv?: number; perspective?: Color } = {}): Promise<GameReport> {
  const game = parsePgn(pgn);
  const depth = opts.depth ?? 16;
  const multiPv = opts.multiPv ?? 3;
  const fens = [game.startFen, ...game.moves.map((m) => m.fenAfter)];
  const key = `${fens.join('|')}@${depth}/${multiPv}`;
  let positions = cache.get(key);
  if (!positions) {
    const pool = new EnginePool(() => nodeTransport(), { size: 4, hashMb: 32 });
    await pool.init();
    positions = await pool.analyseAll(fens, { depth, multiPv });
    pool.terminate();
    cache.set(key, positions);
  }
  return buildReport(game, positions, nodeBook(), { engineName: 'Stockfish 19 Lite', depth, multiPv, perspective: opts.perspective });
}

export function printReport(r: GameReport): string {
  const lines: string[] = [];
  lines.push(`${r.white.name} vs ${r.black.name}  ${r.result}  — ${r.opening ? r.opening.eco + ' ' + r.opening.name : 'no opening'}`);
  lines.push(`Accuracy W ${r.white.accuracy.toFixed(1)} B ${r.black.accuracy.toFixed(1)} | est ${r.white.estimatedRating} / ${r.black.estimatedRating} | ACPL ${r.white.acpl.toFixed(0)} / ${r.black.acpl.toFixed(0)}`);
  lines.push(...r.intro.map((s) => '  » ' + s));
  for (const m of r.moves) {
    const label = `${m.moveNumber}${m.color === 'w' ? '.' : '...'} ${m.san}`.padEnd(14);
    lines.push(
      `${label} ${m.classification.padEnd(10)} epl=${m.epl.toFixed(3)} acc=${m.accuracy.toFixed(0).padStart(3)} best=${(m.best?.san ?? '').padEnd(7)} ${m.phase.slice(0, 3)} | ${m.coach.title}. ${m.coach.body.join(' ')}`,
    );
  }
  return lines.join('\n');
}
