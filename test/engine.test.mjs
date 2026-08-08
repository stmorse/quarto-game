import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_PIECES,
  HOLLOW,
  SQUARE_LINES,
  STRAIGHT_LINES,
  emptyBoard,
  findWin,
  getLines,
  isHot,
  shareAttribute,
  threats,
  winningCellFor,
} from '../src/engine.js';
import { newGame, place, select } from '../src/game.js';

test('there are 10 straight lines and 9 square blocks', () => {
  assert.equal(STRAIGHT_LINES.length, 10);
  assert.equal(SQUARE_LINES.length, 9);
  assert.equal(getLines(true).length, 19);
});

test('shareAttribute matches on a shared 1-bit and on a shared 0-bit', () => {
  // all tall (bit 0 set in every piece)
  assert.ok(shareAttribute(1, 3, 5, 7));
  // all short (bit 0 clear in every piece)
  assert.ok(shareAttribute(0, 2, 4, 6));
  // nothing in common: 0000, 0111, 1011, 1101 -> and = 0, nand = 0
  assert.equal(shareAttribute(0b0000, 0b0111, 0b1011, 0b1101), false);
});

test('findWin spots rows, columns and diagonals', () => {
  const lines = getLines(false);

  const row = emptyBoard();
  [0, 1, 2, 3].forEach((c, i) => (row[c] = [1, 3, 5, 7][i])); // all tall
  assert.deepEqual(findWin(row, lines), [0, 1, 2, 3]);

  const col = emptyBoard();
  [0, 4, 8, 12].forEach((c, i) => (col[c] = [2, 3, 6, 7][i])); // all dark
  assert.deepEqual(findWin(col, lines), [0, 4, 8, 12]);

  const diag = emptyBoard();
  [3, 6, 9, 12].forEach((c, i) => (diag[c] = [8, 9, 10, 11][i])); // all hollow
  assert.deepEqual(findWin(diag, lines), [3, 6, 9, 12]);
});

test('2x2 blocks only win when the variant is on', () => {
  const b = emptyBoard();
  [0, 1, 4, 5].forEach((c, i) => (b[c] = [1, 3, 5, 7][i])); // all tall in a block
  assert.equal(findWin(b, getLines(false)), null);
  assert.deepEqual(findWin(b, getLines(true)), [0, 1, 4, 5]);
});

test('threats describe exactly which piece completes a line', () => {
  const b = emptyBoard();
  b[0] = 1; // tall
  b[1] = 3; // tall dark
  b[2] = 5; // tall square
  const th = threats(b, getLines(false));
  const row = th.find((t) => t.cell === 3);
  assert.ok(row, 'the open row is a threat');
  assert.ok(isHot(7, th), 'any tall piece wins there');
  assert.equal(winningCellFor(7, th), 3);
  // the three placed pieces are all tall and all solid, so only a short *and*
  // hollow piece is safe to hand over
  assert.equal(isHot(2, th), true, 'short + solid still completes "all solid"');
  assert.equal(isHot(HOLLOW, th), false, 'short + hollow shares nothing');
});

/* ------------------------------------------------------------- game flow */

test('select hands the piece over and flips the turn; place does not', () => {
  let g = newGame({ first: 0 });
  assert.equal(g.phase, 'select');

  g = select(g, 5);
  assert.equal(g.hand, 5);
  assert.equal(g.turn, 1, 'the receiver is now on turn');
  assert.equal(g.phase, 'place');
  assert.equal(g.avail & (1 << 5), 0, 'the piece has left the pool');

  g = place(g, 0);
  assert.equal(g.board[0], 5);
  assert.equal(g.turn, 1, 'the placer now chooses for the opponent');
  assert.equal(g.phase, 'select');
  assert.equal(g.hand, -1);
});

test('illegal actions leave the state untouched', () => {
  let g = newGame();
  const same = place(g, 0); // nothing in hand yet
  assert.equal(same, g);
  g = select(g, 5);
  assert.equal(select(g, 6), g, 'cannot select twice');
  assert.equal(place(g, 99) === g, true);
});

test('the player who places the fourth piece of a line wins', () => {
  let g = newGame({ first: 0 });
  const moves = [
    [1, 0],
    [3, 1],
    [5, 2],
    [7, 3], // four tall pieces along the top row
  ];
  for (const [piece, cell] of moves) {
    g = select(g, piece);
    g = place(g, cell);
  }
  assert.equal(g.status, 'win');
  assert.deepEqual([...g.winLine], [0, 1, 2, 3]);
  // Placements alternate 1, 0, 1, 0 — the fourth is player 0's.
  assert.equal(g.winner, 0, 'the player who placed the fourth tall piece wins');
});

test('a full board with no line is a draw', () => {
  // A drawn final arrangement (piece for cell 0, cell 1, ...). Filling the
  // cells in order can never complete a line early, because every line that
  // fills up holds the same four pieces it holds at the end.
  const arrangement = [0, 1, 2, 12, 3, 4, 5, 8, 6, 9, 10, 15, 11, 14, 13, 7];
  let g = newGame({ first: 0 });
  for (let cell = 0; cell < 16; cell++) {
    g = select(g, arrangement[cell]);
    g = place(g, cell);
    assert.notEqual(g.status, 'win', `unexpected win at cell ${cell}`);
  }
  assert.equal(g.status, 'draw');
  assert.equal(g.avail, 0);
  assert.equal(g.moves, 16);
});

test('the pool empties exactly once per selection', () => {
  let g = newGame();
  assert.equal(g.avail, ALL_PIECES);
  g = select(g, 0);
  g = place(g, 0);
  g = select(g, 1);
  assert.equal(g.avail, ALL_PIECES & ~1 & ~2);
});
