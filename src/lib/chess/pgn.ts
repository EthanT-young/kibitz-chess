import { Chess, type Color } from 'chess.js';
import { START_FEN, moveToUci } from './core';

export interface ParsedMove {
  san: string;
  uci: string;
  color: Color;
  fenBefore: string;
  fenAfter: string;
  /** Clock time left after the move, in seconds (from [%clk]) */
  clock?: number;
}

export interface ParsedGame {
  headers: Record<string, string>;
  startFen: string;
  moves: ParsedMove[];
  /** '1-0' | '0-1' | '1/2-1/2' | '*' */
  result: string;
}

export class PgnError extends Error {}

const RESULT_RE = /^(1-0|0-1|1\/2-1\/2|\*)$/;

function parseClock(comment: string): number | undefined {
  const m = comment.match(/\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/);
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Splits text containing several games and returns the first one that has moves. */
export function splitGames(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const games: string[] = [];
  let current: string[] = [];
  let sawMoves = false;
  for (const line of normalized.split('\n')) {
    const isHeader = /^\s*\[\w+\s+".*"\]\s*$/.test(line);
    if (isHeader && sawMoves) {
      games.push(current.join('\n'));
      current = [];
      sawMoves = false;
    }
    if (!isHeader && line.trim()) sawMoves = true;
    current.push(line);
  }
  if (current.join('').trim()) games.push(current.join('\n'));
  return games;
}

/**
 * A forgiving PGN reader. Takes the main line only (variations are skipped),
 * keeps [%clk] clock comments, ignores NAGs and annotation glyphs, and accepts
 * plain move lists without headers (e.g. "1. e4 e5 2. Nf3").
 */
/**
 * Positions chess.js accepts but Stockfish rejects (and crashes on): the side
 * not to move in check, too many pieces or pawns.
 */
export function engineSafePosition(chess: Chess): boolean {
  let pieces = 0;
  const pawns = { w: 0, b: 0 };
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p) continue;
      pieces++;
      if (p.type === 'p') pawns[p.color]++;
    }
  }
  if (pieces > 32 || pawns.w > 8 || pawns.b > 8) return false;
  const them = chess.turn() === 'w' ? 'b' : 'w';
  const theirKing = chess.findPiece({ type: 'k', color: them })[0];
  return !!theirKing && !chess.isAttacked(theirKing, chess.turn());
}

/** Keep the move counters in a range the engine handles. */
export function clampHalfmove(fen: string): string {
  const parts = fen.split(' ');
  parts[4] = String(Math.min(Number(parts[4]) || 0, 99));
  parts[5] = String(Math.min(Math.max(Number(parts[5]) || 1, 1), 9999));
  return parts.join(' ');
}

/** Longest PGN we accept: far bigger than any real game, small enough to parse instantly. */
export const MAX_PGN_LENGTH = 256 * 1024;
const MAX_MOVES = 1000;
const HEADER_LINE = /^\[(\w+)\s+"((?:[^"\\\n]|\\.)*)"\]$/;

