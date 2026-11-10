import type { Color } from 'chess.js';
import type { Score } from '../lib/engine/uci';
import { formatScoreShort } from '../lib/analysis/winprob';

/** Vertical evaluation bar. `whiteWin` (0..1) sets the split; `score` is from White's view. */
export function EvalBar({ whiteWin, score, orientation, result }: { whiteWin: number; score: Score | null; orientation: Color; result?: string | null }) {
  const pct = Math.max(0, Math.min(100, whiteWin * 100));
  const whiteAhead = whiteWin >= 0.5;
  let label = score ? formatScoreShort(score) : '';
  if (result) label = result === '1/2-1/2' ? '½-½' : result;
  else if (score?.kind === 'mate' && score.value === 0) label = whiteAhead ? '1-0' : '0-1';
  // The label sits on the side that is ahead.
  const labelAtBottom = (whiteAhead && orientation === 'w') || (!whiteAhead && orientation === 'b');
  return (
    <div className={`eval-bar ${orientation === 'b' ? 'flipped' : ''}`} aria-label={`Evaluation ${label}`}>
      <div className="eval-white" style={{ height: `${pct}%` }} />
      <span className={`eval-label ${labelAtBottom ? 'bottom' : 'top'} ${whiteAhead ? 'on-white' : 'on-black'}`}>{label}</span>
    </div>
  );
}
