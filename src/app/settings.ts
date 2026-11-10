import { useCallback, useState } from 'react';

export type BoardTheme = 'green' | 'brown' | 'blue' | 'gray';
export type PieceSet = 'cburnett' | 'merida';

export interface Settings {
  /** Search depth per position for game reviews. */
  depth: number;
  boardTheme: BoardTheme;
  pieceSet: PieceSet;
  sound: boolean;
  showArrows: boolean;
  /** Piece slide duration in ms (0 = off). */
  animationMs: number;
  /** Number of engine workers; 0 = automatic. */
  workers: number;
}

export const ANIMATION_PRESETS = [
  { ms: 0, label: 'Off' },
  { ms: 150, label: 'Fast' },
  { ms: 250, label: 'Normal' },
  { ms: 400, label: 'Slow' },
] as const;

export const DEPTH_PRESETS = [
  { depth: 12, label: 'Fast', note: 'Quick look, a few seconds' },
  { depth: 16, label: 'Standard', note: 'Recommended' },
  { depth: 20, label: 'Deep', note: 'Slower, most precise' },
] as const;

const DEFAULTS: Settings = {
  depth: 16,
  boardTheme: 'green',
  pieceSet: 'cburnett',
  sound: true,
  showArrows: true,
  animationMs: 250,
  workers: 0,
};

const KEY = 'kibitz.settings.v1';

const THEMES: BoardTheme[] = ['green', 'brown', 'blue', 'gray'];
const PIECE_SETS: PieceSet[] = ['cburnett', 'merida'];

/** Stored settings are untrusted: keep only known values, clamp numbers. */
export function sanitizeSettings(input: unknown): Settings {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const pick = <T,>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
  return {
    depth: pick(s.depth, DEPTH_PRESETS.map((p) => p.depth), DEFAULTS.depth),
    boardTheme: pick(s.boardTheme, THEMES, DEFAULTS.boardTheme),
    pieceSet: pick(s.pieceSet, PIECE_SETS, DEFAULTS.pieceSet),
    sound: typeof s.sound === 'boolean' ? s.sound : DEFAULTS.sound,
    showArrows: typeof s.showArrows === 'boolean' ? s.showArrows : DEFAULTS.showArrows,
    animationMs: pick(s.animationMs, ANIMATION_PRESETS.map((p) => p.ms), DEFAULTS.animationMs),
    workers: Number.isInteger(s.workers) && (s.workers as number) >= 0 && (s.workers as number) <= 8 ? (s.workers as number) : DEFAULTS.workers,
  };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitizeSettings(JSON.parse(raw));
  } catch {
    /* storage unavailable or corrupt */
  }
  return DEFAULTS;
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(load);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return [settings, update];
}

export function autoWorkerCount(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  const memory = (typeof navigator !== 'undefined' && (navigator as Navigator & { deviceMemory?: number }).deviceMemory) || 8;
  const cap = memory <= 4 ? 2 : 6;
  return Math.max(1, Math.min(cap, cores - 1));
}
