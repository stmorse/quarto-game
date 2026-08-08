import test from 'node:test';
import assert from 'node:assert/strict';

import { ALL_PIECES, bit, emptyBoard, getLines, isHot, threats, winAt, linesByCell } from '../src/engine.js';
import { newGame, place, select } from '../src/game.js';
import { Searcher, WIN, chooseMove, mulberry32 } from '../src/ai.js';

const lines = getLines(false);
const byCell = linesByCell(lines);

function availFrom(board, hand = -1) {
  let avail = ALL_PIECES;
  for (const p of board) if (p >= 0) avail &= ~bit(p);
  if (hand >= 0) avail &= ~bit(hand);
  return avail;
}

test('takes an immediate win when handed the winning piece', () => {
  const board = emptyBoard();
  board[0] = 1; // tall
  board[1] = 3; // tall
  board[2] = 5; // tall
  const hand = 7; // tall — completes the top row at cell 3
  const move = chooseMove({ board, piece: hand, avail: availFrom(board, hand), level: 'hard', seed: 1 });
  assert.equal(move.cell, 3);

  board[3] = hand;
  assert.ok(winAt(board, 3, byCell), 'the chosen cell really completes a line');
});

test('easy still takes a win that is handed to it', () => {
  const board = emptyBoard();
  board[0] = 2;
  board[4] = 6;
  board[8] = 10; // all dark, column 0
  const hand = 14; // dark
  for (let seed = 0; seed < 12; seed++) {
    const move = chooseMove({ board, piece: hand, avail: availFrom(board, hand), level: 'easy', seed });
    assert.equal(move.cell, 12, `seed ${seed} missed the win`);
  }
});

test('never hands over a winning piece while a safe one exists', () => {
  const board = emptyBoard();
  board[0] = 1;
  board[1] = 3;
  board[2] = 5; // top row wants any tall piece, or any solid piece
  const hand = 8; // short + hollow: safe to place, no win available
  const avail = availFrom(board, hand);

  for (const level of ['medium', 'hard']) {
    const move = chooseMove({ board, piece: hand, avail, level, seed: 7 });
    const after = Int8Array.from(board);
    after[move.cell] = hand;
    assert.equal(winAt(after, move.cell, byCell), null, `${level} should not have a win here`);
    const open = threats(after, lines);
    assert.equal(isHot(move.give, open), false, `${level} handed over a winning piece`);
  }
});

test('when every hand-off loses, the search reports a losing score', () => {
  // Two open threats needing complementary attributes leaves nothing safe.
  const board = emptyBoard();
  board[0] = 0b0000;
  board[1] = 0b0001;
  board[2] = 0b0010; // row 0 open at cell 3
  board[4] = 0b0100;
  board[5] = 0b0101;
  board[6] = 0b0110; // row 1 open at cell 7
  const s = new Searcher({ useSquares: false, rng: mulberry32(3) });
  const hand = 0b1111;
  const avail = availFrom(board, hand);
  const move = s.bestMove(board, hand, avail, 'hard');
  assert.ok(typeof move.cell === 'number' && move.cell >= 0);
});

/**
 * A position where three of the forty legal moves lose by force: hand the
 * piece over, the opponent places it and hands back something safe, and now
 * every piece left wins for them. A depth-1 or depth-2 search cannot see it.
 */
const TRAP = {
  board: Int8Array.from([10, -1, -1, -1, 15, -1, 1, 6, -1, -1, -1, 8, -1, -1, 5, 7]),
  hand: 3,
  avail: 31253,
  losing: [
    [9, 9],
    [9, 11],
    [13, 12],
  ],
};

function isForcedLoss(cell, give) {
  return TRAP.losing.some(([c, g]) => c === cell && g === give);
}

test('depth 3 is what exposes the two-move trap', () => {
  const seen = [1, 2, 3].map((depth) => {
    const s = new Searcher({ rng: mulberry32(1) });
    s.limit = Infinity;
    s.deadline = Infinity;
    const board = Int8Array.from(TRAP.board);
    const moves = s.rootMoves(board, TRAP.hand, TRAP.avail);
    const scored = s.scoreRoot(board, TRAP.hand, TRAP.avail, moves, depth, 0);
    return scored.filter((m) => m.score <= -(WIN / 2)).length;
  });
  assert.deepEqual(seen, [0, 0, 3], 'depths 1 and 2 are blind to it, depth 3 sees all three');
});

