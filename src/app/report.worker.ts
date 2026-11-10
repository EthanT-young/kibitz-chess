/// <reference lib="webworker" />
// Builds the review (classification + coach text) off the main thread.
import { loadOpeningBook } from '../lib/chess/openings';
import type { ParsedGame } from '../lib/chess/pgn';
import { buildReport, type ReportMeta } from '../lib/analysis/review';
import type { PositionAnalysis } from '../lib/engine/uci';

interface Request {
  id: number;
  game: ParsedGame;
  positions: PositionAnalysis[];
  meta: ReportMeta;
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const { id, game, positions, meta } = e.data;
  try {
    const book = await loadOpeningBook();
    const report = buildReport(game, positions, book, meta);
    (self as unknown as Worker).postMessage({ id, report });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
