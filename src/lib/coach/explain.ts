/**
 * The coach: turns engine numbers into plain-English explanations.
 *
 * The engine already knows *what* is best. This module works out *why*, by
 * replaying the engine's lines and running small tactical detectors (hanging
 * pieces, forks, pins, mate threats, material swings), then phrasing the most
 * important finding the way a human coach would.
 */
import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import { PIECE_NAME, PIECE_VALUE, materialBalance, opposite, playUci, withArticle } from '../chess/core';
import {
  attacksFrom,
  forkFrom,
  hangingPieces,
  isPassedPawn,
  kingSquare,
  mateThreat,
  pinsFrom,
  seeOfCapture,
  type ForkInfo,
  type PinInfo,
} from '../chess/tactics';
import type { Opening } from '../chess/openings';
import type { Classified } from '../analysis/classify';
import { lineOutcome } from '../analysis/lines';
import type { Classification, CoachComment, Phase } from '../analysis/types';
import { scoreToPawns, scoreToWin } from '../analysis/winprob';
import type { PositionAnalysis } from '../engine/uci';
import { cap, verb, voiceFor, type Voice } from './voice';

export interface ExplainInput {
  move: Move;
  fenBefore: string;
  fenAfter: string;
  prevMove?: Move;
  prevClassification?: Classification;
  classified: Classified;
  before: PositionAnalysis;
  after: PositionAnalysis;
  /** Opening name if this exact position is a named line. */
  opening?: Opening | null;
  /** The opening the game is in so far. */
  currentOpening?: Opening | null;
  phase: Phase;
  moveNumber: number;
  /** The side the reviewer played, if known. */
  perspective?: Color;
  /** What actually happened next (used to explain sacrifices). */
  next?: { move: Move; after: PositionAnalysis };
}

const name = (t: PieceSymbol) => PIECE_NAME[t];
const targetName = (t: PieceSymbol) => (t === 'k' ? 'king' : name(t));

function balanceFor(fen: string, color: Color): number {
  return materialBalance(new Chess(fen)) * (color === 'w' ? 1 : -1);
}

/** "a knight", "a pawn", "two pawns", "a queen for a rook", "the exchange" */
export function describeMaterial(lost: PieceSymbol[], won: PieceSymbol[], net: number): string {
  const sortDesc = (xs: PieceSymbol[]) => [...xs].sort((a, b) => PIECE_VALUE[b] - PIECE_VALUE[a]);
  const L = sortDesc(lost.filter((p) => p !== 'k'));
  const W = sortDesc(won.filter((p) => p !== 'k'));
  const lostMain = L[0];
  const wonMain = W[0];
  const loss = Math.round(-net);
  if (lostMain && PIECE_VALUE[lostMain] >= 3) {
    if (wonMain && PIECE_VALUE[wonMain] >= 3 && PIECE_VALUE[wonMain] < PIECE_VALUE[lostMain]) {
      if (lostMain === 'r' && (wonMain === 'n' || wonMain === 'b')) return 'the exchange';
      return `a ${name(lostMain)} for a ${name(wonMain)}`;
    }
    if (loss >= PIECE_VALUE[lostMain] - 1 || !wonMain) return withArticle(name(lostMain));
  }
  if (loss <= 1) return 'a pawn';
  if (loss === 2) return 'two pawns';
  if (loss >= 9) return 'a lot of material';
  if (loss >= 5) return 'material worth a rook';
  return 'material worth a minor piece';
}

type CaptureKind = 'free' | 'winning' | 'trade' | 'recapture' | 'losing';

export interface Facts {
  isMate: boolean;
  givesCheck: boolean;
  discoveredCheck: boolean;
  inCheckBefore: boolean;
  castle: boolean;
  promotion: PieceSymbol | null;
  capture: { piece: PieceSymbol; square: Square; kind: CaptureKind; regains: boolean; sameAsPrev: boolean } | null;
  fork: ForkInfo | null;
  pin: PinInfo | null;
  mateThreat: string | null;
  threats: { square: Square; type: PieceSymbol }[];
  escapes: boolean;
  defends: { square: Square; type: PieceSymbol } | null;
  develops: boolean;
  centerPawn: boolean;
  passedPawn: boolean;
  rookOpenFile: boolean;
  kingActivity: boolean;
}

