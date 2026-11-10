import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';

export type { Color, Move, PieceSymbol, Square };

export const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export const PIECE_NAME: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const opposite = (c: Color): Color => (c === 'w' ? 'b' : 'w');
export const colorName = (c: Color): string => (c === 'w' ? 'White' : 'Black');

export const FILES = 'abcdefgh';

/** file 0..7 (a..h), rank 0..7 (1..8) */
export function toSquare(file: number, rank: number): Square {
  return (FILES[file] + (rank + 1)) as Square;
}

export function fileOf(sq: Square): number {
  return sq.charCodeAt(0) - 97;
}

export function rankOf(sq: Square): number {
  return sq.charCodeAt(1) - 49;
}

export function onBoard(file: number, rank: number): boolean {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

export function sideToMove(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

/** Placement + side + castling + en-passant: identifies a position for book lookups. */
export function epd(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export interface UciMove {
  from: Square;
  to: Square;
  promotion?: PieceSymbol;
}

export function parseUci(uci: string): UciMove {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci.length > 4 ? (uci[4] as PieceSymbol) : undefined,
  };
}

export function moveToUci(m: Pick<Move, 'from' | 'to' | 'promotion'>): string {
  return m.from + m.to + (m.promotion ?? '');
}

/** Plays a UCI move; returns the chess.js Move or null when illegal. */
export function playUci(chess: Chess, uci: string): Move | null {
  try {
    return chess.move(parseUci(uci));
  } catch {
    return null;
  }
}

/** Converts a UCI line into SAN, stopping at the first illegal move. */
export function uciLineToSan(fen: string, uciLine: string[], max = 99): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const uci of uciLine.slice(0, max)) {
    const m = playUci(chess, uci);
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

export function uciToSan(fen: string, uci: string): string | null {
  return uciLineToSan(fen, [uci], 1)[0] ?? null;
}

export function materialOf(chess: Chess, color: Color): number {
  let total = 0;
  for (const row of chess.board()) {
    for (const p of row) {
      if (p && p.color === color) total += PIECE_VALUE[p.type];
    }
  }
  return total;
}

/** Material from White's point of view. */
export function materialBalance(chess: Chess): number {
  return materialOf(chess, 'w') - materialOf(chess, 'b');
}

/** Non-pawn, non-king piece count for both sides (Lichess "majors and minors"). */
export function majorsAndMinors(chess: Chess): number {
  let n = 0;
  for (const row of chess.board()) {
    for (const p of row) {
      if (p && p.type !== 'p' && p.type !== 'k') n++;
    }
  }
  return n;
}

/**
 * The same position with the other side to move (a "null move"). Returns null
 * when the side to move is in check, because then a null move is illegal.
 */
export function nullMoveFen(fen: string): string | null {
  const chess = new Chess(fen);
  if (chess.inCheck()) return null;
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  try {
    const flipped = parts.join(' ');
    new Chess(flipped);
    return flipped;
  } catch {
    return null;
  }
}

export function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

export function withArticle(word: string): string {
  return `${article(word)} ${word}`;
}

export function pluralPiece(t: PieceSymbol, n: number): string {
  const name = PIECE_NAME[t];
  return n === 1 ? name : `${name}s`;
}
