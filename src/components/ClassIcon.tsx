import type { Classification } from '../lib/analysis/types';
import { CLASSIFICATION_LABEL } from '../lib/analysis/types';

export const CLASS_COLOR: Record<Classification, string> = {
  brilliant: 'var(--c-brilliant)',
  great: 'var(--c-great)',
  best: 'var(--c-best)',
  excellent: 'var(--c-excellent)',
  good: 'var(--c-good)',
  book: 'var(--c-book)',
  inaccuracy: 'var(--c-inaccuracy)',
  mistake: 'var(--c-mistake)',
  miss: 'var(--c-miss)',
  blunder: 'var(--c-blunder)',
  forced: 'var(--c-forced)',
};

function star(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (-90 + i * 36) * (Math.PI / 180);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

const TEXT_GLYPH: Partial<Record<Classification, string>> = {
  brilliant: '!!',
  great: '!',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
};

function Glyph({ c }: { c: Classification }) {
  const text = TEXT_GLYPH[c];
  if (text) {
    return (
      <text
        x="10"
        y="10.6"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontFamily="Barlow, system-ui, sans-serif"
        fontWeight="800"
        fontSize={text.length > 1 ? 10.5 : 12.5}
        letterSpacing={text.length > 1 ? -0.6 : 0}
      >
        {text}
      </text>
    );
  }
  switch (c) {
    case 'best':
      return <polygon points={star(10, 10.4, 6.4, 2.7)} fill="#fff" />;
    case 'excellent':
      return (
        <path
          fill="#fff"
          d="M5.6 9.2h2.3v6.2H5.6zM8.8 15.4h4.9c.7 0 1.2-.4 1.4-1.1l1.1-3.8c.2-.8-.4-1.6-1.2-1.6h-2.6l.5-2.5c.1-.7-.3-1.3-1-1.4h-.3L8.8 9z"
        />
      );
    case 'good':
      return <path d="M5.4 10.4l3.1 3.1 6.2-6.6" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />;
    case 'book':
      return (
        <g>
          <path fill="#fff" d="M4.3 6.4c2.1-.6 4-.4 5.7.9 1.7-1.3 3.6-1.5 5.7-.9v8c-2.1-.5-4-.3-5.7 1-1.7-1.3-3.6-1.5-5.7-1z" />
          <path d="M10 7.4v7.9" stroke="var(--c-book)" strokeWidth="1" />
        </g>
      );
    case 'miss':
      return <path d="M6.6 6.6l6.8 6.8M13.4 6.6l-6.8 6.8" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />;
    case 'forced':
      return (
        <path d="M5 10h9M10.6 6.4l3.6 3.6-3.6 3.6" stroke="#fff" strokeWidth="2.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      );
    default:
      return null;
  }
}

export function ClassIcon({ c, size = 20, title }: { c: Classification; size?: number; title?: boolean }) {
  return (
    <svg
      className="class-icon"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      role="img"
      aria-label={CLASSIFICATION_LABEL[c]}
    >
      {title && <title>{CLASSIFICATION_LABEL[c]}</title>}
      <circle cx="10" cy="10" r="10" fill={CLASS_COLOR[c]} />
      <circle cx="10" cy="10" r="9.3" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="1.4" />
      <Glyph c={c} />
    </svg>
  );
}
