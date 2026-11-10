import { useEffect, useRef } from 'react';
import type { MoveReview } from '../lib/analysis/types';
import { ClassIcon } from './ClassIcon';

const SHOW_ICON = new Set(['brilliant', 'great', 'best', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder']);

interface Props {
  moves: MoveReview[];
  ply: number;
  onSelect: (ply: number) => void;
}

/** Two-column move list with classification icons. */
export function MoveList({ moves, ply, onSelect }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('.mv.current');
    if (el && box.current) {
      const top = el.offsetTop - box.current.offsetTop;
      const { scrollTop, clientHeight } = box.current;
      if (top < scrollTop + 8 || top > scrollTop + clientHeight - 40) {
        box.current.scrollTo({ top: Math.max(0, top - clientHeight / 2), behavior: 'smooth' });
      }
    }
  }, [ply]);

  const rows: { no: number; w?: MoveReview; b?: MoveReview }[] = [];
  for (const m of moves) {
    if (m.color === 'w' || !rows.length) rows.push({ no: m.moveNumber, [m.color]: m });
    else rows[rows.length - 1].b = m;
  }

  const cell = (m?: MoveReview) =>
    m ? (
      <button className={`mv${m.ply === ply ? ' current' : ''}`} onClick={() => onSelect(m.ply)}>
        <span className="mv-icon">{SHOW_ICON.has(m.classification) && <ClassIcon c={m.classification} size={16} />}</span>
        <span className="mv-san">{m.san}</span>
      </button>
    ) : (
      <span className="mv empty" />
    );

  return (
    <div className="move-list" ref={box}>
      {rows.map((r) => (
        <div className="mv-row" key={`${r.no}-${r.w?.ply ?? r.b?.ply}`}>
          <span className="mv-no">{r.no}.</span>
          {cell(r.w)}
          {cell(r.b)}
        </div>
      ))}
    </div>
  );
}
