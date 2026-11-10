import { useEffect, useRef } from 'react';
import { ANIMATION_PRESETS, autoWorkerCount, DEPTH_PRESETS, type BoardTheme, type PieceSet, type Settings } from '../app/settings';
import { pieceUrl } from './Board';
import { IconClose } from './Icons';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}

const THEMES: { id: BoardTheme; label: string; light: string; dark: string }[] = [
  { id: 'green', label: 'Green', light: '#eeeed2', dark: '#769656' },
  { id: 'brown', label: 'Wood', light: '#f0d9b5', dark: '#b58863' },
  { id: 'blue', label: 'Blue', light: '#dee3e6', dark: '#8ca2ad' },
  { id: 'gray', label: 'Slate', light: '#c9cbc5', dark: '#7c827a' },
];

const PIECES: { id: PieceSet; label: string }[] = [
  { id: 'cburnett', label: 'Classic' },
  { id: 'merida', label: 'Merida' },
];

export function SettingsDialog({ settings, onChange, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    const close = () => onClose();
    d?.addEventListener('close', close);
    return () => d?.removeEventListener('close', close);
  }, [onClose]);

  const auto = autoWorkerCount();
  return (
    <dialog ref={ref} className="settings" onClick={(e) => e.target === ref.current && ref.current?.close()}>
      <div className="settings-inner">
        <header>
          <h2>Settings</h2>
          <button className="icon-btn" onClick={() => ref.current?.close()} aria-label="Close settings">
            <IconClose />
          </button>
        </header>

        <section>
          <h3>Analysis depth</h3>
          <div className="segmented" role="radiogroup">
            {DEPTH_PRESETS.map((p) => (
              <button key={p.depth} role="radio" aria-checked={settings.depth === p.depth} className={settings.depth === p.depth ? 'seg active' : 'seg'} onClick={() => onChange({ depth: p.depth })}>
                {p.label}
                <small>depth {p.depth}</small>
              </button>
            ))}
          </div>
          <p className="hint-text">Deeper searches find more but take longer. Standard is a good balance on most computers.</p>
        </section>

        <section>
          <h3>Engines running in parallel</h3>
          <select className="input" value={settings.workers} onChange={(e) => onChange({ workers: Number(e.target.value) })}>
            <option value={0}>Automatic ({auto})</option>
            {[1, 2, 3, 4, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <p className="hint-text">Each engine uses one CPU core. Fewer engines are gentler on phones and laptops on battery.</p>
        </section>

        <section>
          <h3>Board</h3>
          <div className="swatches">
            {THEMES.map((t) => (
              <button key={t.id} className={`swatch${settings.boardTheme === t.id ? ' active' : ''}`} onClick={() => onChange({ boardTheme: t.id })} aria-label={t.label} title={t.label}>
                <span style={{ background: t.light }} />
                <span style={{ background: t.dark }} />
                <span style={{ background: t.dark }} />
                <span style={{ background: t.light }} />
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>Pieces</h3>
          <div className="swatches">
            {PIECES.map((p) => (
              <button key={p.id} className={`piece-choice${settings.pieceSet === p.id ? ' active' : ''}`} onClick={() => onChange({ pieceSet: p.id })} aria-label={p.label} title={p.label}>
                <span style={{ backgroundImage: `url(${pieceUrl(p.id, 'w', 'n')})` }} />
                <span style={{ backgroundImage: `url(${pieceUrl(p.id, 'b', 'q')})` }} />
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>Animation speed</h3>
          <div className="segmented" role="radiogroup" aria-label="Animation speed">
            {ANIMATION_PRESETS.map((p) => (
              <button key={p.ms} role="radio" aria-checked={settings.animationMs === p.ms} className={settings.animationMs === p.ms ? 'seg active' : 'seg'} onClick={() => onChange({ animationMs: p.ms })}>
                {p.label}
              </button>
            ))}
          </div>
        </section>

        <section className="toggles">
          <label className="toggle">
            <input type="checkbox" checked={settings.sound} onChange={(e) => onChange({ sound: e.target.checked })} />
            <span>Move sounds</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={settings.showArrows} onChange={(e) => onChange({ showArrows: e.target.checked })} />
            <span>Show best-move and threat arrows</span>
          </label>
        </section>

        <section className="about">
          <h3>About</h3>
          <p>
            Analysis by <a href="https://stockfishchess.org" target="_blank" rel="noreferrer">Stockfish 19</a> (GPLv3), compiled to WebAssembly by
            {' '}<a href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noreferrer">stockfish.js</a>. Opening names from the
            {' '}<a href="https://github.com/lichess-org/chess-openings" target="_blank" rel="noreferrer">Lichess openings dataset</a> (CC0). Pieces by Colin M.L. Burnett and Armando Hernández Marroquín (GPLv2+). Accuracy is calibrated against games reviewed on Chess.com.
          </p>
        </section>
      </div>
    </dialog>
  );
}
