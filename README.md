# Quarto

A browser implementation of [Quarto](https://en.wikipedia.org/wiki/Quarto_(board_game)) — the
4×4 game where you never choose your own piece. Two players at one screen, or a minimax
computer opponent at three strengths.

No build step, no dependencies. Plain ES modules, an SVG board, and a search that runs in a
Web Worker.

## Run it

```sh
npm start          # http://localhost:5173
npm test           # engine + AI test suite
```

The app needs to be served over HTTP (ES modules and the Web Worker will not load from
`file://`). `npm start` runs a ~40 line static server from `server.mjs`; any static host works
just as well, and the whole thing deploys as-is to GitHub Pages or similar.

## The rules, briefly

Sixteen pieces, each **tall or short**, **light or dark**, **round or square**, **solid or
hollow** — every combination appears exactly once.

You choose a piece and hand it to your opponent; they place it anywhere on the board, then
choose the piece you must play. You win by placing the fourth piece of a row, column or
diagonal whose four pieces share at least one attribute. Turn on the **2×2 variant** and any
2×2 block counts too. A full board with no line is a draw.

Completed lines are detected and highlighted automatically, so nobody has to remember to call
"Quarto!"

## Difficulty

| Level | Behaviour |
| --- | --- |
| Easy | Plays at random about half the time — it *will* hand you a winning piece — but always takes a win it is handed |
| Medium | Never hands over a winning piece, and always searches at least three plies, which is the depth that sees the standard two-move trap. Goes deeper when the clock allows, and picks randomly among near-equal moves |
| Hard | Iterative deepening on a 2.6 s budget, no deliberate slack, and solves the endgame outright |

Each level declares a `minDepth` that ignores the time budget. That floor is what turns
medium's behaviour into a guarantee rather than something that holds only on a fast machine —
`test/ai.test.mjs` checks it with the budget set to 1 ms.

## How the search works

A Quarto "move" is a pair — place the piece you were handed, then choose one for your
opponent. Both halves belong to the same player, so `src/ai.js` flattens them into a single
max node and runs negamax with alpha-beta over the pair.

Two properties of the game do most of the pruning:

- If the piece in your hand completes a line, that is immediately the best possible move — no
  further search needed.
- Handing over a piece that lets the opponent win at once is exactly a loss, so those
  hand-offs are scored directly instead of searched. If *every* remaining piece is such a
  piece, the position is simply lost.

`threats()` in `src/engine.js` reduces each three-piece line to a pair of bitmasks, so
"which pieces are dangerous to hand over?" is a handful of bit operations per piece rather
than a board scan. Where the search runs out of depth, positions are valued by how many of
the remaining pieces are still safe to hand over — the real pressure in Quarto.

Iterative deepening with a transposition table keeps the whole thing inside its time budget
and returns the best move from the last completed depth.

## Layout

```
index.html        markup and the two dialogs
styles.css        design tokens, light + dark themes
src/engine.js     rules: pieces, lines, win detection, threat masks (pure, no DOM)
src/game.js       turn/phase state machine (select -> place -> select ...)
src/ai.js         negamax + alpha-beta, difficulty presets
src/worker.js     runs the search off the main thread
src/pieces.js     one <path> per piece, hollow pieces via fill-rule: evenodd
src/main.js       rendering and input
test/             node:test suite for the engine and the AI
server.mjs        dependency-free static server for `npm start`
```

Pieces are encoded as integers 0–15, one bit per attribute, which makes the win condition a
single expression: four pieces share an attribute when `a & b & c & d` or
`~a & ~b & ~c & ~d` has any of the low four bits set.
