import { negate, type Score } from '../engine/uci';

/** Lichess's win-probability curve, fitted on real games. */
const K = 0.00368208;

/** Win chance (0..1) for the side the centipawns belong to. Clamped like Lichess. */
export function cpToWin(cp: number): number {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 1 / (1 + Math.exp(-K * c));
}

export function scoreToWin(score: Score): number {
  if (score.kind === 'mate') return score.value > 0 ? 1 : 0;
  return cpToWin(score.value);
}

/** Centipawns for sorting/averaging; mates become ±1000-ish (mate sooner = bigger). */
export function scoreToCp(score: Score): number {
  if (score.kind === 'cp') return score.value;
  if (score.value === 0) return -1000;
  return score.value > 0 ? 1000 + (100 - Math.min(99, score.value)) : -1000 - (100 - Math.min(99, -score.value));
}

/** Evaluation in pawns (mates count as a big but finite number). */
export function scoreToPawns(score: Score): number {
  return Math.max(-15, Math.min(15, scoreToCp(score) / 100));
}

/** Converts a side-to-move score into White's point of view. */
export function toWhite(score: Score, sideToMove: 'w' | 'b'): Score {
  return sideToMove === 'w' ? score : negate(score);
}

/** "+1.24", "-0.30", "M3", "-M2", "0.00" */
export function formatScore(score: Score, digits = 2): string {
  if (score.kind === 'mate') {
    if (score.value === 0) return '#';
    return `${score.value > 0 ? '' : '-'}M${Math.abs(score.value)}`;
  }
  const v = score.value / 100;
  if (Math.abs(v) < 0.005) return (0).toFixed(digits);
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;
}

/** Shorter label for the eval bar: "1.2", "M3". */
export function formatScoreShort(score: Score): string {
  if (score.kind === 'mate') return score.value === 0 ? '#' : `M${Math.abs(score.value)}`;
  const v = Math.abs(score.value / 100);
  return v >= 10 ? v.toFixed(0) : v.toFixed(1);
}
