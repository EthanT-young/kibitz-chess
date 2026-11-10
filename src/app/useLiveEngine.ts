import { useEffect, useRef, useState } from 'react';
import { isAbort, UciEngine } from '../lib/engine/engine';
import type { PositionAnalysis, PvLine } from '../lib/engine/uci';
import { workerTransport } from './engineClient';

export interface LiveAnalysis {
  fen: string;
  depth: number;
  lines: PvLine[];
  done: boolean;
}

/** Results the live engine has finished, shared so variation moves can be judged. */
export const liveCache = new Map<string, PositionAnalysis>();

let shared: UciEngine | null = null;
function engine(): UciEngine {
  if (shared && !shared.alive) shared = null; // crashed: start a fresh one
  if (!shared) {
    shared = new UciEngine(workerTransport());
    void shared.init({ hashMb: 64 });
  }
  return shared;
}

/**
 * Streams Stockfish analysis for whatever position is on the board while the
 * user explores. Pass null to stop.
 */
export function useLiveEngine(fen: string | null, opts: { depth?: number; multiPv?: number } = {}): LiveAnalysis | null {
  const [state, setState] = useState<LiveAnalysis | null>(null);
  const depth = opts.depth ?? 20;
  const multiPv = opts.multiPv ?? 3;
  const token = useRef(0);

  useEffect(() => {
    const my = ++token.current;
    if (!fen) {
      shared?.stop();
      setState(null);
      return;
    }
    const cached = liveCache.get(fen);
    if (cached && cached.depth >= depth) {
      setState({ fen, depth: cached.depth, lines: cached.lines, done: true });
      return;
    }
    setState({ fen, depth: 0, lines: [], done: false });
    const eng = engine();
    eng.stop();
    // Small delay so fast clicking through moves doesn't queue searches.
    const timer = setTimeout(() => {
      eng
        .analyse(fen, {
          depth,
          multiPv,
          onUpdate: (lines, d) => {
            // Partial results are still useful for judging moves made from here.
            if (d >= 12 && lines.length && (liveCache.get(fen)?.depth ?? 0) < d) liveCache.set(fen, { fen, depth: d, lines });
            if (token.current === my) setState({ fen, depth: d, lines, done: false });
          },
        })
        .then((res) => {
          if (res.lines.length && (!liveCache.get(fen) || liveCache.get(fen)!.depth <= res.depth)) liveCache.set(fen, res);
          if (token.current === my) setState({ fen, depth: res.depth, lines: res.lines, done: true });
        })
        .catch((e) => {
          if (!isAbort(e)) console.error(e);
        });
    }, 60);
    return () => clearTimeout(timer);
  }, [fen, depth, multiPv]);

  return state;
}
