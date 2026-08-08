// Turn/phase state machine for a game of Quarto.
//
// A round is two half-moves:
//   phase 'select' — the player on turn picks a piece and hands it over
//   phase 'place'  — the receiving player places it, then selects in turn
//
// So `select` flips the turn, `place` does not.

import { ALL_PIECES, bit, emptyBoard, findWin, getLines } from './engine.js';

export function newGame({ useSquares = false, first = 0 } = {}) {
  return {
    board: emptyBoard(),
    avail: ALL_PIECES,
    hand: -1, // the piece handed over, waiting to be placed
    turn: first, // 0 or 1
    phase: 'select',
    useSquares,
    status: 'playing', // 'playing' | 'win' | 'draw'
    winner: -1,
    winLine: null,
    lastCell: -1,
    moves: 0,
  };
}

export function clone(state) {
  return { ...state, board: Int8Array.from(state.board), winLine: state.winLine ? [...state.winLine] : null };
}

export function canSelect(state, piece) {
  return state.status === 'playing' && state.phase === 'select' && (state.avail & bit(piece)) !== 0;
}

export function canPlace(state, cell) {
  return state.status === 'playing' && state.phase === 'place' && state.board[cell] < 0;
}

export function select(state, piece) {
  if (!canSelect(state, piece)) return state;
  const next = clone(state);
  next.avail &= ~bit(piece);
  next.hand = piece;
  next.turn = 1 - state.turn;
  next.phase = 'place';
  return next;
}

export function place(state, cell) {
  if (!canPlace(state, cell)) return state;
  const next = clone(state);
  next.board[cell] = state.hand;
  next.hand = -1;
  next.lastCell = cell;
  next.moves = state.moves + 1;
  next.phase = 'select';

  const line = findWin(next.board, getLines(state.useSquares));
  if (line) {
    next.status = 'win';
    next.winner = state.turn;
    next.winLine = line;
  } else if (next.avail === 0 && next.moves === 16) {
    next.status = 'draw';
  }
  return next;
}