/** What does this move *do*? Used for good moves and for describing better alternatives. */
export function moveFacts(
  fenBefore: string,
  move: Move,
  opts: { prevMove?: Move; phase?: Phase; moveNumber?: number } = {},
): Facts {
  const mover = move.color;
  const enemy = opposite(mover);
  const before = new Chess(fenBefore);
  const after = new Chess(fenBefore);
  after.move(move);
  const fenAfter = after.fen();
  const facts: Facts = {
    isMate: after.isCheckmate(),
    givesCheck: after.inCheck(),
    discoveredCheck: false,
    inCheckBefore: before.inCheck(),
    castle: move.isKingsideCastle() || move.isQueensideCastle(),
    promotion: move.promotion ?? null,
    capture: null,
    fork: null,
    pin: null,
    mateThreat: null,
    threats: [],
    escapes: false,
    defends: null,
    develops: false,
    centerPawn: false,
    passedPawn: false,
    rookOpenFile: false,
    kingActivity: false,
  };
  if (facts.isMate) return facts;

  if (facts.givesCheck) {
    const ks = kingSquare(after, enemy);
    if (ks && !attacksFrom(after.board(), move.to).includes(ks)) facts.discoveredCheck = true;
  }

  if (move.captured) {
    const val = seeOfCapture(before, move);
    const capVal = PIECE_VALUE[move.captured];
    const recapture = !!(opts.prevMove?.captured && opts.prevMove.to === move.to);
    let kind: CaptureKind;
    if (recapture) kind = 'recapture';
    else if (val >= capVal) kind = 'free';
    else if (val > 0) kind = 'winning';
    else if (val === 0) kind = 'trade';
    else kind = 'losing';
    const balBefore = balanceFor(fenBefore, mover);
    facts.capture = {
      piece: move.captured,
      square: move.to,
      kind,
      regains: balBefore < 0 && balBefore + capVal <= 0,
      sameAsPrev: !!(recapture && opts.prevMove?.captured === move.captured),
    };
  }

  facts.fork = forkFrom(after, move.to);
  const pins = pinsFrom(after, move.to);
  facts.pin = pins.find((p) => p.kind === 'pin' && p.behindType === 'k') ?? pins[0] ?? null;

  if (!facts.givesCheck) facts.mateThreat = mateThreat(fenAfter, mover);

  if (!facts.inCheckBefore) {
    // New targets: enemy pieces we could win if it were our move again.
    const threatsBefore = hangingPieces(fenBefore, enemy);
    const threatsAfter = hangingPieces(fenAfter, enemy);
    facts.threats = threatsAfter
      .filter((t) => !threatsBefore.some((b) => b.square === t.square && b.gain >= t.gain))
      .filter((t) => !(move.captured && t.square === move.to))
      .slice(0, 2)
      .map((t) => ({ square: t.square, type: t.type }));

    // Did we rescue something?
    const oursBefore = hangingPieces(fenBefore, mover);
    const oursAfter = hangingPieces(fenAfter, mover);
    if (oursBefore.some((h) => h.square === move.from) && !oursAfter.some((h) => h.square === move.to)) {
      facts.escapes = true;
    }
    const saved = oursBefore.find((h) => h.square !== move.from && !oursAfter.some((a) => a.square === h.square));
    if (saved && !move.captured) facts.defends = { square: saved.square, type: saved.type };
  }

  const homeRank = mover === 'w' ? '1' : '8';
  const early = (opts.moveNumber ?? 99) <= 15 && opts.phase !== 'endgame';
  if (early && (move.piece === 'n' || move.piece === 'b') && move.from[1] === homeRank) facts.develops = true;
  if (early && move.piece === 'p' && ['d4', 'e4', 'd5', 'e5', 'c4', 'c5'].includes(move.to)) facts.centerPawn = true;
  if (move.piece === 'p' && !early && isPassedPawn(after, move.to)) facts.passedPawn = true;
  if (move.piece === 'r') {
    const file = move.to[0];
    let pawns = 0;
    for (let r = 1; r <= 8; r++) if (after.get(`${file}${r}` as Square)?.type === 'p') pawns++;
    if (pawns === 0 && move.from[0] !== file) facts.rookOpenFile = true;
  }
  if (move.piece === 'k' && opts.phase === 'endgame' && !facts.castle) {
    if ('cdef'.includes(move.to[0]) && '3456'.includes(move.to[1])) facts.kingActivity = true;
  }
  return facts;
}

