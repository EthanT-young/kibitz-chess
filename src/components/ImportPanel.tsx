import { useEffect, useRef, useState } from 'react';
import type { Color } from 'chess.js';
import {
  fetchChessComGames,
  fetchLichessGame,
  fetchLichessGames,
  ImportError,
  isChessComGameUrl,
  lichessGameId,
  type GameListing,
} from '../app/importers';
import { deleteReport, listHistory, type HistoryEntry } from '../app/history';
import { DEPTH_PRESETS } from '../app/settings';
import { IconTrash } from './Icons';
import { SAMPLE_GAMES } from '../app/samples';

type Tab = 'chesscom' | 'lichess' | 'pgn';

interface Props {
  depth: number;
  onDepth: (d: number) => void;
  onStart: (pgn: string, perspective?: Color) => void;
  onOpenHistory: (id: string) => void;
  error?: string | null;
}

const PREFS_KEY = 'kibitz.import.v1';
function loadPrefs(): { tab: Tab; chesscom: string; lichess: string } {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 40) : '');
    const tab: Tab = raw.tab === 'lichess' || raw.tab === 'pgn' ? raw.tab : 'chesscom';
    return { tab, chesscom: str(raw.chesscom), lichess: str(raw.lichess) };
  } catch {
    return { tab: 'chesscom', chesscom: '', lichess: '' };
  }
}
function savePrefs(p: { tab: Tab; chesscom: string; lichess: string }) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function resultFor(g: GameListing): 'win' | 'loss' | 'draw' | 'open' {
  if (g.result === '1/2-1/2') return 'draw';
  if (g.result === '*') return 'open';
  return (g.result === '1-0') === (g.userColor === 'w') ? 'win' : 'loss';
}

