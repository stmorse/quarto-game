// Runs the search off the main thread so the board stays responsive.
import { chooseMove } from './ai.js';

self.onmessage = (e) => {
  const { id, board, piece, avail, level, useSquares } = e.data;
  try {
    const move = chooseMove({ board, piece, avail, level, useSquares });
    self.postMessage({ id, move });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
