import type { Color } from 'chess.js';
import { loadOpeningBook } from '../lib/chess/openings';
import type { ParsedGame } from '../lib/chess/pgn';
import { buildReport, positionEval, type ReportMeta } from '../lib/analysis/review';
import type { GameReport } from '../lib/analysis/types';
import { EnginePool } from '../lib/engine/pool';
import type { PositionAnalysis } from '../lib/engine/uci';
import { workerTransport } from './engineClient';

export interface ReviewProgress {
  done: number;
  total: number;
  /** White's win chance per position, filled in as positions finish. */
  whiteWin: (number | undefined)[];
}

export interface ReviewOptions {
  depth: number;
  multiPv?: number;
  workers: number;
  perspective?: Color;
  signal?: AbortSignal;
  onProgress?: (p: ReviewProgress) => void;
}

/** Runs the (CPU-heavy) report build in a worker; falls back to the main thread. */
async function buildInWorker(game: ParsedGame, positions: PositionAnalysis[], meta: ReportMeta): Promise<GameReport> {
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('./report.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  if (!worker) return buildReport(game, positions, await loadOpeningBook(), meta);
  try {
    return await new Promise<GameReport>((resolve, reject) => {
      worker!.onmessage = (e: MessageEvent<{ report?: GameReport; error?: string }>) =>
        e.data.report ? resolve(e.data.report) : reject(new Error(e.data.error ?? 'Report failed'));
      worker!.onerror = (e) => reject(new Error(e.message || 'Report worker failed'));
      worker!.postMessage({ id: 1, game, positions, meta });
    });
  } catch (e) {
    console.warn('Report worker failed, building on the main thread instead.', e);
    return buildReport(game, positions, await loadOpeningBook(), meta);
  } finally {
    worker.terminate();
  }
}

/** Analyses every position of a game with a pool of Stockfish workers and builds the review. */
export async function reviewGame(game: ParsedGame, opts: ReviewOptions): Promise<GameReport> {
  const fens = [game.startFen, ...game.moves.map((m) => m.fenAfter)];
  const multiPv = opts.multiPv ?? 3;
  const pool = new EnginePool(workerTransport, { size: Math.min(opts.workers, fens.length), hashMb: 16 });
  const whiteWin: (number | undefined)[] = new Array(fens.length).fill(undefined);
  let positions: PositionAnalysis[];
  try {
    await pool.init();
    opts.onProgress?.({ done: 0, total: fens.length, whiteWin });
    positions = await pool.analyseAll(fens, {
      depth: opts.depth,
      multiPv,
      signal: opts.signal,
      onProgress: (done, total, index, res) => {
        whiteWin[index] = positionEval(res).whiteWin;
        opts.onProgress?.({ done, total, whiteWin: whiteWin.slice() });
      },
    });
  } finally {
    pool.terminate();
  }
  return buildInWorker(game, positions, {
    engineName: pool.engines[0].name,
    depth: opts.depth,
    multiPv,
    perspective: opts.perspective,
  });
}