function ago(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function GameRow({ g, onPick }: { g: GameListing; onPick: () => void }) {
  const r = resultFor(g);
  const me = g.userColor === 'w' ? g.white : g.black;
  const them = g.userColor === 'w' ? g.black : g.white;
  return (
    <button className="game-row" onClick={onPick}>
      <span className={`result-pill ${r}`}>{r === 'win' ? 'W' : r === 'loss' ? 'L' : r === 'draw' ? '½' : '·'}</span>
      <span className="game-row-main">
        <span className="game-row-players">
          <span className={`dot ${g.userColor === 'w' ? 'dot-w' : 'dot-b'}`} />
          {me.name} <span className="muted">{me.rating ?? ''}</span>
          <span className="vs">vs</span>
          {them.name} <span className="muted">{them.rating ?? ''}</span>
        </span>
        <span className="game-row-sub">
          {g.speed} · {ago(g.endTime)}
        </span>
      </span>
      <span className="game-row-go">Review</span>
    </button>
  );
}

export function ImportPanel({ depth, onDepth, onStart, onOpenHistory, error }: Props) {
  const [prefs, setPrefs] = useState(loadPrefs);
  const [pgn, setPgn] = useState('');
  const [games, setGames] = useState<GameListing[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(listHistory);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  const update = (patch: Partial<typeof prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  };

  const search = async (source: 'chesscom' | 'lichess') => {
    const name = source === 'chesscom' ? prefs.chesscom : prefs.lichess;
    if (!name.trim()) return;
    ctrl.current?.abort();
    ctrl.current = new AbortController();
    setLoading(true);
    setFetchError(null);
    setGames(null);
    try {
      const list = source === 'chesscom' ? await fetchChessComGames(name, ctrl.current.signal) : await fetchLichessGames(name, ctrl.current.signal);
      setGames(list);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setFetchError(e instanceof ImportError ? e.message : 'Something went wrong while fetching games.');
    } finally {
      setLoading(false);
    }
  };

  const submitPgn = async () => {
    const text = pgn.trim();
    if (!text) return;
    setFetchError(null);
    const id = lichessGameId(text);
    if (id) {
      setLoading(true);
      try {
        onStart(await fetchLichessGame(id));
      } catch (e) {
        setFetchError(e instanceof ImportError ? e.message : 'Couldn’t load that Lichess game.');
      } finally {
        setLoading(false);
      }
      return;
    }
    if (isChessComGameUrl(text)) {
      setFetchError('Chess.com links can’t be opened directly. Use the Chess.com tab and search for your username, or copy the PGN from Chess.com (Share → PGN).');
      return;
    }
    onStart(text);
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'chesscom', label: 'Chess.com' },
    { id: 'lichess', label: 'Lichess' },
    { id: 'pgn', label: 'PGN' },
  ];

  return (
    <div className="panel-body import">
      <p className="lede">Pick a game and get the full review: accuracy, best moves, and what went wrong, explained.</p>

      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={prefs.tab === t.id}
            className={prefs.tab === t.id ? 'tab active' : 'tab'}
            onClick={() => {
              update({ tab: t.id });
              setGames(null);
              setFetchError(null);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="depth-row">
        <span className="depth-label">Analysis</span>
        <div className="segmented" role="radiogroup" aria-label="Analysis depth">
          {DEPTH_PRESETS.map((p) => (
            <button key={p.depth} role="radio" aria-checked={depth === p.depth} className={depth === p.depth ? 'seg active' : 'seg'} onClick={() => onDepth(p.depth)} title={`${p.note} (depth ${p.depth})`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {(prefs.tab === 'chesscom' || prefs.tab === 'lichess') && (
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            void search(prefs.tab as 'chesscom' | 'lichess');
          }}
        >
          <label className="sr-only" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            className="input"
            placeholder={prefs.tab === 'chesscom' ? 'Your Chess.com username' : 'Your Lichess username'}
            autoComplete="off"
            spellCheck={false}
            value={prefs.tab === 'chesscom' ? prefs.chesscom : prefs.lichess}
            onChange={(e) => update(prefs.tab === 'chesscom' ? { chesscom: e.target.value } : { lichess: e.target.value })}
          />
          <button className="btn secondary" type="submit" disabled={loading}>
            {loading ? 'Loading…' : 'Find games'}
          </button>
        </form>
      )}

      {prefs.tab === 'pgn' && (
        <div className="pgn-box">
          <label className="sr-only" htmlFor="pgn">
            PGN
          </label>
          <textarea
            id="pgn"
            className="input pgn"
            placeholder={'Paste a PGN, a move list (1. e4 e5 2. Nf3 …) or a Lichess game link'}
            value={pgn}
            spellCheck={false}
            onChange={(e) => setPgn(e.target.value)}
          />
          <div className="row gap">
            <select className="input samples" value="" onChange={(e) => e.target.value && onStart(SAMPLE_GAMES[Number(e.target.value)].pgn)} aria-label="Load a famous game">
              <option value="">Or try a famous game…</option>
              {SAMPLE_GAMES.map((s, i) => (
                <option key={s.name} value={i}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {(fetchError || error) && <div className="error">{fetchError ?? error}</div>}

      {games && prefs.tab !== 'pgn' && (
        <div className="game-list">
          {games.length === 0 && <div className="muted">No recent standard games found.</div>}
          {games.map((g) => (
            <GameRow key={g.id} g={g} onPick={() => onStart(g.pgn, g.userColor)} />
          ))}
        </div>
      )}

      {prefs.tab === 'pgn' && (
        <button className="btn primary big" onClick={() => void submitPgn()} disabled={!pgn.trim() || loading}>
          Review game
        </button>
      )}

      {!games && history.length === 0 && prefs.tab !== 'pgn' && (
        <div className="quickstart">
          <h3>No account handy? Try a famous game</h3>
          <div className="quickstart-list">
            {SAMPLE_GAMES.map((s) => (
              <button key={s.name} className="quick-game" onClick={() => onStart(s.pgn)}>
                <span>{s.name}</span>
                <span>Review</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="history">
          <h3>Recent reviews</h3>
          {history.map((h) => (
            <div className="history-row" key={h.id}>
              <button className="history-open" onClick={() => onOpenHistory(h.id)}>
                <span className="history-players">
                  {h.white} <span className="muted">vs</span> {h.black}
                </span>
                <span className="history-sub">
                  {h.result} · {h.whiteAccuracy.toFixed(1)} / {h.blackAccuracy.toFixed(1)} accuracy{h.opening ? ` · ${h.opening}` : ''}
                </span>
              </button>
              <button className="icon-btn" aria-label="Delete review" title="Delete" onClick={() => setHistory(deleteReport(h.id))}>
                <IconTrash size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="fineprint">
        Stockfish runs inside your browser, so reviews are free and your games stay on your device. Importing only asks Chess.com or Lichess for your public game list.
      </p>
    </div>
  );
}
