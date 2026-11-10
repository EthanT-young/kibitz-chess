// Runs the same Stockfish WASM build the browser uses, as a Node child
// process (one process per engine, so tests use several cores like the app's
// Web Workers do).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import type { UciTransport } from '../../src/lib/engine/engine';

const require = createRequire(import.meta.url);

export function nodeTransport(flavor = 'lite-single'): UciTransport {
  const findEngine = require('stockfish').findEngine as (f: string) => string;
  const child = spawn(process.execPath, [findEngine(flavor)], { stdio: ['pipe', 'pipe', 'inherit'] });
  const listeners: ((line: string) => void)[] = [];
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) listeners.forEach((l) => l(line));
    }
  });
  return {
    post: (cmd) => child.stdin.write(cmd + '\n'),
    onLine: (fn) => listeners.push(fn),
    terminate: () => {
      child.stdin.end('quit\n');
      setTimeout(() => child.kill(), 200);
    },
  };
}
