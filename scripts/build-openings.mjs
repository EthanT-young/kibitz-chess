// Builds src/data/openings.json from the Lichess chess-openings dataset (CC0).
// Source TSVs live in scripts/data/openings (https://github.com/lichess-org/chess-openings).
//
// Output: { names: ["ECO|Name", ...], pos: { <positionKey>: nameIndex | -1 } }
//   - every position reached in any named line is a "book" position
//   - positions that end a named line point at that name (-1 = book, unnamed)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { positionKey } from '../src/lib/chess/hash.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'scripts', 'data', 'openings');
const epd = (fen) => fen.split(' ').slice(0, 4).join(' ');

const rows = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsv')).sort()) {
  const lines = readFileSync(join(dir, file), 'utf8').split('\n').slice(1);
  for (const line of lines) {
    if (!line.trim()) continue;
    const [eco, name, pgn] = line.split('\t');
    rows.push({ eco, name, pgn });
  }
}

const names = [];
const pos = new Map(); // key -> { idx, plies }
let bad = 0;
for (const { eco, name, pgn } of rows) {
  const chess = new Chess();
  const sans = pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/);
  let ok = true;
  for (const san of sans) {
    try {
      chess.move(san);
    } catch {
      ok = false;
      break;
    }
    const key = positionKey(epd(chess.fen()));
    if (!pos.has(key)) pos.set(key, { idx: -1, plies: Infinity });
  }
  if (!ok) {
    bad++;
    continue;
  }
  const key = positionKey(epd(chess.fen()));
  const entry = pos.get(key);
  // Prefer the shortest line that names this exact position.
  if (entry.idx === -1 || sans.length < entry.plies) {
    names.push(`${eco}|${name}`);
    entry.idx = names.length - 1;
    entry.plies = sans.length;
  }
}

const out = { names, pos: Object.fromEntries([...pos].map(([k, v]) => [k, v.idx])) };
writeFileSync(join(root, 'src', 'data', 'openings.json'), JSON.stringify(out));
console.log(`openings: ${rows.length} lines, ${names.length} names, ${pos.size} book positions, ${bad} skipped`);
