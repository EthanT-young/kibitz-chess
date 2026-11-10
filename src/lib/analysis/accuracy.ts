/**
 * Accuracy, following Lichess's published method
 * (https://lichess.org/page/accuracy): a per-move score from the drop in win
 * chance, then a game score that mixes a volatility-weighted mean with a
 * harmonic mean so that a few big blunders weigh heavily.
 */

/** winBefore/winAfter are the mover's win chances, 0..1. Returns 0..100. */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  const diff = (winBefore - winAfter) * 100;
  if (diff <= 0) return 100;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * diff) - 3.166924740191411;
  return Math.min(100, Math.max(0, raw + 1));
}

function stdev(xs: number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
}

/**
 * @param whiteWin White's win chance for every position (0..1), start included.
 * @param accuracies per-move accuracy, index i = move from position i to i+1
 * @param moverIsWhite for each move, whether White made it
 */
export function gameAccuracy(
  whiteWin: number[],
  accuracies: number[],
  moverIsWhite: boolean[],
): { white: number; black: number } {
  const n = accuracies.length;
  const wins = whiteWin.map((w) => w * 100);
  const windowSize = Math.min(8, Math.max(2, Math.floor(n / 10)));
  const windows: number[][] = [];
  const first = wins.slice(0, windowSize);
  for (let i = 0; i < Math.min(windowSize, wins.length) - 2; i++) windows.push(first);
  for (let i = 0; i + windowSize <= wins.length; i++) windows.push(wins.slice(i, i + windowSize));
  const weights = accuracies.map((_, i) => {
    const w = windows[i] ?? windows[windows.length - 1] ?? [50, 50];
    return Math.min(12, Math.max(0.5, stdev(w)));
  });

  const forColor = (white: boolean): number => {
    const idx = accuracies.map((_, i) => i).filter((i) => moverIsWhite[i] === white);
    if (!idx.length) return NaN;
    const wsum = idx.reduce((a, i) => a + weights[i], 0);
    const weighted = idx.reduce((a, i) => a + accuracies[i] * weights[i], 0) / wsum;
    const harmonic = idx.length / idx.reduce((a, i) => a + 1 / Math.max(1, accuracies[i]), 0);
    return (weighted + harmonic) / 2;
  };
  return { white: forColor(true), black: forColor(false) };
}

/*
 * ---------------------------------------------------------------------------
 * Chess.com-style accuracy and game rating.
 *
 * Chess.com doesn't publish its formulas, so these were fitted against 96
 * player-games (2024-2026, ratings ~150-2400) that Chess.com had reviewed,
 * using their official accuracies from the public API:
 *   - accuracy: average of per-move scores on a flatter win-chance curve,
 *     book and forced moves skipped. Typical error vs. Chess.com: ±6 points
 *     (the Lichess formula above was ±11.5 on the same games).
 *   - typical accuracy at rating R: 59.5 + 1.12 per 100 rating points.
 * ---------------------------------------------------------------------------
 */
const LICHESS_K = 0.00368208;
const CAPS_SLOPE = 0.55;
const CAPS_SCALE = 0.04;
const CAPS_POWER = 1.5;

/** Re-express a Lichess-curve win chance on the flatter curve used for scoring. */
function flatten(win: number): number {
  if (win >= 0.999) return 1; // forced mate for the mover
  if (win <= 0.001) return 0; // getting mated
  const cp = Math.log(win / (1 - win)) / LICHESS_K;
  const c = Math.max(-1000, Math.min(1000, cp));
  return 1 / (1 + Math.exp(-LICHESS_K * CAPS_SLOPE * c));
}

/** Per-move score (0..100) from the mover's win chances before/after. */
export function moveScore(winBefore: number, winAfter: number): number {
  const drop = Math.max(0, flatten(winBefore) - flatten(winAfter));
  return 100 * Math.exp(-Math.pow(drop / CAPS_SCALE, CAPS_POWER));
}

/** Game accuracy: the mean of per-move scores (pass book/forced moves already removed). */
export function averageAccuracy(scores: number[]): number {
  if (!scores.length) return 100;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/** Typical accuracy for a player of this rating (daily games run higher). */
export function expectedAccuracy(rating: number, daily = false): number {
  return 59.5 + 0.0112 * rating + (daily ? 5 : 0);
}

/**
 * Game rating, anchored on the player's actual rating as Chess.com describes:
 * start from your rating and move 40% of the way toward the rating that
 * typically plays with this accuracy. Rounded to 50 like Chess.com shows it.
 * Returns null without a rating to anchor on or with too few real moves.
 */
export function estimateGameRating(accuracy: number, rating: number | null, scoredMoves: number, daily = false): number | null {
  if (rating === null || !Number.isFinite(rating) || rating <= 0) return null;
  if (!Number.isFinite(accuracy) || scoredMoves < 5) return null;
  const implied = (accuracy - expectedAccuracy(0, daily)) / 0.0112;
  const est = rating + 0.4 * (implied - rating);
  return Math.round(Math.min(3300, Math.max(100, est)) / 50) * 50;
}
