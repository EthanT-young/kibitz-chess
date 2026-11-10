import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Classification } from '../lib/analysis/types';
import { ClassIcon } from './ClassIcon';

export interface Arrow {
  from: Square;
  to: Square;
  color: string;
}

export interface BoardProps {
  fen: string;
  orientation: Color;
  lastMove?: { from: Square; to: Square } | null;
  badge?: { square: Square; classification: Classification } | null;
  arrows?: Arrow[];
  interactive?: boolean;
  onMove?: (m: { from: Square; to: Square; promotion?: PieceSymbol }) => void;
  pieceSet: string;
  theme: string;
  /** Piece slide duration in ms; 0 turns animation off. */
  animationMs?: number;
}

interface PieceView {
  id: number;
  square: Square;
  type: PieceSymbol;
  color: Color;
}

const FILES = 'abcdefgh';

export function pieceUrl(set: string, color: Color, type: PieceSymbol): string {
  return `${import.meta.env.BASE_URL}pieces/${set}/${color}${type.toUpperCase()}.svg`;
}

function toXY(sq: Square, o: Color): [number, number] {
  const f = sq.charCodeAt(0) - 97;
  const r = Number(sq[1]) - 1;
  return o === 'w' ? [f, 7 - r] : [7 - f, r];
}

function fromXY(x: number, y: number, o: Color): Square {
  const f = o === 'w' ? x : 7 - x;
  const r = o === 'w' ? 7 - y : y;
  return `${FILES[f]}${r + 1}` as Square;
}

function parsePlacement(fen: string): { square: Square; type: PieceSymbol; color: Color }[] {
  const out: { square: Square; type: PieceSymbol; color: Color }[] = [];
  const rows = fen.split(' ')[0].split('/');
  rows.forEach((row, i) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) file += Number(ch);
      else {
        out.push({
          square: `${FILES[file]}${8 - i}` as Square,
          type: ch.toLowerCase() as PieceSymbol,
          color: ch === ch.toUpperCase() ? 'w' : 'b',
        });
        file++;
      }
    }
  });
  return out;
}

let pieceIds = 1;

