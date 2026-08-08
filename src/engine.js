// Quarto rules engine — pure, dependency-free, no DOM.
//
// A piece is an integer 0..15. Each bit is one binary attribute:
//   bit 0 (1)  height : 0 = short   1 = tall
//   bit 1 (2)  color  : 0 = light   1 = dark
//   bit 2 (4)  shape  : 0 = round   1 = square
//   bit 3 (8)  surface: 0 = solid   1 = hollow
//
// A board is an Int8Array(16) in row-major order; -1 means empty.
// `avail` is a 16-bit mask: bit p set means piece p is still in the pool.

export const SIZE = 4;
export const CELLS = 16;
export const PIECES = 16;
export const ALL_PIECES = 0xffff;

export const HEIGHT = 1;
export const COLOR = 2;
export const SHAPE = 4;
export const HOLLOW = 8;

export const ATTRIBUTES = [
  { bit: HEIGHT, name: 'height', off: 'short', on: 'tall' },
  { bit: COLOR, name: 'color', off: 'light', on: 'dark' },
  { bit: SHAPE, name: 'shape', off: 'round', on: 'square' },
  { bit: HOLLOW, name: 'surface', off: 'solid', on: 'hollow' },
];

export const bit = (p) => 1 << p;
export const has = (mask, p) => (mask & (1 << p)) !== 0;

export function piecesOf(mask) {
  const out = [];
  for (let p = 0; p < PIECES; p++) if (mask & (1 << p)) out.push(p);
  return out;
}

export function emptyBoard() {
  return new Int8Array(CELLS).fill(-1);
}

export function emptyCells(board) {
  const out = [];
  for (let c = 0; c < CELLS; c++) if (board[c] < 0) out.push(c);
  return out;
}

/** Rows, columns, then both diagonals. */
export const STRAIGHT_LINES = (() => {
  const lines = [];
  for (let r = 0; r < SIZE; r++) lines.push([0, 1, 2, 3].map((c) => r * SIZE + c));
  for (let c = 0; c < SIZE; c++) lines.push([0, 1, 2, 3].map((r) => r * SIZE + c));
  lines.push([0, 5, 10, 15]);
  lines.push([3, 6, 9, 12]);
  return lines;
})();

/** The nine 2x2 blocks — an optional advanced-rule win condition. */
export const SQUARE_LINES = (() => {
  const lines = [];
  for (let r = 0; r < SIZE - 1; r++) {
    for (let c = 0; c < SIZE - 1; c++) {
      const i = r * SIZE + c;
      lines.push([i, i + 1, i + SIZE, i + SIZE + 1]);
    }
  }
  return lines;
})();

export function getLines(includeSquares) {
  return includeSquares ? STRAIGHT_LINES.concat(SQUARE_LINES) : STRAIGHT_LINES;
}

/** Index from cell -> the lines that pass through it. */
export function linesByCell(lines) {
  const byCell = Array.from({ length: CELLS }, () => []);
  for (const line of lines) for (const cell of line) byCell[cell].push(line);
  return byCell;
}

/** True when four pieces share at least one attribute value. */
export function shareAttribute(a, b, c, d) {
  return ((a & b & c & d) & 15) !== 0 || ((~a & ~b & ~c & ~d) & 15) !== 0;
}

/** The line completed by the piece just played at `cell`, or null. */
export function winAt(board, cell, byCell) {
  for (const line of byCell[cell]) {
    const a = board[line[0]];
    if (a < 0) continue;
    const b = board[line[1]];
    if (b < 0) continue;
    const c = board[line[2]];
    if (c < 0) continue;
    const d = board[line[3]];
    if (d < 0) continue;
    if (shareAttribute(a, b, c, d)) return line;
  }
  return null;
}

/** Scan the whole board for a completed line, or null. */
export function findWin(board, lines) {
  for (const line of lines) {
    const a = board[line[0]];
    if (a < 0) continue;
    const b = board[line[1]];
    if (b < 0) continue;
    const c = board[line[2]];
    if (c < 0) continue;
    const d = board[line[3]];
    if (d < 0) continue;
    if (shareAttribute(a, b, c, d)) return line;
  }
  return null;
}

/**
 * Every line holding exactly three pieces plus one empty cell, reduced to the
 * masks a fourth piece must match to complete it:
 *   piece q wins here iff (q & pos) !== 0 || (~q & neg) !== 0
 */
export function threats(board, lines) {
  const out = [];
  for (const line of lines) {
    let empty = -1;
    let filled = 0;
    let and = 15;
    let nand = 15;
    for (const cell of line) {
      const p = board[cell];
      if (p < 0) {
        if (empty >= 0) {
          filled = -1;
          break;
        }
        empty = cell;
      } else {
        filled++;
        and &= p;
        nand &= ~p;
      }
    }
    if (filled === 3 && empty >= 0 && (and !== 0 || (nand & 15) !== 0)) {
      out.push({ cell: empty, pos: and, neg: nand & 15 });
    }
  }
  return out;
}

/** Can `piece` win immediately somewhere, given precomputed threats? */
export function winningCellFor(piece, threatList) {
  for (const t of threatList) {
    if ((piece & t.pos) !== 0 || ((~piece & t.neg) & 15) !== 0) return t.cell;
  }
  return -1;
}

export function isHot(piece, threatList) {
  return winningCellFor(piece, threatList) >= 0;
}

export function pieceName(p) {
  return ATTRIBUTES.map((a) => (p & a.bit ? a.on : a.off)).join(' ');
}