function captureVerbPhrase(f: Facts, move: Move, poss: string): string | null {
  const c = f.capture;
  if (!c) return null;
  const p = name(c.piece);
  switch (c.kind) {
    case 'recapture':
      return c.sameAsPrev ? `takes back the ${p}` : `recaptures on ${c.square}`;
    case 'free':
      if (c.regains) return c.piece === 'p' ? 'wins back a pawn' : `wins back the ${p}`;
      return c.piece === 'p' ? 'wins a pawn' : `wins a free ${p}`;
    case 'winning':
      return PIECE_VALUE[c.piece] >= 3 ? `wins the ${p}` : 'wins material';
    case 'trade':
      if (move.piece === c.piece) return `trades ${p}s`;
      return `trades ${poss} ${name(move.piece)} for a ${p}`;
    case 'losing':
      return `gives up the ${name(move.piece)} for ${withArticle(p)}`;
  }
}

function threatList(threats: { square: Square; type: PieceSymbol }[]): string {
  if (threats.length === 2 && threats[0].type === threats[1].type) {
    return `the ${name(threats[0].type)}s on ${threats[0].square} and ${threats[1].square}`;
  }
  return threats.map((t) => `the ${name(t.type)} on ${t.square}`).join(' and ');
}

/**
 * What a (good) move achieves, as a verb phrase in the third person
 * ("wins a free knight", "forks the king and the rook"), or null.
 */
export function purposePhrase(f: Facts, move: Move, v: Voice): string | null {
  const poss = v.mePlural ? 'your' : 'the';
  const withCheck = f.discoveredCheck ? ' with a discovered check' : f.givesCheck ? ' with check' : '';
  if (f.promotion) return `promotes the pawn to a ${name(f.promotion)}${withCheck}`;
  const cap = captureVerbPhrase(f, move, poss);
  if (cap) {
    if (f.capture?.kind === 'losing') return `${cap}${withCheck}, but it's worth it`;
    const extra = f.threats.length ? ` and attacks ${threatList(f.threats.slice(0, 1))}` : '';
    return `${cap}${withCheck}${extra}`;
  }
  if (f.fork) {
    const [a, b] = f.fork.targets;
    return `forks the ${targetName(a.type)} and the ${targetName(b.type)}`;
  }
  if (f.pin) {
    return f.pin.kind === 'pin'
      ? `pins the ${name(f.pin.pinnedType)} to the ${targetName(f.pin.behindType)}`
      : `skewers the ${targetName(f.pin.pinnedType)} and the ${name(f.pin.behindType)} behind it`;
  }
  if (f.mateThreat) return `threatens checkmate with ${f.mateThreat}`;
  if (f.inCheckBefore) return move.piece === 'k' ? 'gets the king out of check' : 'blocks the check';
  if (f.escapes) return `moves the ${name(move.piece)} out of danger${withCheck}`;
  if (f.discoveredCheck) return 'uncovers a discovered check';
  if (f.threats.length) return `attacks ${threatList(f.threats)}${withCheck}`;
  if (f.castle) return 'tucks the king away and connects the rooks';
  if (f.defends) return `protects the ${name(f.defends.type)} on ${f.defends.square}${withCheck}`;
  if (f.givesCheck) return 'gives check';
  if (f.develops) return `develops the ${name(move.piece)}`;
  if (f.centerPawn) return 'claims space in the center';
  if (f.passedPawn) return 'pushes the passed pawn toward promotion';
  if (f.rookOpenFile) return 'puts the rook on an open file';
  if (f.kingActivity) return 'brings the king into the game';
  return null;
}

interface Refutation {
  kind:
    | 'mate'
    | 'hangs-moved'
    | 'ignored-threat'
    | 'hangs-other'
    | 'fork'
    | 'pin'
    | 'skewer'
    | 'promotion'
    | 'material'
    | 'double-attack'
    | 'positional';
  reply?: Move;
  mateIn?: number;
  lossText?: string;
  square?: Square;
  piece?: PieceSymbol;
  defended?: boolean;
  removedDefender?: boolean;
  fork?: ForkInfo;
  pin?: PinInfo;
  targets?: { square: Square; type: PieceSymbol }[];
}

