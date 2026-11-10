import type { Color } from 'chess.js';
import { CLASSIFICATION_LABEL, type GameReport, type MoveReview } from '../analysis/types';

function fmtAcc(a: number): string {
  return Number.isFinite(a) ? a.toFixed(1) : '–';
}

function moveLabel(m: MoveReview): string {
  return `${m.moveNumber}${m.color === 'w' ? '.' : '...'} ${m.san}`;
}

export function resultText(headers: Record<string, string>, result: string, finalCheckmate: boolean, perspective?: Color): string {
  const term = (headers.Termination ?? '').toLowerCase();
  const white = headers.White && headers.White !== '?' ? headers.White : 'White';
  const black = headers.Black && headers.Black !== '?' ? headers.Black : 'Black';
  let how = '';
  if (finalCheckmate || term.includes('checkmate')) how = 'by checkmate';
  else if (term.includes('time') && !term.includes('insufficient')) how = 'on time';
  else if (term.includes('resign')) how = 'by resignation';
  else if (term.includes('abandon')) how = 'by abandonment';
  else if (term.includes('repetition')) how = 'by repetition';
  else if (term.includes('stalemate')) how = 'by stalemate';
  else if (term.includes('insufficient')) how = 'by insufficient material';
  else if (term.includes('agreement')) how = 'by agreement';
  else if (term.includes('50')) how = 'by the 50-move rule';

  if (result === '1-0' || result === '0-1') {
    const winner: Color = result === '1-0' ? 'w' : 'b';
    if (perspective) return `You ${perspective === winner ? 'won' : 'lost'}${how ? ' ' + how : ''}.`;
    return `${winner === 'w' ? white : black} won${how ? ' ' + how : ''}.`;
  }
  if (result === '1/2-1/2') {
    return perspective ? `You drew${how ? ' ' + how : ''}.` : `The game was drawn${how ? ' ' + how : ''}.`;
  }
  return 'The game was not finished.';
}

export function summarizeGame(report: Omit<GameReport, 'intro'>): string[] {
  const out: string[] = [report.resultText];
  const p = report.perspective;
  const wa = report.white.accuracy;
  const ba = report.black.accuracy;

  if (p) {
    const mine = p === 'w' ? wa : ba;
    const theirs = p === 'w' ? ba : wa;
    out.push(`Your accuracy was ${fmtAcc(mine)}, against ${fmtAcc(theirs)} for your opponent.`);
  } else if (Number.isFinite(wa) && Number.isFinite(ba)) {
    if (wa >= 90 && ba >= 90) out.push(`Both sides played very precisely (${fmtAcc(wa)} and ${fmtAcc(ba)}).`);
    else if (Math.abs(wa - ba) >= 12) {
      const better = wa > ba ? 'White' : 'Black';
      out.push(`${better} was clearly the more accurate side: ${fmtAcc(wa)} for White, ${fmtAcc(ba)} for Black.`);
    } else out.push(`Accuracy was close: ${fmtAcc(wa)} for White, ${fmtAcc(ba)} for Black.`);
  }

  const brilliant = report.moves.find((m) => m.classification === 'brilliant');
  const errors = report.moves
    .filter((m) => m.classification === 'blunder' || m.classification === 'mistake' || m.classification === 'miss')
    .sort((a, b) => b.epl - a.epl);
  const turning = errors[0];
  if (turning && turning.epl >= 0.15) {
    const who = p ? (turning.color === p ? 'your' : "your opponent's") : turning.color === 'w' ? "White's" : "Black's";
    const label = CLASSIFICATION_LABEL[turning.classification].toLowerCase();
    out.push(`The turning point came on move ${turning.moveNumber}: ${who} ${turning.san} was ${label === 'inaccuracy' ? 'an' : 'a'} ${label}.`);
  } else if (!errors.length) {
    out.push('Neither side made a serious mistake.');
  }
  if (brilliant) out.push(`Don't miss ${moveLabel(brilliant)}, a brilliant sacrifice.`);
  return out;
}
