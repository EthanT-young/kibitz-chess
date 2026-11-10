import { Chess } from 'chess.js';
import { majorsAndMinors } from '../chess/core';
import type { Phase } from './types';

/**
 * Splits a game into opening / middlegame / endgame, modelled on Lichess's
 * "Divider": the middlegame starts once pieces are traded or developed off the
 * back ranks (or the armies are mixed up), and the endgame starts when six or
 * fewer pieces (not counting kings and pawns) remain.
 */
export function phaseOfPositions(fens: string[]): Phase[] {
  let midStart = -1;
  let endStart = -1;
  fens.forEach((fen, i) => {
    const chess = new Chess(fen);
    const mm = majorsAndMinors(chess);
    if (midStart === -1 && (mm <= 10 || backrankSparse(chess) || mixedness(chess) > 150 || i >= 40)) {
      midStart = i;
    }
    if (endStart === -1 && mm <= 6) endStart = i;
  });
  return fens.map((_, i) => {
    if (endStart !== -1 && i >= endStart) return 'endgame';
    if (midStart !== -1 && i >= midStart) return 'middlegame';
    return 'opening';
  });
}

function backrankSparse(chess: Chess): boolean {
  const board = chess.board();
  const whiteBack = board[7].filter((p) => p && p.color === 'w').length;
  const blackBack = board[0].filter((p) => p && p.color === 'b').length;
  return whiteBack < 4 || blackBack < 4;
}

function regionScore(y: number, white: number, black: number): number {
  const key = `${white},${black}`;
  switch (key) {
    case '0,0': return 0;
    case '1,0': return 1 + (8 - y);
    case '2,0': return y > 2 ? 2 + (y - 2) : 0;
    case '3,0': return y > 1 ? 3 + (y - 1) : 0;
    case '4,0': return y > 1 ? 3 + (y - 1) : 0;
    case '0,1': return 1 + y;
    case '1,1': return 5 + Math.abs(3 - y);
    case '2,1': return 4 + y;
    case '3,1': return 5 + y;
    case '0,2': return y < 6 ? 2 + (6 - y) : 0;
    case '1,2': return 4 + (6 - y);
    case '2,2': return 7;
    case '0,3': return y < 7 ? 3 + (7 - y) : 0;
    case '1,3': return 5 + (6 - y);
    case '0,4': return y < 7 ? 3 + (7 - y) : 0;
    default: return 0;
  }
}

/** How intermixed the two armies are, scanned in 2x2 regions. */
function mixedness(chess: Chess): number {
  const board = chess.board(); // board[0] = rank 8
  let score = 0;
  for (let y = 1; y <= 7; y++) {
    for (let x = 0; x < 7; x++) {
      let w = 0;
      let b = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const rank = y + dy; // 1..8
        const p = board[8 - rank][x + dx];
        if (p) {
          if (p.color === 'w') w++;
          else b++;
        }
      }
      score += regionScore(y, w, b);
    }
  }
  return score;
}
