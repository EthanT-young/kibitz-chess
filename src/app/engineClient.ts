import type { UciTransport } from '../lib/engine/engine';

/** URL of the Stockfish worker script; the .wasm sits next to it. */
export function engineUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`, document.baseURI).href;
}

/** A Stockfish instance in a Web Worker, speaking UCI over postMessage. */
export function workerTransport(): UciTransport {
  const worker = new Worker(engineUrl());
  const listeners: ((line: string) => void)[] = [];
  worker.onmessage = (e: MessageEvent) => {
    if (typeof e.data === 'string') listeners.forEach((l) => l(e.data));
  };
  worker.onerror = (e) => {
    console.error('Engine worker error', e.message);
  };
  return {
    post: (cmd) => worker.postMessage(cmd),
    onLine: (fn) => listeners.push(fn),
    terminate: () => worker.terminate(),
  };
}

export function wasmSupported(): boolean {
  return typeof WebAssembly === 'object' && typeof Worker !== 'undefined';
}
