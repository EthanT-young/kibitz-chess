import type { ReactNode } from 'react';
import type { Classification, GameReport } from '../lib/analysis/types';
import { CoachBubble } from './CoachBubble';
import { EvalGraph } from './EvalGraph';
import { IconBack, IconFirst, IconFlip, IconLast, IconNext, IconPrev } from './Icons';
import { MoveList } from './MoveList';

export interface CoachAction {
  id: string;
  label: string;
  kind?: 'primary' | 'secondary';
  icon?: ReactNode;
}

export interface CoachView {
  classification?: Classification | null;
  title: string;
  evalText?: string | null;
  body: string[];
  actions: CoachAction[];
}

export interface EngineLineRow {
  key: string;
  evalText: string;
  positive: boolean;
  moves: string;
}

interface Props {
  report: GameReport;
  ply: number;
  pieceSet: string;
  coach: CoachView;
  onAction: (id: string) => void;
  onSelect: (ply: number) => void;
  onNav: (dir: 'first' | 'prev' | 'next' | 'last') => void;
  onFlip: () => void;
  onSummary: () => void;
  variationText?: ReactNode;
  engineLines?: EngineLineRow[] | null;
  engineDepth?: number | null;
}

export function ReviewPanel(p: Props) {
  const { coach } = p;
  return (
    <div className="panel-body review">
      <CoachBubble
        pieceSet={p.pieceSet}
        classification={coach.classification}
        title={coach.title}
        evalText={coach.evalText}
        actions={
          coach.actions.length > 0 && (
            <>
              {coach.actions.map((a) => (
                <button key={a.id} className={`btn small ${a.kind === 'primary' ? 'primary' : 'secondary'}`} onClick={() => p.onAction(a.id)}>
                  {a.icon}
                  {a.label}
                </button>
              ))}
            </>
          )
        }
      >
        {coach.body.map((s, i) => (
          <p key={i}>{s}</p>
        ))}
      </CoachBubble>

      {p.variationText && <div className="variation-strip">{p.variationText}</div>}

      {p.engineLines && (
        <div className="engine-lines" aria-label="Engine lines">
          <div className="engine-lines-head">
            <span>Stockfish</span>
            <span className="muted">{p.engineDepth ? `depth ${p.engineDepth}` : 'thinking…'}</span>
          </div>
          {p.engineLines.map((l) => (
            <div className="engine-line" key={l.key}>
              <span className={`eval-chip ${l.positive ? 'pos' : 'neg'}`}>{l.evalText}</span>
              <span className="engine-moves">{l.moves}</span>
            </div>
          ))}
        </div>
      )}

      <EvalGraph whiteWin={p.report.whiteWin} evals={p.report.evals} moves={p.report.moves} ply={p.ply} onSelect={p.onSelect} height={72} />

      <MoveList moves={p.report.moves} ply={p.ply} onSelect={p.onSelect} />

      <div className="nav-bar">
        <button className="icon-btn" onClick={p.onSummary} aria-label="Back to summary" title="Summary">
          <IconBack />
        </button>
        <div className="nav-main">
          <button className="nav-btn" onClick={() => p.onNav('first')} aria-label="First move" title="First (Home)">
            <IconFirst />
          </button>
          <button className="nav-btn" onClick={() => p.onNav('prev')} aria-label="Previous move" title="Previous (←)">
            <IconPrev />
          </button>
          <button className="nav-btn primary" onClick={() => p.onNav('next')} aria-label="Next move" title="Next (→)">
            <IconNext />
          </button>
          <button className="nav-btn" onClick={() => p.onNav('last')} aria-label="Last move" title="Last (End)">
            <IconLast />
          </button>
        </div>
        <button className="icon-btn" onClick={p.onFlip} aria-label="Flip board" title="Flip board (F)">
          <IconFlip />
        </button>
      </div>
    </div>
  );
}
