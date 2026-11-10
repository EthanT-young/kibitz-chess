import type { GameReport } from '../lib/analysis/types';

/** Recent reviews, kept in this browser only. */
const INDEX_KEY = 'kibitz.history.v1';
const ITEM_PREFIX = 'kibitz.report.v1.';
const MAX_ITEMS = 25;

export interface HistoryEntry {
  id: string;
  savedAt: number;
  white: string;
  black: string;
  whiteAccuracy: number;
  blackAccuracy: number;
  result: string;
  date?: string;
  opening?: string;
}

/** Stored data is untrusted (it can be stale, corrupt or edited): keep only well-formed entries. */
function validEntry(e: unknown): e is HistoryEntry {
  if (!e || typeof e !== 'object') return false;
  const x = e as Record<string, unknown>;
  return (
    typeof x.id === 'string' && /^[a-z0-9]{1,16}$/.test(x.id) &&
    typeof x.white === 'string' && typeof x.black === 'string' &&
    typeof x.whiteAccuracy === 'number' && typeof x.blackAccuracy === 'number' &&
    typeof x.result === 'string' && typeof x.savedAt === 'number' &&
    (x.opening === undefined || typeof x.opening === 'string') &&
    (x.date === undefined || typeof x.date === 'string')
  );
}

function readIndex(): HistoryEntry[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(validEntry) : [];
  } catch {
    return [];
  }
}

function writeIndex(items: HistoryEntry[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

export function listHistory(): HistoryEntry[] {
  return readIndex();
}

export function saveReport(report: GameReport): void {
  const entry: HistoryEntry = {
    id: report.id,
    savedAt: Date.now(),
    white: report.white.name,
    black: report.black.name,
    whiteAccuracy: report.white.accuracy,
    blackAccuracy: report.black.accuracy,
    result: report.result,
    date: report.headers.Date ?? report.headers.UTCDate,
    opening: report.opening?.name,
  };
  let items = readIndex().filter((e) => e.id !== report.id);
  items.unshift(entry);
  const dropped = items.slice(MAX_ITEMS);
  items = items.slice(0, MAX_ITEMS);
  dropped.forEach((e) => removeItem(e.id));
  const payload = JSON.stringify(report);
  // A review too big for browser storage at all: skip it rather than evicting others for nothing.
  if (payload.length > 2_000_000) return;
  // If storage is full, drop the oldest reviews until it fits. The index is
  // always rewritten to match what is actually stored.
  let saved = false;
  for (;;) {
    try {
      localStorage.setItem(ITEM_PREFIX + report.id, payload);
      saved = true;
      break;
    } catch {
      if (items.length <= 1) break; // only this review left: it simply doesn't fit
      const oldest = items.pop()!;
      removeItem(oldest.id);
    }
  }
  if (!saved) items = items.filter((e) => e.id !== report.id);
  writeIndex(items);
}

function removeItem(id: string): void {
  try {
    localStorage.removeItem(ITEM_PREFIX + id);
  } catch {
    /* ignore */
  }
}

export function loadReport(id: string): GameReport | null {
  try {
    const raw = localStorage.getItem(ITEM_PREFIX + id);
    if (!raw) return null;
    const r = JSON.parse(raw) as GameReport;
    // Minimal shape check; anything deeper that's broken is caught by the error boundary.
    const ok =
      r && typeof r === 'object' && Array.isArray(r.moves) && Array.isArray(r.positions) && Array.isArray(r.whiteWin) &&
      r.white && r.black && typeof r.white.name === 'string' && typeof r.black.name === 'string' && typeof r.startFen === 'string';
    return ok ? r : null;
  } catch {
    return null;
  }
}

export function deleteReport(id: string): HistoryEntry[] {
  removeItem(id);
  const items = readIndex().filter((e) => e.id !== id);
  writeIndex(items);
  return items;
}
