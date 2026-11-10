import type { Color } from 'chess.js';
import { colorName } from '../chess/core';

/**
 * Who the coach is talking to. When we know which side the reviewer played,
 * their moves are "you" and the other side is "your opponent"; otherwise we
 * use the colour names.
 */
export interface Voice {
  /** subject for the side that just moved: "you" / "White" / "your opponent" */
  me: string;
  /** possessive for the mover: "your" / "White's" / "their" */
  my: string;
  /** subject for the other side */
  them: string;
  /** possessive for the other side */
  their: string;
  /** whether `me` takes a plural verb ("you lose" vs "White loses") */
  mePlural: boolean;
  themPlural: boolean;
}

export function voiceFor(mover: Color, perspective?: Color): Voice {
  const other: Color = mover === 'w' ? 'b' : 'w';
  if (perspective === mover) {
    return { me: 'you', my: 'your', them: 'your opponent', their: "your opponent's", mePlural: true, themPlural: false };
  }
  if (perspective === other) {
    return { me: 'your opponent', my: 'their', them: 'you', their: 'your', mePlural: false, themPlural: true };
  }
  return {
    me: colorName(mover),
    my: `${colorName(mover)}'s`,
    them: colorName(other),
    their: `${colorName(other)}'s`,
    mePlural: false,
    themPlural: false,
  };
}

/** Conjugates a simple verb for a subject: verb('lose', false) => 'loses'. */
export function verb(base: string, plural: boolean): string {
  if (plural) return base;
  if (base === 'have') return 'has';
  if (base === 'are' || base === 'be') return 'is';
  if (/(s|sh|ch|x|z)$/.test(base)) return `${base}es`;
  if (/[^aeiou]y$/.test(base)) return `${base.slice(0, -1)}ies`;
  return `${base}s`;
}

export function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