/** Why is the played move bad? Looks at the opponent's best reply line. */
function refute(input: ExplainInput): Refutation {
  const { move, fenBefore, fenAfter, after } = input;
  const mover = move.color;
  const replyLine = after.lines[0];
  if (!replyLine) return { kind: 'positional' };
  const pos = new Chess(fenAfter);
  const reply = playUci(pos, replyLine.pv[0]) ?? undefined;
  if (replyLine.score.kind === 'mate' && replyLine.score.value > 0) {
    return { kind: 'mate', reply, mateIn: replyLine.score.value };
  }
  if (!reply) return { kind: 'positional' };

  const out = lineOutcome(fenAfter, replyLine.pv, mover, 12, -scoreToPawns(replyLine.score));
  const net = balanceFor(fenAfter, mover) + out.delta - balanceFor(fenBefore, mover);
  const lost = out.captures.filter((c) => c.by !== mover).map((c) => c.captured);
  const won = out.captures.filter((c) => c.by === mover).map((c) => c.captured);
  if (move.captured) won.push(move.captured);
  const promo = out.promotions.find((p) => p.by !== mover);

  if (net > -1 && !promo) {
    // No material changes hands right away; does the reply set up a double attack?
    // (Skipped when the reply escapes check: pieces only *look* newly attacked
    // because captures were illegal while the king was in check.)
    if (!reply.captured && !pos.inCheck() && !new Chess(fenAfter).inCheck()) {
      const beforeReply = hangingPieces(fenAfter, mover);
      const fresh = hangingPieces(pos.fen(), mover).filter((h) => !beforeReply.some((b) => b.square === h.square));
      const mine = fresh.map((h) => ({ square: h.square, type: h.type }));
      if (mine.length >= 2 || (mine.length === 1 && PIECE_VALUE[mine[0].type] >= 3)) {
        return { kind: 'double-attack', reply, targets: mine.slice(0, 2) };
      }
    }
    return { kind: 'positional', reply };
  }

  const lossText = describeMaterial(lost, won, Math.min(net, -1));
  if (promo && net > -3) return { kind: 'promotion', reply, lossText };

  if (reply.captured) {
    if (reply.to === move.to) {
      const defended = new Chess(fenAfter).attackers(reply.to, mover).length > 0;
      return { kind: 'hangs-moved', reply, lossText, square: reply.to, piece: reply.captured, defended };
    }
    const wasHanging = hangingPieces(fenBefore, mover).some((h) => h.square === reply.to);
    if (wasHanging) return { kind: 'ignored-threat', reply, lossText, square: reply.to, piece: reply.captured };
    const defendedBefore = attacksFrom(new Chess(fenBefore).board(), move.from).includes(reply.to);
    return { kind: 'hangs-other', reply, lossText, square: reply.to, piece: reply.captured, removedDefender: defendedBefore };
  }
  const fork = forkFrom(pos, reply.to);
  if (fork) return { kind: 'fork', reply, lossText, fork };
  const pin = pinsFrom(pos, reply.to)[0];
  if (pin) return { kind: pin.kind === 'pin' ? 'pin' : 'skewer', reply, lossText, pin };
  return { kind: 'material', reply, lossText };
}

type WinState = 'winning' | 'better' | 'equal' | 'worse' | 'losing';
function winState(w: number): WinState {
  if (w >= 0.75) return 'winning';
  if (w >= 0.58) return 'better';
  if (w > 0.42) return 'equal';
  if (w > 0.25) return 'worse';
  return 'losing';
}

function positionalDamage(input: ExplainInput, v: Voice): string {
  const { winBefore, winAfter, classification } = input.classified;
  const a = winState(winBefore);
  const b = winState(winAfter);
  const my = v.my;
  if (a === 'winning' && b === 'better') return `This makes ${my} advantage a lot smaller.`;
  if (a === 'winning' && b === 'equal') return `This throws away ${my} advantage.`;
  if ((a === 'winning' || a === 'better') && (b === 'worse' || b === 'losing')) return `This hands ${v.them} the advantage.`;
  if (a === 'better' && b === 'equal') return `This lets ${v.them} equalize.`;
  if (a === 'equal' && b === 'worse') return `This gives ${v.them} the upper hand.`;
  if (a === 'equal' && b === 'losing') return `This puts ${v.me} in serious trouble.`;
  if (a === 'worse' && b === 'losing') return `This makes ${my} position much harder to defend.`;
  if (a === 'losing') return 'This makes a difficult position even harder.';
  if (classification === 'blunder') return `This seriously damages ${my} position.`;
  if (classification === 'mistake') return `This makes ${my} position noticeably worse.`;
  return 'There was a more precise move.';
}

