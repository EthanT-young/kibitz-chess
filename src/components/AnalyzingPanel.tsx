import type { ReviewProgress } from '../app/reviewRunner';
import { CoachBubble } from './CoachBubble';
import { EvalGraph } from './EvalGraph';

interface Props {
  progress: ReviewProgress | null;
  pieceSet: string;
  depth: number;
  workers: number;
  onCancel: () => void;
}

export function AnalyzingPanel({ progress, pieceSet, depth, workers, onCancel }: Props) {
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const starting = !progress;
  return (
    <div className="panel-body analyzing">
      <CoachBubble pieceSet={pieceSet} title={starting ? 'Starting the engine…' : done < total ? 'Reviewing your game…' : 'Writing up the review…'}>
        <p>
          {starting
            ? 'Loading Stockfish in your browser. This takes a moment the first time.'
            : `Checking every position at depth ${depth} with ${workers} engine${workers === 1 ? '' : 's'} in parallel.`}
        </p>
      </CoachBubble>
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-meta">
        <span>
          {done} / {total || '…'} positions
        </span>
        <span>{pct}%</span>
      </div>
      {progress && <EvalGraph whiteWin={progress.whiteWin} />}
      <button className="btn ghost" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
