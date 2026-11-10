import { UciEngine, type UciTransport } from './engine';
import type { PositionAnalysis } from './uci';

export interface PoolOptions {
  size: number;
  hashMb?: number;
}

export interface BatchOptions {
  depth: number;
  multiPv: number;
  onProgress?: (done: number, total: number, index: number, result: PositionAnalysis) => void;
  signal?: AbortSignal;
}

/**
 * Several single-threaded engines working through a list of positions in
 * parallel. Each worker is its own Stockfish, so this scales with CPU cores
 * without needing SharedArrayBuffer / cross-origin isolation.
 */
export class EnginePool {
  readonly engines: UciEngine[];

  constructor(factory: () => UciTransport, private opts: PoolOptions) {
    this.engines = Array.from({ length: Math.max(1, opts.size) }, () => new UciEngine(factory()));
  }

  async init(): Promise<void> {
    await Promise.all(this.engines.map((e) => e.init({ hashMb: this.opts.hashMb ?? 32 })));
  }

  async analyseAll(fens: string[], opts: BatchOptions): Promise<PositionAnalysis[]> {
    const results: PositionAnalysis[] = new Array(fens.length);
    let next = 0;
    let done = 0;
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      this.engines.forEach((e) => e.stop());
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const worker = async (engine: UciEngine) => {
      while (!aborted) {
        const index = next++;
        if (index >= fens.length) return;
        const res = await engine.analyse(fens[index], { depth: opts.depth, multiPv: opts.multiPv, fresh: true });
        if (aborted) return;
        results[index] = res;
        done++;
        opts.onProgress?.(done, fens.length, index, res);
      }
    };
    try {
      await Promise.all(this.engines.map(worker));
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
    }
    if (aborted) throw Object.assign(new Error('Analysis cancelled'), { name: 'AbortError' });
    return results;
  }

  terminate(): void {
    this.engines.forEach((e) => e.terminate());
  }
}
