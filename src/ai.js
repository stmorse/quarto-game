// Quarto AI — negamax with alpha-beta, iterative deepening and a time budget.
//
// A "move" in Quarto is a pair: place the piece you were handed, then hand a
// piece to your opponent. Both halves are chosen by the same player, so the
// whole pair is one max node and the search flattens it into a single loop.

import {
  CELLS,
  PIECES,
  bit,
  emptyCells,
  getLines,
  linesByCell,
  threats,
  isHot,
  winningCellFor,
  winAt,
} from './engine.js';

export const WIN = 100000;
const TIMEOUT = Symbol('timeout');

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const LEVELS = {
  easy: { maxDepth: 1, timeMs: 120, margin: 900, blunder: 0.55 },
  medium: { maxDepth: 4, timeMs: 700, margin: 120, blunder: 0.1 },
  hard: { maxDepth: 14, timeMs: 2600, margin: 0, blunder: 0 },
};

export class Searcher {
  constructor({ useSquares = false, rng = Math.random } = {}) {
    this.lines = getLines(useSquares);
    this.byCell = linesByCell(this.lines);
    this.rng = rng;
    this.tt = new Map();
    this.nodes = 0;
    this.deadline = Infinity;
  }

  key(board, piece) {
    let s = String.fromCharCode(piece + 1);
    for (let c = 0; c < CELLS; c++) s += String.fromCharCode(board[c] + 2);
    return s;
  }

  /**
   * Value of the position for the player who is holding `piece` and about to
   * place it. `avail` excludes `piece` itself.
   */
  negamax(board, piece, avail, depth, alpha, beta, ply) {
    if ((++this.nodes & 511) === 0 && now() > this.deadline) throw TIMEOUT;

    const alpha0 = alpha;
    const key = this.key(board, piece);
    const hit = this.tt.get(key);
    if (hit && hit.depth >= depth) {
      if (hit.flag === 0) return hit.score;
      if (hit.flag === 1 && hit.score > alpha) alpha = hit.score;
      else if (hit.flag === 2 && hit.score < beta) beta = hit.score;
      if (alpha >= beta) return hit.score;
    }

    const open = threats(board, this.lines);
    if (isHot(piece, open)) return WIN - ply; // we can complete a line right now

    const empties = emptyCells(board);
    if (depth <= 0) return this.evaluate(avail, open);

    let best = -Infinity;
    outer: for (const cell of empties) {
      board[cell] = piece;

      if (empties.length === 1) {
        // Last piece of the game, and it did not win: a draw.
        board[cell] = -1;
        if (0 > best) best = 0;
        if (best > alpha) alpha = best;
        continue;
      }

      const after = threats(board, this.lines);
      const safe = [];
      for (let q = 0; q < PIECES; q++) {
        if (!(avail & bit(q))) continue;
        if (!isHot(q, after)) safe.push(q);
      }

      if (safe.length === 0) {
        // Every piece we could hand over lets the opponent win at once.
        board[cell] = -1;
        const v = -(WIN - ply - 1);
        if (v > best) best = v;
        if (best > alpha) alpha = best;
        continue;
      }

      for (const q of safe) {
        const v = -this.negamax(board, q, avail & ~bit(q), depth - 1, -beta, -alpha, ply + 1);
        if (v > best) best = v;
        if (best > alpha) alpha = best;
        if (alpha >= beta) {
          board[cell] = -1;
          break outer;
        }
      }
      board[cell] = -1;
    }

    const flag = best <= alpha0 ? 2 : best >= beta ? 1 : 0;
    this.tt.set(key, { depth, score: best, flag });
    return best;
  }

  /**
   * Static evaluation from the perspective of the player to move. The pressure
   * in Quarto is the hand-off: a position is bad when most of the remaining
   * pieces would hand the opponent a win.
   */
  evaluate(avail, open) {
    let total = 0;
    let safe = 0;
    for (let q = 0; q < PIECES; q++) {
      if (!(avail & bit(q))) continue;
      total++;
      if (!isHot(q, open)) safe++;
    }
    if (total === 0) return 0;
    if (safe === 0) return -800;
    return Math.round((160 * safe) / total) - 80;
  }

  /** All legal (cell, give) pairs, with hopeless hand-offs pre-scored. */
  rootMoves(board, piece, avail) {
    const moves = [];
    const empties = emptyCells(board);
    for (const cell of empties) {
      board[cell] = piece;
      if (winAt(board, cell, this.byCell)) {
        board[cell] = -1;
        return [{ cell, give: -1, score: WIN, decisive: true }];
      }
      if (empties.length === 1) {
        board[cell] = -1;
        moves.push({ cell, give: -1, score: 0, forced: true });
        continue;
      }
      const after = threats(board, this.lines);
      const safe = [];
      for (let q = 0; q < PIECES; q++) {
        if (!(avail & bit(q))) continue;
        if (isHot(q, after)) continue;
        safe.push(q);
      }
      if (safe.length === 0) {
        const q = firstPiece(avail);
        moves.push({ cell, give: q, score: -(WIN - 1), forced: true });
      } else {
        for (const q of safe) moves.push({ cell, give: q, score: 0 });
      }
      board[cell] = -1;
    }
    return moves;
  }

