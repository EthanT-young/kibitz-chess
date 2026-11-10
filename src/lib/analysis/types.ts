import type { Color } from 'chess.js';
import type { Opening } from '../chess/openings';
import type { PositionAnalysis, Score } from '../engine/uci';

export type Classification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder'
  | 'forced';

/** Order used in the summary table. */
export const CLASSIFICATIONS: Classification[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
];

export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  brilliant: 'Brilliant',
  great: 'Great',
  best: 'Best',
  excellent: 'Excellent',
  good: 'Good',
  book: 'Book',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  miss: 'Miss',
  blunder: 'Blunder',
  forced: 'Forced',
};

export type Phase = 'opening' | 'middlegame' | 'endgame';

export interface CoachComment {
  /** e.g. "Nf3 is the best move" */
  title: string;
  /** One to three short sentences explaining the move. */
  body: string[];
}

export interface EngineLineView {
  uci: string;
  san: string;
  /** Score from White's point of view. */
  score: Score;
  /** SAN of the whole line */
  line: string[];
}

export interface MoveReview {
  /** 1-based index of this half-move in the game. */
  ply: number;
  moveNumber: number;
  color: Color;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  clock?: number;
  classification: Classification;
  /** Mover's win chance (0..1) with best play before the move, and after the move played. */
  winBefore: number;
  winAfter: number;
  /** Expected points lost (0..1). */
  epl: number;
  /** Lichess-style move accuracy, 0..100. */
  accuracy: number;
  /** Centipawns lost (capped), for average-centipawn-loss stats. */
  cpLoss: number;
  /** Evaluation after the move, from White's point of view. */
  evalAfter: Score;
  /** Engine's best move in the position before this move. */
  best?: EngineLineView;
  /** Engine's top alternatives before this move (White's point of view). */
  alternatives: EngineLineView[];
  /** The engine's expected continuation after the move that was played (SAN). */
  replyLine: string[];
  replyLineUci: string[];
  phase: Phase;
  opening?: Opening;
  coach: CoachComment;
}

export interface PlayerSummary {
  name: string;
  rating?: string;
  accuracy: number;
  counts: Record<Classification, number>;
  acpl: number;
  /** Rough performance-rating estimate for this game. */
  estimatedRating: number | null;
  phases: Record<Phase, { accuracy: number | null; grade: Classification | null }>;
}

export interface GameReport {
  id: string;
  createdAt: number;
  headers: Record<string, string>;
  startFen: string;
  result: string;
  /** e.g. "White won by checkmate" */
  resultText: string;
  white: PlayerSummary;
  black: PlayerSummary;
  moves: MoveReview[];
  /** Win chance for White after each ply (index 0 = start position). */
  whiteWin: number[];
  /** Evaluations of every position, White's point of view (index 0 = start). */
  evals: Score[];
  opening?: Opening;
  /** Plies (1-based) worth jumping to. */
  keyMoments: number[];
  /** The coach's summary of the whole game. */
  intro: string[];
  /** Side the reviewing player played, if known. */
  perspective?: Color;
  engine: { name: string; depth: number; multiPv: number };
  /** Raw engine output per position, kept for retries and exploration. */
  positions: PositionAnalysis[];
}
