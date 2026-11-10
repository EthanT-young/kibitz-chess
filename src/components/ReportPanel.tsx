import { CLASSIFICATIONS, CLASSIFICATION_LABEL, type GameReport, type Phase } from '../lib/analysis/types';
import { describeTimeControl } from '../lib/chess/pgn';
import { ClassIcon, CLASS_COLOR } from './ClassIcon';
import { CoachBubble } from './CoachBubble';
import { EvalGraph } from './EvalGraph';
import { IconDownload } from './Icons';

interface Props {
  report: GameReport;
  pieceSet: string;
  onStart: () => void;
  onJump: (ply: number) => void;
  onDownload: () => void;
}

const PHASES: { id: Phase; label: string }[] = [
  { id: 'opening', label: 'Opening' },
  { id: 'middlegame', label: 'Middlegame' },
  { id: 'endgame', label: 'Endgame' },
];

function fmt(a: number): string {
  return Number.isFinite(a) ? a.toFixed(1) : '–';
}

export function ReportPanel({ report, pieceSet, onStart, onJump, onDownload }: Props) {
  const { white, black } = report;
  const tc = describeTimeControl(report.headers.TimeControl);
  const you = report.perspective;
  return (
    <>
    <div className="panel-body report">
      <CoachBubble pieceSet={pieceSet}>
        {report.intro.map((s, i) => (
          <p key={i}>{s}</p>
        ))}
      </CoachBubble>

      <EvalGraph whiteWin={report.whiteWin} evals={report.evals} moves={report.moves} onSelect={onJump} />

      <div className="summary-table">
        <div className="srow players">
          <span className="slabel">Players</span>
          <span className="scell">
            <span className="avatar avatar-w small">{white.name.slice(0, 1).toUpperCase()}</span>
            <span className="pname" title={white.name}>
              {you === 'w' ? 'You' : white.name}
            </span>
          </span>
          <span />
          <span className="scell">
            <span className="avatar avatar-b small">{black.name.slice(0, 1).toUpperCase()}</span>
            <span className="pname" title={black.name}>
              {you === 'b' ? 'You' : black.name}
            </span>
          </span>
        </div>
        <div className="srow accuracy">
          <span className="slabel">Accuracy</span>
          <span className="acc-box acc-w">{fmt(white.accuracy)}</span>
          <span />
          <span className="acc-box acc-b">{fmt(black.accuracy)}</span>
        </div>

        <div className="sdivider" />

        {CLASSIFICATIONS.map((c) => (
          <div className="srow count" key={c}>
            <span className="slabel" style={{ color: white.counts[c] || black.counts[c] ? CLASS_COLOR[c] : undefined }}>
              {CLASSIFICATION_LABEL[c]}
            </span>
            <span className="num" style={{ color: white.counts[c] ? CLASS_COLOR[c] : undefined }}>
              {white.counts[c]}
            </span>
            <ClassIcon c={c} size={22} />
            <span className="num" style={{ color: black.counts[c] ? CLASS_COLOR[c] : undefined }}>
              {black.counts[c]}
            </span>
          </div>
        ))}

        <div className="sdivider" />

        <div className="srow rating">
          <span className="slabel" title="Estimated rating you played at in this game: starts from your rating and moves toward the rating that typically plays with your accuracy. Needs player ratings in the PGN.">
            Game rating
          </span>
          <span className="rating-box">{white.estimatedRating ?? '–'}</span>
          <span />
          <span className="rating-box">{black.estimatedRating ?? '–'}</span>
        </div>
        {PHASES.map((p) => (
          <div className="srow phase" key={p.id}>
            <span className="slabel">{p.label}</span>
            <span className="phase-icon">{white.phases[p.id].grade ? <ClassIcon c={white.phases[p.id].grade!} size={22} title /> : <span className="muted">–</span>}</span>
            <span />
            <span className="phase-icon">{black.phases[p.id].grade ? <ClassIcon c={black.phases[p.id].grade!} size={22} title /> : <span className="muted">–</span>}</span>
          </div>
        ))}
      </div>

      <div className="report-foot">
        <span className="muted">
          {report.opening ? `${report.opening.eco} · ${report.opening.name}` : 'Opening not in book'}
          {tc ? ` · ${tc.label}` : ''}
        </span>
        <button className="link-btn" onClick={onDownload}>
          <IconDownload size={15} /> Annotated PGN
        </button>
      </div>
    </div>
    <div className="panel-foot">
      <button className="btn primary big" onClick={onStart}>
        Start review
      </button>
    </div>
    </>
  );
}
