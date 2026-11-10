import { Chess } from 'chess.js';
import { parseInfo, type InfoLine, type PositionAnalysis, type PvLine } from './uci';

/** Anything that speaks UCI line-by-line: a Web Worker, a Node process... */
export interface UciTransport {
  post(command: string): void;
  onLine(listener: (line: string) => void): void;
  terminate(): void;
}

export interface AnalyseOptions {
  depth?: number;
  movetime?: number;
  multiPv?: number;
  /**
   * Clear the hash first so the result doesn't depend on what this engine
   * searched before. Makes batch reviews reproducible across worker schedules.
   */
  fresh?: boolean;
  /** Called with the current best lines as the search deepens. */
  onUpdate?: (lines: PvLine[], depth: number) => void;
}

interface Job {
  fen: string;
  opts: AnalyseOptions;
  resolve: (a: PositionAnalysis) => void;
  reject: (e: unknown) => void;
}

/** Game-over check so the engine is never asked about finished positions. */
export function terminalState(fen: string): PositionAnalysis['terminal'] | undefined {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return 'checkmate';
  if (chess.isStalemate()) return 'stalemate';
  if (chess.isInsufficientMaterial()) return 'draw';
  return undefined;
}

/**
 * One UCI engine with a job queue. Searches run one at a time; calling
 * `stop()` ends the current search early and resolves it with what it has.
 */
export class UciEngine {
  private listeners: ((line: string) => void)[] = [];
  private queue: Job[] = [];
  private current: { job: Job; lines: Map<number, InfoLine>; depth: number; expectedPvs: number } | null = null;
  private currentMultiPv = 1;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  /** Fail a search if the engine goes silent this long (it normally talks every few ms). */
  static STALL_MS = 60_000;
  private ready: Promise<void> | null = null;
  private dead = false;
  name = 'Stockfish';

  constructor(private transport: UciTransport) {
    transport.onLine((raw) => {
      for (const line of String(raw).split('\n')) {
        const l = line.trim();
        if (!l) continue;
        this.handle(l);
        for (const fn of this.listeners.slice()) fn(l);
      }
    });
  }