/** Keeps piece identities between positions so moved pieces slide instead of blinking. */
function diffPieces(prev: PieceView[], fen: string): { pieces: PieceView[]; moved: number } {
  const next = parsePlacement(fen);
  const pool = [...prev];
  const result: PieceView[] = [];
  const pending: typeof next = [];
  for (const p of next) {
    const i = pool.findIndex((q) => q.square === p.square && q.type === p.type && q.color === p.color);
    if (i >= 0) result.push(pool.splice(i, 1)[0]);
    else pending.push(p);
  }
  let moved = 0;
  for (const p of pending) {
    let best = -1;
    let bestD = Infinity;
    pool.forEach((q, i) => {
      if (q.type !== p.type || q.color !== p.color) return;
      const d = Math.abs(q.square.charCodeAt(0) - p.square.charCodeAt(0)) + Math.abs(Number(q.square[1]) - Number(p.square[1]));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) {
      result.push({ ...pool.splice(best, 1)[0], square: p.square });
      moved++;
    } else {
      result.push({ id: pieceIds++, ...p });
    }
  }
  return { pieces: result, moved };
}

function ArrowShape({ a, o }: { a: Arrow; o: Color }) {
  const [fx, fy] = toXY(a.from, o);
  const [tx, ty] = toXY(a.to, o);
  const p0 = { x: fx + 0.5, y: fy + 0.5 };
  const p2 = { x: tx + 0.5, y: ty + 0.5 };
  const dx = tx - fx;
  const dy = ty - fy;
  const isKnight = (Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1);
  const pts = [p0];
  if (isKnight) {
    // L-shaped arrow: go along the long leg first.
    pts.push(Math.abs(dy) > Math.abs(dx) ? { x: p0.x, y: p2.y } : { x: p2.x, y: p0.y });
  }
  const last = pts[pts.length - 1];
  const len = Math.hypot(p2.x - last.x, p2.y - last.y) || 1;
  const u = { x: (p2.x - last.x) / len, y: (p2.y - last.y) / len };
  const n = { x: -u.y, y: u.x };
  const headLen = 0.42;
  const headW = 0.46;
  const tip = { x: p2.x - u.x * 0.08, y: p2.y - u.y * 0.08 };
  const baseC = { x: tip.x - u.x * headLen, y: tip.y - u.y * headLen };
  // Start the shaft a little off the piece's centre.
  const first = pts[1] ?? baseC;
  const l0 = Math.hypot(first.x - p0.x, first.y - p0.y) || 1;
  const start = { x: p0.x + ((first.x - p0.x) / l0) * 0.22, y: p0.y + ((first.y - p0.y) / l0) * 0.22 };
  const shaft = [start, ...pts.slice(1), baseC].map((p) => `${p.x},${p.y}`).join(' ');
  const head = [
    tip,
    { x: baseC.x + (n.x * headW) / 2, y: baseC.y + (n.y * headW) / 2 },
    { x: baseC.x - (n.x * headW) / 2, y: baseC.y - (n.y * headW) / 2 },
  ]
    .map((p) => `${p.x},${p.y}`)
    .join(' ');
  return (
    <g opacity={0.82}>
      <polyline points={shaft} fill="none" stroke={a.color} strokeWidth={0.19} strokeLinejoin="miter" />
      <polygon points={head} fill={a.color} />
    </g>
  );
}

export function Board({ fen, orientation, lastMove, badge, arrows = [], interactive, onMove, pieceSet, theme, animationMs = 250 }: BoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const prevPieces = useRef<PieceView[]>([]);
  const { pieces, moved } = useMemo(() => diffPieces(prevPieces.current, fen), [fen]);
  useLayoutEffect(() => {
    prevPieces.current = pieces;
  }, [pieces]);
  const animate = animationMs > 0 && moved > 0 && moved <= 3;

  const [selected, setSelected] = useState<Square | null>(null);
  const [drag, setDrag] = useState<{ from: Square; id: number; x: number; y: number; started: boolean } | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square; color: Color } | null>(null);

  useEffect(() => {
    setSelected(null);
    setDrag(null);
    setPromo(null);
  }, [fen]);

  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return null;
    }
  }, [fen]);
  const turn = (fen.split(' ')[1] ?? 'w') as Color;
  const legal = useMemo(() => (interactive && chess ? chess.moves({ verbose: true }) : []), [chess, interactive]);
  const targets = useMemo(() => (selected ? legal.filter((m) => m.from === selected) : []), [legal, selected]);
  const checkSquare = useMemo(() => {
    if (!chess || !chess.inCheck()) return null;
    return chess.findPiece({ type: 'k', color: chess.turn() })[0] ?? null;
  }, [chess]);

  const squareAt = (clientX: number, clientY: number): Square | null => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = Math.floor(((clientX - rect.left) / rect.width) * 8);
    const y = Math.floor(((clientY - rect.top) / rect.height) * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    return fromXY(x, y, orientation);
  };

  const tryMove = (from: Square, to: Square): boolean => {
    const cands = legal.filter((m) => m.from === from && m.to === to);
    if (!cands.length) return false;
    if (cands.some((m) => m.promotion)) {
      setPromo({ from, to, color: turn });
      return true;
    }
    onMove?.({ from, to });
    return true;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || e.button !== 0 || promo) return;
    const sq = squareAt(e.clientX, e.clientY);
    if (!sq) return;
    if (selected && sq !== selected && targets.some((m) => m.to === sq)) {
      tryMove(selected, sq);
      setSelected(null);
      return;
    }
    const piece = pieces.find((p) => p.square === sq);
    if (piece && piece.color === turn) {
      setSelected(sq);
      setDrag({ from: sq, id: piece.id, x: e.clientX, y: e.clientY, started: false });
      boardRef.current?.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else {
      setSelected(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const started = drag.started || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4;
    setDrag({ ...drag, x: e.clientX, y: e.clientY, started });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const sq = squareAt(e.clientX, e.clientY);
    if (drag.started && sq && sq !== drag.from) {
      if (tryMove(drag.from, sq)) setSelected(null);
    }
    setDrag(null);
  };

  const dragStyle = (): React.CSSProperties | undefined => {
    if (!drag?.started || !boardRef.current) return undefined;
    const rect = boardRef.current.getBoundingClientRect();
    const size = rect.width / 8;
    return {
      transform: `translate(${drag.x - rect.left - size / 2}px, ${drag.y - rect.top - size / 2}px)`,
      zIndex: 20,
      transition: 'none',
      cursor: 'grabbing',
    };
  };

  const squares = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const sq = fromXY(x, y, orientation);
      const light = (sq.charCodeAt(0) - 97 + Number(sq[1])) % 2 === 1;
      const cls = ['sq', light ? 'light' : 'dark'];
      if (lastMove && (lastMove.from === sq || lastMove.to === sq)) cls.push('last');
      if (selected === sq) cls.push('selected');
      if (checkSquare === sq) cls.push('check');
      const target = targets.find((m) => m.to === sq);
      squares.push(
        <div key={sq} className={cls.join(' ')} data-square={sq}>
          {x === 0 && <span className="coord rank">{sq[1]}</span>}
          {y === 7 && <span className="coord file">{sq[0]}</span>}
          {target && <span className={target.captured ? 'hint capture' : 'hint'} />}
        </div>,
      );
    }
  }

  let badgeEl = null;
  if (badge) {
    const [bx, by] = toXY(badge.square, orientation);
    badgeEl = (
      <div className="square-badge" style={{ left: `${(bx + 1) * 12.5}%`, top: `${by * 12.5}%` }}>
        <ClassIcon c={badge.classification} size={64} />
      </div>
    );
  }

  return (
    <div className={`board theme-${theme}`} role="img" aria-label="Chess board" style={{ '--move-ms': `${animationMs}ms` } as React.CSSProperties}>
      <div
        ref={boardRef}
        className={`board-inner${animate ? ' animate' : ''}${interactive ? ' interactive' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        <div className="squares">{squares}</div>
        <div className="pieces">
          {pieces.map((p) => {
            const [x, y] = toXY(p.square, orientation);
            const dragging = drag?.id === p.id && drag.started;
            return (
              <div
                key={p.id}
                className={`piece${dragging ? ' dragging' : ''}`}
                style={{
                  backgroundImage: `url(${pieceUrl(pieceSet, p.color, p.type)})`,
                  transform: `translate(${x * 100}%, ${y * 100}%)`,
                  ...(dragging ? dragStyle() : null),
                }}
              />
            );
          })}
        </div>
        {arrows.length > 0 && (
          <svg className="arrows" viewBox="0 0 8 8" aria-hidden>
            {arrows.map((a) => (
              <ArrowShape key={`${a.from}${a.to}${a.color}`} a={a} o={orientation} />
            ))}
          </svg>
        )}
        {badgeEl}
        {promo && (
          <div className="promo-backdrop" onPointerDown={(e) => { e.stopPropagation(); setPromo(null); }}>
            {(['q', 'n', 'r', 'b'] as PieceSymbol[]).map((t, i) => {
              const [x, y] = toXY(promo.to, orientation);
              const dir = y === 0 ? 1 : -1;
              return (
                <button
                  key={t}
                  className="promo-choice"
                  style={{ left: `${x * 12.5}%`, top: `${(y + dir * i) * 12.5}%` }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onMove?.({ from: promo.from, to: promo.to, promotion: t });
                    setPromo(null);
                  }}
                  aria-label={`Promote to ${t}`}
                >
                  <span style={{ backgroundImage: `url(${pieceUrl(pieceSet, promo.color, t)})` }} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
