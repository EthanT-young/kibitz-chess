import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { annotatedPgn, downloadText } from './app/annotatedPgn';
import { wasmSupported } from './app/engineClient';
import { loadReport, saveReport } from './app/history';
import { judgeMove } from './app/judge';
import { reviewGame, type ReviewProgress } from './app/reviewRunner';
import { autoWorkerCount, useSettings } from './app/settings';
import { playMoveSound, soundForSan } from './app/sound';
import { liveCache, useLiveEngine } from './app/useLiveEngine';
import { AnalyzingPanel } from './components/AnalyzingPanel';
import { Board, type Arrow } from './components/Board';
import { CoachAvatar } from './components/CoachBubble';
import { EvalBar } from './components/EvalBar';
import { IconBulb, IconGear, IconRetry } from './components/Icons';
import { ImportPanel } from './components/ImportPanel';
import { clockAt, PlayerBar } from './components/PlayerBar';
import { ReportPanel } from './components/ReportPanel';
import { ReviewPanel, type CoachAction, type CoachView, type EngineLineRow } from './components/ReviewPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { CLASSIFICATION_LABEL, type GameReport } from './lib/analysis/types';
import { formatScore, scoreToWin, toWhite } from './lib/analysis/winprob';
import { article, colorName, parseUci, sideToMove, START_FEN, uciLineToSan } from './lib/chess/core';
import { parsePgn, PgnError, type ParsedGame } from './lib/chess/pgn';
import { isAbort, terminalState } from './lib/engine/engine';
import type { PositionAnalysis } from './lib/engine/uci';

type Phase = 'home' | 'analyzing' | 'report' | 'review';

interface VarMove {
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
}

interface Variation {
  /** Mainline position index (0 = start) the variation branches from. */
  basePly: number;
  moves: VarMove[];
  /** How many variation moves are applied on the board (0 = base position). */
  index: number;
  source: 'user' | 'engine';
}

const GOOD_ENOUGH = new Set(['brilliant', 'great', 'best', 'excellent']);
const BAD = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);

function varMovesFromUci(fen: string, ucis: string[]): VarMove[] {
  const chess = new Chess(fen);
  const out: VarMove[] = [];
  for (const uci of ucis) {
    const before = chess.fen();
    try {
      const m = chess.move(parseUci(uci));
      out.push({ san: m.san, uci, fenBefore: before, fenAfter: chess.fen() });
    } catch {
      break;
    }
  }
  return out;
}

function moveLabel(fen: string, san: string): string {
  const [, side, , , , no] = fen.split(' ');
  return `${no}${side === 'w' ? '.' : '...'} ${san}`;
}