  private waitFor(predicate: (line: string) => boolean, timeoutMs = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => l !== fn);
        reject(new Error('The engine did not respond in time.'));
      }, timeoutMs);
      const fn = (line: string) => {
        if (predicate(line)) {
          clearTimeout(timer);
          this.listeners = this.listeners.filter((l) => l !== fn);
          resolve(line);
        }
      };
      this.listeners.push(fn);
    });
  }

  init(options: { hashMb?: number; threads?: number } = {}): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        const uciok = this.waitFor((l) => l === 'uciok', 60000);
        // UCI sends "id name" before "uciok"; record it without waiting on it.
        const nameListener = (l: string) => {
          if (l.startsWith('id name')) this.name = l.replace('id name', '').trim();
        };
        this.listeners.push(nameListener);
        this.transport.post('uci');
        await uciok;
        this.listeners = this.listeners.filter((l) => l !== nameListener);
        if (options.hashMb) this.transport.post(`setoption name Hash value ${options.hashMb}`);
        if (options.threads) this.transport.post(`setoption name Threads value ${options.threads}`);
        this.transport.post('setoption name MultiPV value 1');
        this.currentMultiPv = 1;
        await this.isReady();
      })();
    }
    return this.ready;
  }

  private async isReady(): Promise<void> {
    const ok = this.waitFor((l) => l === 'readyok', 60000);
    this.transport.post('isready');
    await ok;
  }

  analyse(fen: string, opts: AnalyseOptions = {}): Promise<PositionAnalysis> {
    if (this.dead) return Promise.reject(new Error('Engine was shut down.'));
    const terminal = terminalState(fen);
    if (terminal) return Promise.resolve({ fen, depth: 0, lines: [], terminal });
    return new Promise((resolve, reject) => {
      this.queue.push({ fen, opts, resolve, reject });
      this.pump();
    });
  }

  /** Stop the running search (it resolves with its best result so far) and drop queued jobs. */
  stop(dropQueue = true): void {
    if (dropQueue) {
      for (const job of this.queue) job.reject(new DOMExceptionLike('Analysis cancelled', 'AbortError'));
      this.queue = [];
    }
    if (this.current) this.transport.post('stop');
  }

  get busy(): boolean {
    return !!this.current || this.queue.length > 0;
  }

  private async pump(): Promise<void> {
    if (this.current || !this.queue.length || this.dead) return;
    const job = this.queue.shift()!;
    const multiPv = Math.max(1, job.opts.multiPv ?? 1);
    const legal = new Chess(job.fen).moves().length;
    this.current = { job, lines: new Map(), depth: 0, expectedPvs: Math.min(multiPv, Math.max(1, legal)) };
    this.armWatchdog();
    try {
      await this.init();
      if (multiPv !== this.currentMultiPv) {
        this.transport.post(`setoption name MultiPV value ${multiPv}`);
        this.currentMultiPv = multiPv;
      }
      if (job.opts.fresh) {
        this.transport.post('ucinewgame');
        await this.isReady();
      }
      this.transport.post(`position fen ${job.fen}`);
      const limit = job.opts.movetime
        ? `movetime ${job.opts.movetime}`
        : `depth ${job.opts.depth ?? 16}`;
      this.transport.post(`go ${limit}`);
    } catch (e) {
      this.current = null;
      this.armWatchdog();
      job.reject(e);
      this.pump();
    }
  }

  private armWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = this.current ? setTimeout(() => this.fail('The engine stopped responding.'), UciEngine.STALL_MS) : null;
  }

  /** The engine is unusable: reject everything and shut it down. */
  private fail(message: string): void {
    if (this.dead) return;
    const err = new Error(message);
    const cur = this.current;
    this.current = null;
    cur?.job.reject(err);
    for (const job of this.queue) job.reject(err);
    this.queue = [];
    this.dead = true;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.transport.terminate();
  }

  get alive(): boolean {
    return !this.dead;
  }

  private handle(line: string): void {
    // Stockfish prints this for positions it refuses, then exits.
    if (line.includes('CRITICAL ERROR') || line.includes('Program terminated')) {
      this.fail('The engine rejected this position.');
      return;
    }
    const cur = this.current;
    if (!cur) return;
    this.armWatchdog();
    if (line.startsWith('info ')) {
      const info = parseInfo(line);
      if (!info) return;
      // Ignore bound-only updates; they are not exact scores.
      if (info.bound) return;
      if (info.multipv === 1 && info.depth > cur.depth) cur.depth = info.depth;
      cur.lines.set(info.multipv, info);
      // Report once per completed iteration (after the last PV of that depth).
      if (cur.job.opts.onUpdate && info.multipv === cur.expectedPvs) {
        cur.job.opts.onUpdate(this.snapshot(cur.lines, cur.depth), cur.depth);
      }
      return;
    }
    if (line.startsWith('bestmove')) {
      this.current = null;
      const lines = this.snapshot(cur.lines, cur.depth);
      // Make sure the best line starts with the engine's chosen move.
      const best = line.split(/\s+/)[1];
      if (best && best !== '(none)' && lines.length && lines[0].pv[0] !== best) {
        const idx = lines.findIndex((l) => l.pv[0] === best);
        if (idx > 0) {
          const [l] = lines.splice(idx, 1);
          lines.unshift(l);
        }
      }
      lines.forEach((l, i) => (l.multipv = i + 1));
      this.armWatchdog();
      cur.job.resolve({ fen: cur.job.fen, depth: cur.depth, lines });
      this.pump();
    }
  }

  private snapshot(map: Map<number, InfoLine>, depth: number): PvLine[] {
    // Keep only lines from the latest completed iteration where possible.
    const all = [...map.values()].sort((a, b) => a.multipv - b.multipv);
    const lines = all.filter((l) => l.depth >= depth - 1);
    return (lines.length ? lines : all).map(({ multipv, depth: d, score, pv, nodes }) => ({
      multipv,
      depth: d,
      score,
      pv,
      nodes,
    }));
  }

  terminate(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.dead = true;
    for (const job of this.queue) job.reject(new DOMExceptionLike('Engine shut down', 'AbortError'));
    this.queue = [];
    if (this.current) this.current.job.reject(new DOMExceptionLike('Engine shut down', 'AbortError'));
    this.current = null;
    this.transport.terminate();
  }
}

/** DOMException isn't available in every runtime we test in. */
export class DOMExceptionLike extends Error {
  constructor(message: string, public name: string) {
    super(message);
  }
}

export function isAbort(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError';
}
