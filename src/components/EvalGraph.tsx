import { useMemo, useRef, useState } from 'react';
import type { Classification, MoveReview } from '../lib/analysis/types';
import { formatScore } from '../lib/analysis/winprob';
import type { Score } from '../lib/engine/uci';
import { CLASS_COLOR } from './ClassIcon';

const MARKED: Classification[] = ['brilliant', 'great', 'miss', 'mistake', 'blunder'];

interface Props {
  /** White's win chance for each position (index 0 = start). Undefined = not analysed yet. */
  whiteWin: (number | undefined)[];
  evals?: Score[];
  moves?: MoveReview[];
  ply?: number;
  onSelect?: (ply: number) => void;
  height?: number;
}

/** Win-chance graph across the game: white area = White's share. */
export function EvalGraph({ whiteWin, evals, moves, ply, onSelect, height = 92 }: Props) {
  const W = 600;
  const H = height;
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(1, whiteWin.length - 1);
  const xAt = (i: number) => (i / n) * W;
  const yAt = (w: number) => (1 - w) * H;

  const path = useMemo(() => {
    let last = 0.5;
    const pts = whiteWin.map((w, i) => {
      if (w !== undefined) last = w;
      // Keep the curve a hair away from the edges so the line stays visible.
      const v = Math.min(0.985, Math.max(0.015, last));
      return `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`;
    });
    return `M0,${H} L${pts.join(' L')} L${W},${H} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whiteWin, H]);

  const pick = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return null;
    return Math.max(0, Math.min(n, Math.round(((clientX - rect.left) / rect.width) * n)));
  };

  const hovered = hover !== null ? hover : null;
  const hoverMove = hovered && moves ? moves[hovered - 1] : undefined;

  return (
    <div className="eval-graph">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Evaluation graph"
        onPointerMove={(e) => setHover(pick(e.clientX))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const i = pick(e.clientX);
          if (i !== null) onSelect?.(i);
        }}
        style={{ cursor: onSelect ? 'pointer' : 'default', height: `${H}px` }}
      >
        <rect x="0" y="0" width={W} height={H} className="graph-bg" />
        <path d={path} className="graph-white" />
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="graph-mid" />
        {ply !== undefined && <line x1={xAt(ply)} x2={xAt(ply)} y1="0" y2={H} className="graph-cursor" />}
        {hovered !== null && <line x1={xAt(hovered)} x2={xAt(hovered)} y1="0" y2={H} className="graph-hover" />}
      </svg>
      {/* Markers are HTML so they stay round regardless of the SVG's stretch. */}
      {moves?.map((m) =>
        MARKED.includes(m.classification) && whiteWin[m.ply] !== undefined ? (
          <span
            key={m.ply}
            className="graph-dot"
            style={{
              left: `${(m.ply / n) * 100}%`,
              top: `${(1 - Math.min(0.985, Math.max(0.015, whiteWin[m.ply]!))) * 100}%`,
              background: CLASS_COLOR[m.classification],
            }}
          />
        ) : null,
      )}
      {hoverMove && evals && (
        <div className="graph-tip" style={{ left: `${(hovered! / n) * 100}%` }}>
          {hoverMove.moveNumber}
          {hoverMove.color === 'w' ? '.' : '...'} {hoverMove.san} <b>{formatScore(evals[hovered!], 1)}</b>
        </div>
      )}
    </div>
  );
}
