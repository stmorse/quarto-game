// Piece rendering. Every piece is a single <path> so that hollow pieces are a
// true cut-out (fill-rule: evenodd) rather than a disc stacked on a disc.
//
//   height  -> overall size        color   -> fill (the stroke is its inverse)
//   shape   -> circle or square    surface -> solid or a punched-out centre

import { COLOR, HEIGHT, HOLLOW, SHAPE, pieceName } from './engine.js';

const VIEW = 100;
const TALL = 74;
const SHORT = 52;
const HOLE = 0.38; // hole size as a fraction of the outer size

function circlePath(cx, cy, r) {
  return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
}

function squarePath(cx, cy, size, radius) {
  const h = size / 2;
  const x = cx - h;
  const y = cy - h;
  const r = Math.min(radius, h);
  return (
    `M ${x + r} ${y} H ${x + size - r} A ${r} ${r} 0 0 1 ${x + size} ${y + r}` +
    ` V ${y + size - r} A ${r} ${r} 0 0 1 ${x + size - r} ${y + size}` +
    ` H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + size - r}` +
    ` V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`
  );
}

function shapePath(piece, size) {
  const c = VIEW / 2;
  return piece & SHAPE ? squarePath(c, c, size, size * 0.14) : circlePath(c, c, size / 2);
}

/** SVG markup for one piece, sized to fill its container. */
export function pieceSVG(piece, { className = '' } = {}) {
  const size = piece & HEIGHT ? TALL : SHORT;
  let d = shapePath(piece, size);
  if (piece & HOLLOW) d += ' ' + shapePath(piece, size * HOLE);
  const tone = piece & COLOR ? 'dark' : 'light';
  return (
    `<svg class="piece ${tone} ${className}" viewBox="0 0 ${VIEW} ${VIEW}" role="img"` +
    ` aria-label="${pieceName(piece)}" focusable="false">` +
    `<path d="${d}" fill-rule="evenodd" stroke-width="5" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

export { pieceName };
