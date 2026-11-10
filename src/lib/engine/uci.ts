/** Evaluation from the side to move's point of view, exactly as UCI reports it. */
export type Score = { kind: 'cp'; value: number } | { kind: 'mate'; value: number };

export interface PvLine {
  multipv: number;
  depth: number;
  score: Score;
  /** UCI moves */
  pv: string[];
  nodes?: number;
}

export interface PositionAnalysis {
  fen: string;
  depth: number;
  /** Sorted best first (multipv 1, 2, ...). Empty for finished positions. */
  lines: PvLine[];
  /** Set when the game is over in this position. */
  terminal?: 'checkmate' | 'stalemate' | 'draw';
}

export interface InfoLine extends PvLine {
  bound?: 'lower' | 'upper';
}

export function parseInfo(line: string): InfoLine | null {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null;
  const tokens = line.split(/\s+/);
  let depth = 0;
  let multipv = 1;
  let score: Score | null = null;
  let bound: 'lower' | 'upper' | undefined;
  let nodes: number | undefined;
  let pv: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'depth') depth = Number(tokens[++i]);
    else if (t === 'multipv') multipv = Number(tokens[++i]);
    else if (t === 'nodes') nodes = Number(tokens[++i]);
    else if (t === 'score') {
      const kind = tokens[++i];
      const value = Number(tokens[++i]);
      if (kind === 'cp' || kind === 'mate') score = { kind, value } as Score;
      const next = tokens[i + 1];
      if (next === 'lowerbound' || next === 'upperbound') {
        bound = next === 'lowerbound' ? 'lower' : 'upper';
        i++;
      }
    } else if (t === 'pv') {
      pv = tokens.slice(i + 1).filter(Boolean);
      break;
    }
  }
  if (!score || !pv.length) return null;
  return { depth, multipv, score, pv, nodes, bound };
}

/** Flips a score to the other side's point of view. */
export function negate(score: Score): Score {
  return { kind: score.kind, value: -score.value } as Score;
}
