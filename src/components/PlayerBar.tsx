import type { Color, PieceSymbol } from 'chess.js';
import { formatClock } from '../lib/chess/pgn';
import { pieceUrl } from './Board';

const START_COUNT: Record<PieceSymbol, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Pieces of `color` that are gone from the board, and the material balance. */
export function capturedInfo(fen: string): { lostBy: Record<Color, PieceSymbol[]>; balance: number } {
  const counts: Record<Color, Record<PieceSymbol, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
  };
  for (const ch of fen.split(' ')[0]) {
    if (!/[pnbrqk]/i.test(ch)) continue;
    counts[ch === ch.toUpperCase() ? 'w' : 'b'][ch.toLowerCase() as PieceSymbol]++;
  }
  const lostBy: Record<Color, PieceSymbol[]> = { w: [], b: [] };
  let balance = 0;
  for (const c of ['w', 'b'] as Color[]) {
    for (const t of ['q', 'r', 'b', 'n', 'p'] as PieceSymbol[]) {
      const missing = Math.max(0, START_COUNT[t] - counts[c][t]);
      for (let i = 0; i < missing; i++) lostBy[c].push(t);
      balance += (c === 'w' ? 1 : -1) * counts[c][t] * VALUE[t];
    }
  }
  return { lostBy, balance };
}

interface Props {
  name: string;
  rating?: string;
  color: Color;
  fen: string;
  clock?: string;
  active?: boolean;
  pieceSet: string;
  tag?: string;
}

export function PlayerBar({ name, rating, color, fen, clock, active, pieceSet, tag }: Props) {
  const { lostBy, balance } = capturedInfo(fen);
  const taken = lostBy[color === 'w' ? 'b' : 'w'];
  const adv = color === 'w' ? balance : -balance;
  return (
    <div className="player-bar">
      <div className={`avatar ${color === 'w' ? 'avatar-w' : 'avatar-b'}`} aria-hidden>
        {name.slice(0, 1).toUpperCase()}
      </div>
      <div className="player-meta">
        <div className="player-name">
          <span className="name">{name}</span>
          {rating && <span className="rating">({rating})</span>}
          {tag && <span className="you-tag">{tag}</span>}
        </div>
        <div className="captured">
          {taken.map((t, i) => (
            <span
              key={i}
              className={`cap cap-${t}`}
              style={{ backgroundImage: `url(${pieceUrl(pieceSet, color === 'w' ? 'b' : 'w', t)})` }}
            />
          ))}
          {adv > 0 && <span className="adv">+{adv}</span>}
        </div>
      </div>
      {clock && <div className={`clock${active ? ' active' : ''}`}>{clock}</div>}
    </div>
  );
}

export function clockAt(moves: { color: Color; clock?: number }[], ply: number, color: Color): string | undefined {
  for (let i = Math.min(ply, moves.length) - 1; i >= 0; i--) {
    if (moves[i].color === color && moves[i].clock !== undefined) return formatClock(moves[i].clock);
  }
  // Before the player's first move, show their first recorded clock.
  const first = moves.find((m) => m.color === color && m.clock !== undefined);
  return first ? formatClock(first.clock) : undefined;
}