test('medium never walks into the trap, and never hands over a winning piece', () => {
  for (let seed = 0; seed < 40; seed++) {
    const move = chooseMove({ board: TRAP.board, piece: TRAP.hand, avail: TRAP.avail, level: 'medium', seed });
    assert.equal(isForcedLoss(move.cell, move.give), false, `seed ${seed} played a losing move`);

    const after = Int8Array.from(TRAP.board);
    after[move.cell] = TRAP.hand;
    assert.equal(isHot(move.give, threats(after, lines)), false, `seed ${seed} handed over a winning piece`);
  }
});

test('the depth floor holds even when the clock has already run out', () => {
  // minDepth ignores the time budget on purpose: the level's promise must not
  // depend on how fast the machine is.
  for (let seed = 0; seed < 12; seed++) {
    const move = chooseMove({
      board: TRAP.board,
      piece: TRAP.hand,
      avail: TRAP.avail,
      level: 'medium',
      seed,
      timeMs: 1,
    });
    assert.equal(isForcedLoss(move.cell, move.give), false, `seed ${seed} played a losing move`);
  }
});

test('medium hands over a winning piece in no game it plays', () => {
  for (let seed = 0; seed < 4; seed++) {
    let g = newGame({ first: 0 });
    let guard = 0;
    while (g.status === 'playing' && guard++ < 40) {
      // Seat 1 is medium; seat 0 plays randomly to steer into varied positions.
      if (g.turn === 1) {
        const move = chooseMove({
          board: g.board,
          piece: g.phase === 'place' ? g.hand : -1,
          avail: g.avail,
          level: 'medium',
          seed: seed * 31 + guard,
          timeMs: 200,
        });
        if (g.phase === 'place') {
          g = place(g, move.cell);
        } else {
          assert.equal(
            isHot(move.give, threats(g.board, lines)),
            false,
            `game ${seed} move ${guard}: medium handed over a winning piece`,
          );
          g = select(g, move.give);
        }
      } else {
        const rng = mulberry32(seed * 977 + guard);
        if (g.phase === 'place') {
          const cells = [];
          for (let c = 0; c < 16; c++) if (g.board[c] < 0) cells.push(c);
          g = place(g, cells[Math.floor(rng() * cells.length)]);
        } else {
          const pool = [];
          for (let p = 0; p < 16; p++) if (g.avail & bit(p)) pool.push(p);
          g = select(g, pool[Math.floor(rng() * pool.length)]);
        }
      }
    }
  }
});

test('hard beats easy over a series of games', () => {
  let hardPoints = 0;
  let games = 0;
  for (let seed = 0; seed < 6; seed++) {
    for (const hardFirst of [true, false]) {
      const result = playout(hardFirst ? ['hard', 'easy'] : ['easy', 'hard'], seed);
      const hardSeat = hardFirst ? 0 : 1;
      games++;
      if (result.status === 'draw') hardPoints += 0.5;
      else if (result.winner === hardSeat) hardPoints += 1;
    }
  }
  assert.ok(hardPoints >= games * 0.75, `hard scored ${hardPoints}/${games}`);
});

test('a full self-play game always reaches a terminal state', () => {
  const result = playout(['medium', 'medium'], 11);
  assert.ok(result.status === 'win' || result.status === 'draw');
  assert.ok(result.moves <= 16);
});

function playout(levels, seed, timeMs = 120) {
  let g = newGame({ first: 0 });
  let guard = 0;
  while (g.status === 'playing' && guard++ < 40) {
    const level = levels[g.turn];
    const piece = g.phase === 'place' ? g.hand : -1;
    const move = chooseMove({
      board: g.board,
      piece,
      avail: g.avail,
      level,
      useSquares: false,
      seed: seed * 97 + guard,
      timeMs,
    });
    if (g.phase === 'place') g = place(g, move.cell);
    else g = select(g, move.give);
  }
  return g;
}