/** Is the material lost just the piece the reply captures? */
function sameLoss(r: Refutation): boolean {
  if (!r.piece || !r.lossText) return true;
  const n = name(r.piece);
  return r.lossText === withArticle(n) || (r.piece === 'p' && r.lossText === 'a pawn');
}

function refutationSentence(r: Refutation, v: Voice, input: ExplainInput): string {
  const replySan = r.reply?.san ?? '';
  const poss = v.mePlural ? 'your' : 'the';
  switch (r.kind) {
    case 'mate':
      return r.mateIn === 1
        ? `This allows checkmate with ${replySan}.`
        : `This allows a forced checkmate in ${r.mateIn}, starting with ${replySan}.`;
    case 'hangs-moved': {
      const p = name(r.piece!);
      if (!sameLoss(r)) return `The ${p} isn't safe on ${r.square}. After ${replySan}, ${v.me} ${verb('lose', v.mePlural)} ${r.lossText}.`;
      return r.defended
        ? `The ${p} isn't safe on ${r.square}: ${replySan} wins it.`
        : `This leaves ${poss} ${p} on ${r.square} unprotected, and ${replySan} takes it.`;
    }
    case 'ignored-threat':
      return sameLoss(r)
        ? `This doesn't deal with the threat to the ${name(r.piece!)} on ${r.square}, and ${replySan} wins it.`
        : `This doesn't deal with the threat to the ${name(r.piece!)} on ${r.square}. After ${replySan}, ${v.me} ${verb('lose', v.mePlural)} ${r.lossText}.`;
    case 'hangs-other':
      if (!sameLoss(r)) return `This leaves the ${name(r.piece!)} on ${r.square} hanging. After ${replySan}, ${v.me} ${verb('lose', v.mePlural)} ${r.lossText}.`;
      return r.removedDefender
        ? `Moving the ${name(input.move.piece)} leaves the ${name(r.piece!)} on ${r.square} without protection, and ${replySan} takes it.`
        : `This leaves ${poss} ${name(r.piece!)} on ${r.square} hanging: ${replySan} wins it.`;
    case 'fork': {
      const [a, b] = r.fork!.targets;
      return `This allows ${replySan}, forking ${poss} ${targetName(a.type)} and ${targetName(b.type)}.`;
    }
    case 'pin':
      return `This allows ${replySan}, pinning ${poss} ${name(r.pin!.pinnedType)} to the ${targetName(r.pin!.behindType)}.`;
    case 'skewer':
      return `This allows ${replySan}, skewering ${poss} ${targetName(r.pin!.pinnedType)} and ${name(r.pin!.behindType)}.`;
    case 'promotion':
      return `This lets ${v.them} promote a pawn after ${replySan}.`;
    case 'material':
      return `After ${replySan}, ${v.me} can't avoid losing ${r.lossText}.`;
    case 'double-attack':
      return `This allows ${replySan}, attacking ${threatList(r.targets!)}.`;
    default: {
      const damage = positionalDamage(input, v);
      // Name the concrete reply for real mistakes so the verdict isn't abstract.
      if (replySan && input.classified.classification !== 'inaccuracy') {
        return `${damage} ${cap(v.them)} ${verb('answer', v.themPlural)} best with ${replySan}.`;
      }
      return damage;
    }
  }
}