export function parsePgn(text: string): ParsedGame {
  if (text.length > MAX_PGN_LENGTH) throw new PgnError('That PGN is too large. Paste a single game.');
  const source = splitGames(text)[0] ?? '';
  const headers: Record<string, string> = {};
  // Headers are read line by line (linear time; values can't span lines).
  const bodyLines: string[] = [];
  for (const line of source.split('\n')) {
    const m = HEADER_LINE.exec(line.trim());
    if (m) headers[m[1]] = m[2].replace(/\\(["\\])/g, '$1');
    else bodyLines.push(line);
  }
  const movetext = bodyLines.join('\n');

  let chess: Chess;
  try {
    chess = new Chess(headers.FEN && (headers.SetUp === '1' || !headers.SetUp) ? headers.FEN : START_FEN);
  } catch {
    throw new PgnError('The starting position (FEN) in this PGN is not valid.');
  }
  if (!engineSafePosition(chess)) throw new PgnError('The starting position (FEN) in this PGN is not a legal chess position.');
  // Use chess.js's normalised FEN, never the raw header text.
  const startFen = clampHalfmove(chess.fen());
  if (startFen !== chess.fen()) chess.load(startFen);

  const moves: ParsedMove[] = [];
  let result = RESULT_RE.test(headers.Result ?? '') ? headers.Result : '*';
  let i = 0;
  let depth = 0; // variation nesting
  const n = movetext.length;

  const attachComment = (comment: string) => {
    if (depth > 0 || !moves.length) return;
    const clk = parseClock(comment);
    if (clk !== undefined) moves[moves.length - 1].clock = clk;
  };

  while (i < n) {
    const ch = movetext[i];
    if (ch === '{') {
      const end = movetext.indexOf('}', i + 1);
      const comment = movetext.slice(i + 1, end === -1 ? n : end);
      attachComment(comment);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (ch === ';') {
      const end = movetext.indexOf('\n', i + 1);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    // read a token
    let j = i;
    while (j < n && !/[\s{}();]/.test(movetext[j])) j++;
    const token = movetext.slice(i, j);
    i = j;
    if (depth > 0) continue;
    if (token.length > 24) throw new PgnError(`Couldn't read "${token.slice(0, 24)}…" as a move.`);
    if (RESULT_RE.test(token)) {
      result = token;
      continue;
    }
    if (/^\$\d+$/.test(token)) continue; // NAG
    // strip move numbers like "12." "12..." "12...e5"
    const stripped = token.replace(/^\d+\.(\.\.)?/, '').replace(/^\.+/, '');
    if (!stripped) continue;
    const san = stripped.replace(/[!?]{1,4}$/, '').replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O');
    if (!san || /^\d+$/.test(san)) continue;
    if (san === '--' || san === 'Z0') throw new PgnError('Null moves are not supported.');
    const fenBefore = chess.fen();
    let mv;
    try {
      mv = chess.move(san, { strict: false });
    } catch {
      mv = null;
    }
    if (!mv) {
      const moveNo = Math.floor(moves.length / 2) + 1;
      throw new PgnError(`Couldn't read move ${moveNo}${chess.turn() === 'w' ? '.' : '...'} "${san}" — it isn't legal in this position.`);
    }
    moves.push({ san: mv.san, uci: moveToUci(mv), color: mv.color, fenBefore, fenAfter: chess.fen() });
    if (moves.length > MAX_MOVES) throw new PgnError('That game is too long to review.');
  }

  if (!moves.length) throw new PgnError('No moves found. Paste a PGN or a move list like "1. e4 e5 2. Nf3".');
  return { headers, startFen, moves, result };
}

export interface TimeControlInfo {
  label: string;
  /** bullet | blitz | rapid | classical | daily | unknown */
  speed: string;
}

export function describeTimeControl(tc: string | undefined): TimeControlInfo | null {
  if (!tc || tc === '-' || tc === '?') return null;
  if (tc.includes('/')) {
    const days = Number(tc.split('/')[1]) / 86400;
    return { label: days >= 1 ? `${days} day${days === 1 ? '' : 's'}/move` : tc, speed: 'daily' };
  }
  const [base, inc] = tc.split('+').map(Number);
  if (!Number.isFinite(base)) return null;
  const total = base + 40 * (inc || 0);
  const speed = total < 180 ? 'bullet' : total < 480 ? 'blitz' : total < 1500 ? 'rapid' : 'classical';
  const baseLabel = base >= 60 ? `${+(base / 60).toFixed(1)} min` : `${base} sec`;
  return { label: inc ? `${baseLabel} + ${inc}s` : baseLabel, speed };
}

export function formatClock(seconds: number | undefined): string {
  if (seconds === undefined) return '';
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const secStr = s < 20 ? sec.toFixed(1).padStart(4, '0') : String(Math.floor(sec)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${secStr}` : `${m}:${secStr}`;
}
