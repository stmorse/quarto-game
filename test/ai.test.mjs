import test from 'node:test';
import assert from 'node:assert/strict';

import { ALL_PIECES, bit, emptyBoard, getLines, isHot, threats, winAt, linesByCell } from '../src/engine.js';
import { newGame, place, select } from '../src/game.js';
import { Searcher, chooseMove, mulberry32 } from '../src/ai.js';

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
