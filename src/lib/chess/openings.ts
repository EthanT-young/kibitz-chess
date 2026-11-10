import { epd } from './core';
import { positionKey } from './hash';

export interface Opening {
  eco: string;
  name: string;
}

export interface OpeningBook {
  /** Is this position known opening theory? */
  isBook(fen: string): boolean;
  /** The opening name if this exact position is a named line. */
  nameOf(fen: string): Opening | null;
}

interface BookData {
  names: string[];
  pos: Record<string, number>;
}

let cached: Promise<OpeningBook> | null = null;

export function bookFromData(data: BookData): OpeningBook {
  const lookup = (fen: string) => data.pos[positionKey(epd(fen))];
  return {
    isBook: (fen) => lookup(fen) !== undefined,
    nameOf: (fen) => {
      const idx = lookup(fen);
      if (idx === undefined || idx < 0) return null;
      const [eco, name] = data.names[idx].split('|');
      return { eco, name };
    },
  };
}

/** Loads the opening book on first use (it's ~100 KB gzipped, so it's split out). */
export function loadOpeningBook(): Promise<OpeningBook> {
  if (!cached) {
    cached = import('../../data/openings.json').then((m) => bookFromData((m.default ?? m) as BookData));
  }
  return cached;
}