/** How would the best move have punished things? (past tense) */
function missedChance(input: ExplainInput, bestSan: string): string | null {
  const { classified, fenBefore, before, move } = input;
  if (classified.missedMate !== null) {
    return classified.missedMate === 1
      ? `${bestSan} was checkmate!`
      : `There was a forced checkmate in ${classified.missedMate}, starting with ${bestSan}.`;
  }
  const best = before.lines[0];
  if (!best) return null;
  const gain = classified.bestGain;
  if (gain < 1 || gain - classified.playedGain < 1) return null;
  const bm = playUci(new Chess(fenBefore), best.pv[0]);
  if (!bm) return null;
  const out = lineOutcome(fenBefore, best.pv, move.color, 12, scoreToPawns(best.score));
  const won = out.captures.filter((c) => c.by === move.color).map((c) => c.captured);
  const lost = out.captures.filter((c) => c.by !== move.color).map((c) => c.captured);
  const prize = describeMaterial(won, lost, -Math.max(1, Math.round(gain)));
  const facts = moveFacts(fenBefore, bm, { prevMove: input.prevMove });
  if (facts.capture?.kind === 'free' && bm.captured && !facts.capture.regains) {
    return bm.captured === 'p'
      ? `${bestSan} would have won a pawn for free.`
      : `The ${name(bm.captured)} on ${bm.to} was free to take with ${bestSan}.`;
  }
  if (facts.fork) {
    const [a, b] = facts.fork.targets;
    return `${bestSan} would have forked the ${targetName(a.type)} and the ${targetName(b.type)}, winning ${prize}.`;
  }
  if (facts.pin) {
    return facts.pin.kind === 'pin'
      ? `${bestSan} would have pinned the ${name(facts.pin.pinnedType)} to the ${targetName(facts.pin.behindType)}, winning ${prize}.`
      : `${bestSan} would have skewered the ${targetName(facts.pin.pinnedType)} and the ${name(facts.pin.behindType)}, winning ${prize}.`;
  }
  return `${bestSan} would have won ${prize}.`;
}

const TITLES: Record<Classification, (san: string) => string> = {
  brilliant: (s) => `${s} is brilliant`,
  great: (s) => `${s} is a great move`,
  best: (s) => `${s} is the best move`,
  excellent: (s) => `${s} is excellent`,
  good: (s) => `${s} is good`,
  book: (s) => `${s} is a book move`,
  inaccuracy: (s) => `${s} is an inaccuracy`,
  mistake: (s) => `${s} is a mistake`,
  miss: (s) => `${s} is a miss`,
  blunder: (s) => `${s} is a blunder`,
  forced: (s) => `${s} is forced`,
};

function holdsPhrase(winBefore: number): string {
  if (winBefore >= 0.65) return 'keeps the advantage';
  if (winBefore >= 0.4) return 'holds the balance';
  return 'keeps the game going';
}