export default function App() {
  const [settings, updateSettings] = useSettings();
  const [phase, setPhase] = useState<Phase>('home');
  const [game, setGame] = useState<ParsedGame | null>(null);
  const [report, setReport] = useState<GameReport | null>(null);
  const [progress, setProgress] = useState<ReviewProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ply, setPly] = useState(0);
  const [orientation, setOrientation] = useState<Color>('w');
  const [variation, setVariation] = useState<Variation | null>(null);
  const [retry, setRetry] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const workers = settings.workers || autoWorkerCount();

  // ---------- starting a review ----------
  const start = useCallback(
    async (pgn: string, perspective?: Color) => {
      setError(null);
      let parsed: ParsedGame;
      try {
        parsed = parsePgn(pgn);
      } catch (e) {
        setError(e instanceof PgnError ? e.message : 'That PGN couldn’t be read.');
        return;
      }
      if (!wasmSupported()) {
        setError('This browser can’t run the engine (WebAssembly and Web Workers are required).');
        return;
      }
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setGame(parsed);
      setReport(null);
      setProgress(null);
      setVariation(null);
      setRetry(null);
      setPly(0);
      setOrientation(perspective ?? 'w');
      setPhase('analyzing');
      try {
        const r = await reviewGame(parsed, {
          depth: settings.depth,
          workers,
          perspective,
          signal: ctrl.signal,
          onProgress: setProgress,
        });
        if (ctrl.signal.aborted) return;
        setReport(r);
        setPhase('report');
        saveReport(r);
      } catch (e) {
        if (isAbort(e) || ctrl.signal.aborted) return;
        console.error(e);
        setError('The engine stopped unexpectedly. Try again, or pick a lower analysis depth in Settings.');
        setPhase('home');
      }
    },
    [settings.depth, workers],
  );

  const cancel = () => {
    abortRef.current?.abort();
    setPhase('home');
  };

  const goHome = () => {
    abortRef.current?.abort();
    setVariation(null);
    setRetry(null);
    setPhase('home');
  };

  const openHistory = (id: string) => {
    const r = loadReport(id);
    if (!r) {
      setError('That review is no longer stored in this browser.');
      return;
    }
    setReport(r);
    setGame(null);
    setPly(0);
    setVariation(null);
    setRetry(null);
    setOrientation(r.perspective ?? 'w');
    setPhase('report');
  };

  // ---------- what's on the board ----------
  const total = report?.moves.length ?? 0;
  const mainFen = (p: number): string => {
    if (report) return p === 0 ? report.startFen : report.moves[p - 1].fenAfter;
    if (game) return p === 0 ? game.startFen : game.moves[p - 1].fenAfter;
    return START_FEN;
  };

  const display = useMemo(() => {
    if (variation && report) {
      if (variation.index === 0) {
        const fen = mainFen(variation.basePly);
        const m = variation.basePly > 0 ? report.moves[variation.basePly - 1] : null;
        return { fen, last: m ? parseUci(m.uci) : null, inVariation: true };
      }
      const vm = variation.moves[variation.index - 1];
      return { fen: vm.fenAfter, last: parseUci(vm.uci), inVariation: true };
    }
    const fen = mainFen(ply);
    const m = report && ply > 0 ? report.moves[ply - 1] : null;
    return { fen, last: m ? parseUci(m.uci) : null, inVariation: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variation, report, game, ply]);

  const exploring = (phase === 'review' || phase === 'report') && !!variation;
  const live = useLiveEngine(exploring ? display.fen : null, { depth: 20, multiPv: 3 });

  // Mainline engine results, by FEN.
  const mainAnalyses = useMemo(() => {
    const map = new Map<string, PositionAnalysis>();
    report?.positions.forEach((p) => map.set(p.fen, p));
    return map;
  }, [report]);

  const analysisFor = useCallback(
    (fen: string): PositionAnalysis | null => {
      const main = mainAnalyses.get(fen);
      if (main) return main;
      const terminal = terminalState(fen);
      if (terminal) return { fen, depth: 0, lines: [], terminal };
      if (live && live.fen === fen && live.depth >= 14 && live.lines.length) return { fen, depth: live.depth, lines: live.lines };
      const cached = liveCache.get(fen);
      if (cached && cached.depth >= 14) return cached;
      return null;
    },
    [mainAnalyses, live],
  );

  // ---------- navigation ----------
  const goto = useCallback(
    (p: number) => {
      setVariation(null);
      setRetry(null);
      setPly(Math.max(0, Math.min(total, p)));
      if (phase === 'report') setPhase('review');
    },
    [total, phase],
  );

  const nav = useCallback(
    (dir: 'first' | 'prev' | 'next' | 'last') => {
      if (variation) {
        const max = variation.moves.length;
        const idx = dir === 'first' ? 0 : dir === 'last' ? max : dir === 'prev' ? variation.index - 1 : variation.index + 1;
        if (idx < 0) {
          setVariation(null);
          return;
        }
        setVariation({ ...variation, index: Math.min(max, idx) });
        return;
      }
      if (retry !== null) setRetry(null);
      const p = dir === 'first' ? 0 : dir === 'last' ? total : dir === 'prev' ? ply - 1 : ply + 1;
      setPly(Math.max(0, Math.min(total, p)));
      if (phase === 'report') setPhase('review');
    },
    [variation, retry, total, ply, phase],
  );

  useEffect(() => {
    if (phase !== 'review' && phase !== 'report') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.key === 'ArrowRight') nav('next');
      else if (e.key === 'ArrowLeft') nav('prev');
      else if (e.key === 'Home' || e.key === 'ArrowUp') nav('first');
      else if (e.key === 'End' || e.key === 'ArrowDown') nav('last');
      else if (e.key === 'Escape' && variation) setVariation(null);
      else if (e.key.toLowerCase() === 'f') setOrientation((o) => (o === 'w' ? 'b' : 'w'));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, nav, variation]);

  // Move sounds when stepping forward.
  const lastSound = useRef<string>('');
  useEffect(() => {
    if (!settings.sound || !report) return;
    const key = `${display.fen}`;
    if (key === lastSound.current) return;
    const prev = lastSound.current;
    lastSound.current = key;
    if (!prev) return;
    let san: string | undefined;
    if (variation && variation.index > 0) san = variation.moves[variation.index - 1].san;
    else if (!variation && ply > 0 && report.moves[ply - 1].fenBefore === prev) san = report.moves[ply - 1].san;
    if (san) playMoveSound(soundForSan(san));
  }, [display.fen, settings.sound, report, variation, ply]);

  // ---------- moves made on the board ----------
  const onBoardMove = (m: { from: Square; to: Square; promotion?: PieceSymbol }) => {
    if (!report) return;
    const chess = new Chess(display.fen);
    let mv;
    try {
      mv = chess.move(m);
    } catch {
      return;
    }
    const uci = m.from + m.to + (mv.promotion ?? '');
    if (!variation && retry === null && ply < total && report.moves[ply].uci === uci) {
      setPly(ply + 1);
      if (phase === 'report') setPhase('review');
      return;
    }
    const vm: VarMove = { san: mv.san, uci, fenBefore: display.fen, fenAfter: chess.fen() };
    if (variation) {
      const nextExisting = variation.moves[variation.index];
      if (nextExisting && nextExisting.uci === uci) {
        setVariation({ ...variation, index: variation.index + 1 });
        return;
      }
      setVariation({ ...variation, moves: [...variation.moves.slice(0, variation.index), vm], index: variation.index + 1, source: 'user' });
    } else {
      setVariation({ basePly: ply, moves: [vm], index: 1, source: 'user' });
    }
    if (phase === 'report') setPhase('review');
  };

  // ---------- coach ----------
  const nextKeyMoment = (from: number) => report?.keyMoments.find((k) => k > from);

  const coach: CoachView | null = useMemo(() => {
    if (!report) return null;
    const persp = report.perspective;
    // Retry: find a better move than the one played at `retry`.
    if (retry !== null) {
      const m = report.moves[retry - 1];
      const who = persp ? (m.color === persp ? 'You' : 'Your opponent') : colorName(m.color);
      if (!variation || variation.index === 0) {
        return {
          title: 'Find a better move',
          body: [`${who} played ${m.san} here, ${article(CLASSIFICATION_LABEL[m.classification])} ${CLASSIFICATION_LABEL[m.classification].toLowerCase()}. ${colorName(m.color)} to move: what's stronger?`],
          actions: [
            { id: 'solution', label: 'Show solution', icon: <IconBulb size={16} /> },
            { id: 'exit-retry', label: 'Back to review' },
          ],
        };
      }
      const tried = variation.moves[0];
      const j = judgeMove(tried.fenBefore, tried.uci, analysisFor(tried.fenBefore), analysisFor(tried.fenAfter), persp);
      if (!j) return { title: `Checking ${tried.san}…`, body: ['The engine is looking at your move.'], actions: [] };
      const good = GOOD_ENOUGH.has(j.classified.classification);
      return {
        classification: j.classified.classification,
        title: good ? `Correct! ${j.coach.title}` : j.coach.title,
        body: j.coach.body,
        actions: good
          ? [
              ...(nextKeyMoment(retry) ? [{ id: 'next-key', label: 'Next key moment', kind: 'primary' as const }] : []),
              { id: 'exit-retry', label: 'Back to review' },
            ]
          : [
              { id: 'try-again', label: 'Try again', kind: 'primary' as const, icon: <IconRetry size={16} /> },
              { id: 'solution', label: 'Show solution', icon: <IconBulb size={16} /> },
            ],
      };
    }
    if (variation) {
      if (variation.source === 'engine') {
        const first = variation.moves[0];
        return {
          title: `Best line: ${first ? moveLabel(first.fenBefore, first.san) : ''}`,
          body: ['This is how the engine would continue. Step through it with the arrows.'],
          actions: [{ id: 'exit-var', label: 'Back to the game', kind: 'primary' }],
        };
      }
      if (variation.index === 0) {
        return { title: 'Your own line', body: ['Make a move on the board to explore, or go back to the game.'], actions: [{ id: 'exit-var', label: 'Back to the game', kind: 'primary' }] };
      }
      const vm = variation.moves[variation.index - 1];
      const j = judgeMove(vm.fenBefore, vm.uci, analysisFor(vm.fenBefore), analysisFor(vm.fenAfter), persp);
      if (!j) {
        return {
          title: `${moveLabel(vm.fenBefore, vm.san)}`,
          body: ['The engine is evaluating this position…'],
          actions: [{ id: 'exit-var', label: 'Back to the game', kind: 'primary' }],
        };
      }
      return {
        classification: j.classified.classification,
        title: j.coach.title,
        body: j.coach.body,
        actions: [{ id: 'exit-var', label: 'Back to the game', kind: 'primary' }],
      };
    }
    if (ply === 0) {
      return {
        title: 'Let’s go through the game',
        body: ['Every move gets a verdict. Step forward with → or the play button; mistakes come with the better move and the reason.'],
        actions: [
          { id: 'next', label: 'Start', kind: 'primary' },
          ...(report.keyMoments.length ? [{ id: 'next-key', label: 'Jump to key moment' }] : []),
        ],
      };
    }
    const m = report.moves[ply - 1];
    const actions: CoachAction[] = [];
    if (m.best && m.best.uci !== m.uci && !['book', 'forced', 'best', 'brilliant', 'great'].includes(m.classification)) {
      actions.push({ id: 'best', label: 'Best move', icon: <IconBulb size={16} /> });
    }
    if (BAD.has(m.classification)) actions.push({ id: 'retry', label: 'Retry', icon: <IconRetry size={16} /> });
    if (ply < total) actions.push({ id: 'next', label: 'Next', kind: 'primary' });
    return {
      classification: m.classification,
      title: m.coach.title,
      evalText: formatScore(m.evalAfter),
      body: m.coach.body,
      actions,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, retry, variation, ply, analysisFor]);

  const onCoachAction = (id: string) => {
    if (!report) return;
    switch (id) {
      case 'next':
        nav('next');
        break;
      case 'next-key': {
        const k = nextKeyMoment(retry ?? ply);
        if (k) goto(k);
        break;
      }
      case 'best': {
        const m = report.moves[ply - 1];
        const line = report.positions[ply - 1]?.lines[0]?.pv ?? (m.best ? [m.best.uci] : []);
        setVariation({ basePly: ply - 1, moves: varMovesFromUci(m.fenBefore, line.slice(0, 10)), index: 1, source: 'engine' });
        break;
      }
      case 'retry':
        setRetry(ply);
        setPly(ply - 1);
        setVariation(null);
        break;
      case 'try-again':
        setVariation(null);
        break;
      case 'solution': {
        if (retry === null) break;
        const m = report.moves[retry - 1];
        const line = report.positions[retry - 1]?.lines[0]?.pv ?? [];
        setRetry(null);
        setPly(retry - 1);
        setVariation({ basePly: retry - 1, moves: varMovesFromUci(m.fenBefore, line.slice(0, 10)), index: 1, source: 'engine' });
        break;
      }
      case 'exit-retry': {
        const back = retry;
        setRetry(null);
        setVariation(null);
        if (back) setPly(back);
        break;
      }
      case 'exit-var':
        setVariation(null);
        break;
    }
  };

  // ---------- board decorations ----------
  const arrows: Arrow[] = useMemo(() => {
    if (!report || !settings.showArrows) return [];
    if (variation || retry !== null) return [];
    if (ply === 0) return [];
    const m = report.moves[ply - 1];
    const out: Arrow[] = [];
    if (m.best && m.best.uci !== m.uci && !['book', 'forced', 'best', 'brilliant', 'great'].includes(m.classification)) {
      const b = parseUci(m.best.uci);
      out.push({ from: b.from, to: b.to, color: 'var(--arrow-best)' });
    }
    if ((m.classification === 'mistake' || m.classification === 'blunder') && m.replyLineUci[0]) {
      const r = parseUci(m.replyLineUci[0]);
      out.push({ from: r.from, to: r.to, color: 'var(--arrow-threat)' });
    }
    return out;
  }, [report, ply, variation, retry, settings.showArrows]);

  const badge = useMemo(() => {
    if (!report) return null;
    if (variation) {
      if (variation.index === 0 || variation.source === 'engine') return null;
      const vm = variation.moves[variation.index - 1];
      const j = coach?.classification;
      return j ? { square: parseUci(vm.uci).to, classification: j } : null;
    }
    if (retry !== null || ply === 0) return null;
    const m = report.moves[ply - 1];
    return { square: parseUci(m.uci).to, classification: m.classification };
  }, [report, variation, retry, ply, coach]);

  // ---------- eval bar ----------
  const evalState = useMemo(() => {
    if (!report) return { whiteWin: 0.5, score: null, result: null as string | null };
    if (display.inVariation) {
      const stm = sideToMove(display.fen);
      const t = terminalState(display.fen);
      if (t === 'checkmate') return { whiteWin: stm === 'w' ? 0 : 1, score: null, result: stm === 'w' ? '0-1' : '1-0' };
      if (t) return { whiteWin: 0.5, score: null, result: '1/2-1/2' };
      const a = live && live.fen === display.fen && live.lines.length ? live.lines[0] : analysisFor(display.fen)?.lines[0];
      if (a) {
        const s = toWhite(a.score, stm);
        return { whiteWin: scoreToWin(s), score: s, result: null };
      }
      return { whiteWin: 0.5, score: null, result: null };
    }
    const final = ply === total && report.evals[ply]?.kind === 'mate' && report.evals[ply].value === 0;
    return { whiteWin: report.whiteWin[ply], score: report.evals[ply], result: final ? report.result : null };
  }, [report, display, live, ply, total, analysisFor]);

  // Live engine lines while exploring.
  const engineLines: EngineLineRow[] | null = useMemo(() => {
    if (!exploring || !live || live.fen !== display.fen) return exploring ? [] : null;
    const stm = sideToMove(live.fen);
    return live.lines.slice(0, 3).map((l, i) => {
      const s = toWhite(l.score, stm);
      const sans = uciLineToSan(live.fen, l.pv, 8);
      const [, side, , , , no] = live.fen.split(' ');
      let n = Number(no);
      const parts: string[] = [];
      sans.forEach((san, k) => {
        const white = (side === 'w') === (k % 2 === 0);
        if (white) parts.push(`${n}. ${san}`);
        else parts.push(k === 0 ? `${n}... ${san}` : san);
        if (!white) n++;
      });
      return { key: `${i}-${l.pv[0]}`, evalText: formatScore(s), positive: scoreToWin(s) >= 0.5, moves: parts.join(' ') };
    });
  }, [exploring, live, display.fen]);

  const variationText = variation && variation.moves.length > 0 && (
    <>
      <span className="var-label">{variation.source === 'engine' ? 'Engine line' : 'Exploring'}</span>
      {variation.moves.map((vm, i) => (
        <button key={i} className={`var-move${i + 1 === variation.index ? ' current' : ''}`} onClick={() => setVariation({ ...variation, index: i + 1 })}>
          {i === 0 || sideToMove(vm.fenBefore) === 'w' ? moveLabel(vm.fenBefore, vm.san) : vm.san}
        </button>
      ))}
    </>
  );

  // ---------- players ----------
  const headers = report?.headers ?? game?.headers ?? {};
  const nameOf = (c: Color) => {
    const n = c === 'w' ? headers.White : headers.Black;
    return n && n !== '?' ? n : c === 'w' ? 'White' : 'Black';
  };
  const ratingOf = (c: Color) => {
    const r = c === 'w' ? headers.WhiteElo : headers.BlackElo;
    return r && r !== '?' ? r : undefined;
  };
  const movesForClock = report?.moves ?? game?.moves ?? [];
  const clockPly = variation ? variation.basePly : ply;
  const top: Color = orientation === 'w' ? 'b' : 'w';
  const bottom: Color = orientation;
  const toMove = sideToMove(display.fen);
  const perspective = report?.perspective;

  const boardInteractive = (phase === 'review' || phase === 'report') && !!report;

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={goHome} aria-label="Kibitz home">
          <CoachAvatar pieceSet={settings.pieceSet} />
          <span className="brand-name">Kibitz</span>
          <span className="brand-tag">free game review</span>
        </button>
        <div className="topbar-actions">
          {phase !== 'home' && (
            <button className="btn secondary small" onClick={goHome}>
              New review
            </button>
          )}
          <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Settings" title="Settings">
            <IconGear />
          </button>
        </div>
      </header>

      <main className="main">
        <section className="board-col" aria-label="Board">
          <PlayerBar
            name={nameOf(top)}
            rating={ratingOf(top)}
            color={top}
            fen={display.fen}
            clock={clockAt(movesForClock, clockPly, top)}
            active={toMove === top}
            pieceSet={settings.pieceSet}
            tag={perspective === top ? 'you' : undefined}
          />
          <div className="board-row">
            <EvalBar whiteWin={evalState.whiteWin} score={evalState.score} orientation={orientation} result={evalState.result} />
            <Board
              fen={display.fen}
              orientation={orientation}
              lastMove={display.last}
              badge={badge}
              arrows={arrows}
              interactive={boardInteractive}
              onMove={onBoardMove}
              pieceSet={settings.pieceSet}
              theme={settings.boardTheme}
              animationMs={settings.animationMs}
            />
          </div>
          <PlayerBar
            name={nameOf(bottom)}
            rating={ratingOf(bottom)}
            color={bottom}
            fen={display.fen}
            clock={clockAt(movesForClock, clockPly, bottom)}
            active={toMove === bottom}
            pieceSet={settings.pieceSet}
            tag={perspective === bottom ? 'you' : undefined}
          />
        </section>

        <aside className="panel" aria-label="Game review">
          <div className="panel-head">
            <h1>{phase === 'home' ? 'Game Review' : phase === 'analyzing' ? 'Analyzing' : phase === 'report' ? 'Game Review' : 'Review'}</h1>
          </div>
          {phase === 'home' && (
            <ImportPanel depth={settings.depth} onDepth={(d) => updateSettings({ depth: d })} onStart={(p, persp) => void start(p, persp)} onOpenHistory={openHistory} error={error} />
          )}
          {phase === 'analyzing' && <AnalyzingPanel progress={progress} pieceSet={settings.pieceSet} depth={settings.depth} workers={Math.min(workers, (game?.moves.length ?? 0) + 1)} onCancel={cancel} />}
          {phase === 'report' && report && (
            <ReportPanel
              report={report}
              pieceSet={settings.pieceSet}
              onStart={() => {
                setPhase('review');
                setPly(0);
              }}
              onJump={goto}
              onDownload={() => downloadText(`${report.white.name}-vs-${report.black.name}-review.pgn`.replace(/[^\w.-]+/g, '_'), annotatedPgn(report))}
            />
          )}
          {phase === 'review' && report && coach && (
            <ReviewPanel
              report={report}
              ply={variation ? variation.basePly : ply}
              pieceSet={settings.pieceSet}
              coach={coach}
              onAction={onCoachAction}
              onSelect={goto}
              onNav={nav}
              onFlip={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))}
              onSummary={() => {
                setVariation(null);
                setRetry(null);
                setPhase('report');
              }}
              variationText={variationText}
              engineLines={engineLines}
              engineDepth={live?.depth ?? null}
            />
          )}
        </aside>
      </main>

      {showSettings && <SettingsDialog settings={settings} onChange={updateSettings} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
