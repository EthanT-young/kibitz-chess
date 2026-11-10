// Copies the single-threaded "lite" Stockfish WASM build into public/engine so
// Vite serves it as a static asset. Runs automatically after `npm install`.
//
// The lite single-threaded build (~1.8 MB) needs no special server headers,
// so the app works on any static host (GitHub Pages, Netlify, a USB stick...).
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'stockfish', 'bin');
const dest = join(root, 'public', 'engine');
const files = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'];

if (!existsSync(src)) {
  console.error('[copy-engine] node_modules/stockfish not found; run npm install');
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
for (const f of files) {
  copyFileSync(join(src, f), join(dest, f));
}
copyFileSync(join(root, 'node_modules', 'stockfish', 'Copying.txt'), join(dest, 'COPYING.txt'));
console.log(`[copy-engine] copied ${files.join(', ')} -> public/engine`);