export function explainMove(input: ExplainInput): CoachComment {
  const { move, classified, before, after, fenBefore } = input;
  const c = classified.classification;
  const v = voiceFor(move.color, input.perspective);
  const poss = v.mePlural ? 'your' : 'the';
  const san = move.san;
  const bestLine = before.lines[0];
  const bestMove = bestLine ? playUci(new Chess(fenBefore), bestLine.pv[0]) : null;
  const bestSan = bestMove?.san ?? '';
  const factOpts = { prevMove: input.prevMove, phase: input.phase, moveNumber: input.moveNumber };
  const body: string[] = [];
  let title = TITLES[c](san);

  if (c === 'book') {
    if (input.opening) body.push(`This is the ${input.opening.name}.`);
    else if (input.currentOpening) body.push(`This is known theory in the ${input.currentOpening.name}.`);
    else body.push('This is a well-known opening move.');
    return { title, body };
  }
  if (c === 'forced') {
    body.push(`It's the only legal move${new Chess(fenBefore).inCheck() ? ' out of check' : ''}.`);
    return { title, body };
  }

  const positive = c === 'brilliant' || c === 'great' || c === 'best' || c === 'excellent' || c === 'good';
  if (positive) {
    const facts = moveFacts(fenBefore, move, factOpts);
    if (facts.isMate) {
      title = `${san} is checkmate`;
      body.push(`${cap(v.me)} ${verb('win', v.mePlural)} the game!`);
      return { title, body };
    }
    const afterScore = after.lines[0]?.score;
    const mateIn = afterScore && afterScore.kind === 'mate' && afterScore.value < 0 ? -afterScore.value + 1 : null;
    const sac = classified.sacrifice;

    if (c === 'brilliant' && sac) {
      const piece = name(sac.piece);
      const reason = mateIn
        ? ` to force checkmate in ${mateIn}`
        : classified.winAfter >= 0.85
          ? ' for a winning attack'
          : classified.winAfter >= 0.6
            ? ' and gets more than enough in return'
            : ' to keep the balance';
      body.push(`${cap(v.me)} ${verb('give', v.mePlural)} up ${poss} ${piece}${reason}.`);
      const reply = after.lines[0];
      const replyTakes = reply ? new Chess(input.fenAfter).moves({ verbose: true }).some((m) => m.lan === reply.pv[0] && m.to === sac.square) : false;
      if (!replyTakes) {
        const n = input.next;
        const tookIt = n && n.move.to === sac.square && n.move.captured;
        const nextScore = n?.after.lines[0]?.score;
        const mates = tookIt && nextScore && nextScore.kind === 'mate' && nextScore.value > 0;
        body.push(mates ? `Taking the ${piece} walks into checkmate.` : `Taking the ${piece} would be a mistake.`);
      }
      return { title, body };
    }

    if (c === 'great') {
      body.push(mateIn ? "It's the only move that forces checkmate." : `It's the only move that ${holdsPhrase(classified.winBefore)}.`);
      const p = mateIn ? null : purposePhrase(facts, move, v);
      if (mateIn) return { title, body };
      if (p) body.push(`It ${p}.`);
      else {
        const second = before.lines[1];
        const secondSan = second ? playUci(new Chess(fenBefore), second.pv[0])?.san : null;
        if (second && secondSan) {
          const drop = classified.winBefore - scoreToWin(second.score);
          body.push(`The next best try, ${secondSan}, would ${drop >= 0.3 ? 'lose' : 'give away a lot'}.`);
        }
      }
      return { title, body };
    }

    if (mateIn && !(input.prevMove?.san.includes('#'))) {
      body.push(
        sac && PIECE_VALUE[sac.piece] >= 5
          ? `${cap(v.me)} ${verb('sacrifice', v.mePlural)} ${poss} ${name(sac.piece)} to force checkmate in ${mateIn}.`
          : `This forces checkmate in ${mateIn}.`,
      );
    } else {
      const p = purposePhrase(facts, move, v);
      if (p) body.push(`This ${p}.`);
      const punished =
        (input.prevClassification === 'blunder' || input.prevClassification === 'mistake') &&
        (c === 'best' || c === 'excellent') &&
        classified.playedGain >= 2;
      if (punished) body.push(`It punishes ${v.their} mistake.`);
    }

    if ((c === 'good' || c === 'excellent') && bestMove && bestSan !== san) {
      const playedPhrase = purposePhrase(facts, move, v);
      const bestPhrase = purposePhrase(moveFacts(fenBefore, bestMove, factOpts), bestMove, v);
      const why = bestPhrase && bestPhrase !== playedPhrase ? `: it ${bestPhrase}` : '';
      if (c === 'good') body.push(`${bestSan} was a bit stronger${why}.`);
      else if (!body.length) body.push(`${bestSan} was the engine's top choice, but this is nearly as good.`);
    }
    if (!body.length) {
      const reply = after.lines[0];
      if (reply && reply.pv.length >= 2) {
        const pos = new Chess(input.fenAfter);
        const r1 = playUci(pos, reply.pv[0]);
        const m2 = r1 ? playUci(pos, reply.pv[1]) : null;
        if (r1 && m2) body.push(`The main line continues ${r1.san} ${m2.san}.`);
      }
      if (!body.length) body.push(c === 'best' ? 'This is the strongest move in the position.' : 'A solid move.');
    }
    return { title, body };
  }

  // Inaccuracy, mistake, miss, blunder.
  if (c === 'miss') {
    const missed = missedChance(input, bestSan);
    body.push(missed ?? `${cap(v.me)} had a chance to take over with ${bestSan}.`);
    const r = refute(input);
    if (r.kind !== 'positional' && r.kind !== 'material') body.push(refutationSentence(r, v, input));
    return { title, body };
  }

  const r = refute(input);
  const missed = bestMove && bestSan !== san && classified.bestGain - classified.playedGain >= 1 ? missedChance(input, bestSan) : null;
  const hasBetter = !!bestMove && bestSan !== san;
  // A small, quiet slip is best explained by the better move alone.
  const vague = r.kind === 'positional' && c === 'inaccuracy' && positionalDamage(input, v) === 'There was a more precise move.';
  // A missed win explains a quiet mistake better than "the position got worse".
  if (!(missed && r.kind === 'positional') && !(vague && hasBetter)) body.push(refutationSentence(r, v, input));
  if (hasBetter) {
    if (missed && (r.kind === 'positional' || r.kind === 'double-attack')) body.push(missed);
    else {
      const bestPhrase = purposePhrase(moveFacts(fenBefore, bestMove, factOpts), bestMove, v);
      const lead = c === 'inaccuracy' ? 'Better was' : 'The best move was';
      body.push(`${lead} ${bestSan}${bestPhrase ? `, which ${bestPhrase}` : ''}.`);
    }
  }
  return { title, body };
}
