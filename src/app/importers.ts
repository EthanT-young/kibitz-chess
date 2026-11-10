/**
 * Fetch recent games from the public Chess.com and Lichess APIs. Both allow
 * cross-origin requests from browsers and need no account or API key.
 */
export interface GameListing {
  id: string;
  source: 'chess.com' | 'lichess';
  pgn: string;
  white: { name: string; rating?: number };
  black: { name: string; rating?: number };
  /** '1-0' | '0-1' | '1/2-1/2' */
  result: string;
  speed: string;
  endTime: number;
  url?: string;
  /** Which side the searched-for user played. */
  userColor: 'w' | 'b';
}

export class ImportError extends Error {}

const CC_DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

interface ChessComGame {
  url: string;
  pgn?: string;
  end_time: number;
  time_class: string;
  rules: string;
  uuid?: string;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
}

export async function fetchChessComGames(username: string, signal?: AbortSignal): Promise<GameListing[]> {
  const user = username.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,30}$/.test(user)) throw new ImportError('That doesn’t look like a Chess.com username.');
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(user)}/games`;
  let res: Response;
  try {
    res = await fetch(`${base}/archives`, { signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ImportError('Couldn’t reach Chess.com. Check your connection and try again.');
  }
  if (res.status === 404) throw new ImportError(`No Chess.com player named “${username.trim()}”.`);
  if (!res.ok) throw new ImportError(`Chess.com returned an error (${res.status}). Try again in a minute.`);
  const { archives } = (await res.json()) as { archives: string[] };
  if (!archives?.length) throw new ImportError(`${username.trim()} hasn’t played any games on Chess.com yet.`);

  const out: GameListing[] = [];
  // Walk back through monthly archives until we have enough games.
  for (const archive of archives.slice(-3).reverse()) {
    // Only follow archive links that point back at this player's archives.
    if (typeof archive !== 'string' || !archive.startsWith(`${base}/`)) continue;
    const r = await fetch(archive, { signal });
    if (!r.ok) continue;
    const { games } = (await r.json()) as { games: ChessComGame[] };
    for (const g of games) {
      if (g.rules !== 'chess' || !g.pgn) continue;
      const userColor = g.white.username.toLowerCase() === user ? 'w' : 'b';
      const result =
        g.white.result === 'win' ? '1-0' : g.black.result === 'win' ? '0-1' : CC_DRAWS.has(g.white.result) ? '1/2-1/2' : '*';
      out.push({
        id: g.uuid ?? g.url,
        source: 'chess.com',
        pgn: g.pgn,
        white: { name: g.white.username, rating: g.white.rating },
        black: { name: g.black.username, rating: g.black.rating },
        result,
        speed: g.time_class,
        endTime: g.end_time * 1000,
        url: g.url,
        userColor,
      });
    }
    if (out.length >= 40) break;
  }
  return out.sort((a, b) => b.endTime - a.endTime).slice(0, 50);
}

interface LichessGame {
  id: string;
  variant: string;
  speed: string;
  status: string;
  winner?: 'white' | 'black';
  lastMoveAt: number;
  pgn: string;
  players: {
    white: { user?: { name: string }; rating?: number; aiLevel?: number };
    black: { user?: { name: string }; rating?: number; aiLevel?: number };
  };
}

export async function fetchLichessGames(username: string, signal?: AbortSignal): Promise<GameListing[]> {
  const user = username.trim();
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(user)) throw new ImportError('That doesn’t look like a Lichess username.');
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=40&pgnInJson=true&clocks=true&moves=true`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/x-ndjson' }, signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ImportError('Couldn’t reach Lichess. Check your connection and try again.');
  }
  if (res.status === 404) throw new ImportError(`Lichess couldn’t find games for “${user}”. Check the spelling.`);
  if (res.status === 429) throw new ImportError('Lichess is rate-limiting requests. Wait a minute and try again.');
  if (!res.ok) throw new ImportError(`Lichess returned an error (${res.status}).`);
  const text = await res.text();
  const lower = user.toLowerCase();
  const out: GameListing[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const g = JSON.parse(line) as LichessGame;
    if (g.variant !== 'standard' || !g.pgn) continue;
    const name = (p: LichessGame['players']['white']) => p.user?.name ?? (p.aiLevel ? `Stockfish level ${p.aiLevel}` : 'Anonymous');
    const white = name(g.players.white);
    out.push({
      id: g.id,
      source: 'lichess',
      pgn: g.pgn,
      white: { name: white, rating: g.players.white.rating },
      black: { name: name(g.players.black), rating: g.players.black.rating },
      result: g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : g.status === 'started' ? '*' : '1/2-1/2',
      speed: g.speed,
      endTime: g.lastMoveAt,
      url: `https://lichess.org/${g.id}`,
      userColor: white.toLowerCase() === lower ? 'w' : 'b',
    });
  }
  if (!out.length) throw new ImportError(`No standard games found for ${user} on Lichess.`);
  return out;
}

/** Lichess game links can be fetched directly. */
export function lichessGameId(text: string): string | null {
  const m = text.trim().match(/^(?:https?:\/\/)?(?:www\.)?lichess\.org\/([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:\/(?:white|black))?\/?(?:#\d+)?$/);
  return m ? m[1] : null;
}

export async function fetchLichessGame(id: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`https://lichess.org/game/export/${id}?clocks=true&evals=false`, {
    headers: { Accept: 'application/x-chess-pgn' },
    signal,
  });
  if (!res.ok) throw new ImportError(res.status === 404 ? 'That Lichess game doesn’t exist.' : `Lichess returned an error (${res.status}).`);
  return res.text();
}

export function isChessComGameUrl(text: string): boolean {
  return /chess\.com\/(game|analysis)\//i.test(text.trim());
}
