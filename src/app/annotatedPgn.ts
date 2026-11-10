import type { Classification, GameReport } from '../lib/analysis/types';
import { CLASSIFICATION_LABEL } from '../lib/analysis/types';
import type { Score } from '../lib/engine/uci';

function evalTag(s: Score): string {
  if (s.kind === 'mate') return `#${s.value}`;
  return (s.value / 100).toFixed(2);
}

const NAG: Partial<Record<Classification, string>> = {
  brilliant: '$3',
  great: '$1',
  inaccuracy: '$6',
  mistake: '$2',
  miss: '$2',
  blunder: '$4',
};

function escapeComment(s: string): string {
  return s.replace(/[{}]/g, '');
}

/** PGN with the review baked in: symbols, evaluations and the coach's notes. */
export function annotatedPgn(report: GameReport): string {
  const headers = { ...report.headers };
  headers.Annotator = `Kibitz (${report.engine.name}, depth ${report.engine.depth})`;
  headers.WhiteAccuracy = report.white.accuracy.toFixed(1);
  headers.BlackAccuracy = report.black.accuracy.toFixed(1);
  if (!headers.Result) headers.Result = report.result;
  const head = Object.entries(headers)
    .filter(([k]) => /^\w{1,40}$/.test(k))
    .map(([k, v]) => `[${k} "${String(v).replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`)
    .join('\n');

  const parts: string[] = [];
  report.moves.forEach((m) => {
    // Every move carries a comment, so Black's moves are always numbered.
    parts.push(m.color === 'w' ? `${m.moveNumber}.` : `${m.moveNumber}...`);
    parts.push(m.san + (NAG[m.classification] ? ` ${NAG[m.classification]}` : ''));
    const notes: string[] = [`[%eval ${evalTag(m.evalAfter)}]`];
    if (m.clock !== undefined) {
      const h = Math.floor(m.clock / 3600);
      const mm = Math.floor((m.clock % 3600) / 60);
      const ss = (m.clock % 60).toFixed(1);
      notes.push(`[%clk ${h}:${String(mm).padStart(2, '0')}:${ss.padStart(4, '0')}]`);
    }
    const interesting = !['book', 'best', 'excellent', 'good', 'forced'].includes(m.classification);
    if (interesting) notes.push(`${CLASSIFICATION_LABEL[m.classification]}. ${escapeComment(m.coach.body.join(' '))}`);
    parts.push(`{ ${notes.join(' ')} }`);
    if (interesting && m.best && m.best.uci !== m.uci && m.best.line.length) {
      const prefix = m.color === 'w' ? `${m.moveNumber}.` : `${m.moveNumber}...`;
      parts.push(`( ${prefix} ${m.best.line.slice(0, 6).join(' ')} )`);
    }
  });
  parts.push(/^(1-0|0-1|1\/2-1\/2|\*)$/.test(report.result) ? report.result : '*');

  // Wrap at ~80 columns.
  const lines: string[] = [];
  let line = '';
  for (const p of parts) {
    if ((line + ' ' + p).trim().length > 80 && line) {
      lines.push(line.trim());
      line = '';
    }
    line += ' ' + p;
  }
  if (line.trim()) lines.push(line.trim());
  return `${head}\n\n${lines.join('\n')}\n`;
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/x-chess-pgn' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