  /**
   * Pick a move. `piece` is the piece handed to us, or -1 when we only have to
   * choose a piece for the opponent (the opening hand-off).
   */
  bestMove(board, piece, avail, level = 'hard', timeMs) {
    const base = LEVELS[level] || LEVELS.hard;
    const cfg = timeMs ? { ...base, timeMs } : base;
    this.tt.clear();
    this.nodes = 0;
    this.deadline = now() + cfg.timeMs;
    const work = Int8Array.from(board);

    if (piece < 0) return { cell: -1, give: this.chooseGift(work, avail, cfg) };

    const moves = this.rootMoves(work, piece, avail);
    if (moves.length === 1 || moves[0].decisive) {
      const m = moves[0];
      return { cell: m.cell, give: m.give >= 0 ? m.give : firstPiece(avail), score: m.score };
    }

    if (cfg.blunder && this.rng() < cfg.blunder) {
      // Careless play: any empty cell, any piece — but the win above is always taken.
      const empties = emptyCells(work);
      const pool = piecesIn(avail);
      return {
        cell: empties[Math.floor(this.rng() * empties.length)],
        give: pool.length ? pool[Math.floor(this.rng() * pool.length)] : -1,
        score: 0,
        random: true,
      };
    }

    let best = moves;
    for (let depth = 1; depth <= cfg.maxDepth; depth++) {
      try {
        const scored = this.scoreRoot(work, piece, avail, moves, depth, cfg.margin);
        scored.sort((a, b) => b.score - a.score);
        best = scored;
        moves.length = 0;
        moves.push(...scored);
        if (Math.abs(best[0].score) > WIN - 100) break; // forced result found
      } catch (e) {
        if (e !== TIMEOUT) throw e;
        break;
      }
      if (now() > this.deadline) break;
    }

    const chosen = this.pickAmong(best, cfg);
    return { cell: chosen.cell, give: chosen.give, score: chosen.score, nodes: this.nodes };
  }

  /**
   * Score every root move at a fixed depth. Moves are searched with a window
   * open down to (best - margin) so that near-best moves keep exact scores and
   * the weaker levels have real alternatives to choose between.
   */
  scoreRoot(board, piece, avail, moves, depth, margin = 0) {
    const scored = [];
    let alpha = -Infinity;
    for (const m of moves) {
      if (m.forced) {
        scored.push({ ...m });
        if (m.score > alpha) alpha = m.score;
        continue;
      }
      const lower = alpha === -Infinity ? -Infinity : alpha - margin - 1;
      board[m.cell] = piece;
      const score = -this.negamax(
        board,
        m.give,
        avail & ~bit(m.give),
        depth - 1,
        -Infinity,
        lower === -Infinity ? Infinity : -lower,
        1,
      );
      board[m.cell] = -1;
      scored.push({ ...m, score });
      if (score > alpha) alpha = score;
    }
    return scored;
  }

  /** Choose the opening hand-off (or any position where we hold no piece). */
  chooseGift(board, avail, cfg) {
    const open = threats(board, this.lines);
    const safe = [];
    for (let q = 0; q < PIECES; q++) {
      if (!(avail & bit(q))) continue;
      if (!isHot(q, open)) safe.push(q);
    }
    const pool = safe.length ? safe : piecesIn(avail);
    // On an empty board every piece is equivalent by relabelling symmetry.
    if (board.every((c) => c < 0)) return pool[Math.floor(this.rng() * pool.length)];
    if (cfg.blunder && this.rng() < cfg.blunder) {
      const all = piecesIn(avail);
      return all[Math.floor(this.rng() * all.length)];
    }

    let best = pool[0];
    let bestScore = -Infinity;
    const results = [];
    for (const q of pool) {
      let score;
      try {
        score = -this.negamax(board, q, avail & ~bit(q), Math.max(1, cfg.maxDepth - 1), -Infinity, Infinity, 1);
      } catch (e) {
        if (e !== TIMEOUT) throw e;
        break;
      }
      results.push({ give: q, score });
      if (score > bestScore) {
        bestScore = score;
        best = q;
      }
    }
    if (!results.length) return best;
    const near = results.filter((r) => r.score >= bestScore - cfg.margin);
    return near[Math.floor(this.rng() * near.length)].give;
  }

  /** Break ties randomly, and on lower levels accept slightly worse moves. */
  pickAmong(scored, cfg) {
    const top = scored[0].score;
    const near = scored.filter((m) => m.score >= top - cfg.margin);
    return near[Math.floor(this.rng() * near.length)] || scored[0];
  }
}

function firstPiece(avail) {
  for (let q = 0; q < PIECES; q++) if (avail & bit(q)) return q;
  return -1;
}

function piecesIn(avail) {
  const out = [];
  for (let q = 0; q < PIECES; q++) if (avail & bit(q)) out.push(q);
  return out;
}

export function chooseMove({ board, piece, avail, level, useSquares, seed, timeMs }) {
  const rng = seed === undefined ? Math.random : mulberry32(seed);
  const s = new Searcher({ useSquares, rng });
  return s.bestMove(Int8Array.from(board), piece, avail, level, timeMs);
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
