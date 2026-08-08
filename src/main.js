// UI layer: renders the board, tray and hand, and drives the computer opponent.

import { CELLS, PIECES, has, pieceName } from './engine.js';
import { canPlace, canSelect, newGame, place, select } from './game.js';
import { pieceSVG } from './pieces.js';
import { chooseMove } from './ai.js';

const STORE_KEY = 'quarto:v1';

const el = {
  board: document.getElementById('board'),
  tray: document.getElementById('tray'),
  trayCount: document.getElementById('tray-count'),
  hand: document.getElementById('hand'),
  hint: document.getElementById('hint'),
  status: document.getElementById('status'),
  turnbar: document.getElementById('turnbar'),
  modeBadge: document.getElementById('mode-badge'),
  undo: document.getElementById('undo-btn'),
  newgame: document.getElementById('newgame-btn'),
  theme: document.getElementById('theme'),
  setup: document.getElementById('setup'),
  rules: document.getElementById('rules'),
};

const settings = loadSettings();
let state = null;
let history = [];
let thinking = false;
let worker = null;
let jobId = 0;
const pending = new Map();

/* ------------------------------------------------------------------ setup */

function loadSettings() {
  const base = { mode: 'cpu', level: 'medium', first: 0, useSquares: false, theme: 'dark' };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
  } catch {
    return base;
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {
    /* private browsing — settings just won't persist */
  }
}

function isAI(player) {
  return settings.mode === 'cpu' && player === 1;
}

function playerName(player) {
  if (settings.mode === 'cpu') return player === 0 ? 'You' : 'Computer';
  return player === 0 ? 'Player 1' : 'Player 2';
}

/* ------------------------------------------------------------------ worker */

function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const job = pending.get(e.data.id);
      if (!job) return;
      pending.delete(e.data.id);
      if (e.data.error) job.reject(new Error(e.data.error));
      else job.resolve(e.data.move);
    };
    worker.onerror = () => {
      worker = false; // fall back to the main thread from here on
      for (const [, job] of pending) job.reject(new Error('worker failed'));
      pending.clear();
    };
  } catch {
    worker = false;
  }
  return worker;
}

function think(board, piece, avail) {
  const w = getWorker();
  const req = { board: Int8Array.from(board), piece, avail, level: settings.level, useSquares: settings.useSquares };
  if (!w) return Promise.resolve(chooseMove(req));
  const id = ++jobId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, ...req });
  }).catch(() => chooseMove(req));
}

/* ------------------------------------------------------------------ render */

function buildBoard() {
  el.board.innerHTML = Array.from({ length: CELLS }, (_, i) => {
    const r = Math.floor(i / 4) + 1;
    const c = (i % 4) + 1;
    return `<button class="cell" type="button" data-cell="${i}" aria-label="Row ${r}, column ${c}"></button>`;
  }).join('');
}

function buildTray() {
  el.tray.innerHTML = Array.from(
    { length: PIECES },
    (_, p) =>
      `<button class="slot" type="button" data-piece="${p}" title="${pieceName(p)}" aria-label="${pieceName(p)}">` +
      pieceSVG(p) +
      `</button>`,
  ).join('');
}

function render() {
  const placing = state.status === 'playing' && state.phase === 'place';
  const selecting = state.status === 'playing' && state.phase === 'select';
  const humanTurn = state.status === 'playing' && !isAI(state.turn) && !thinking;

  el.board.classList.toggle('placing', placing && humanTurn);
  el.board.classList.toggle('over', state.status !== 'playing');

  for (const cell of el.board.children) {
    const i = Number(cell.dataset.cell);
    const p = state.board[i];
    const filled = p >= 0;
    const wanted = filled ? pieceSVG(p) : placing && state.hand >= 0 ? pieceSVG(state.hand, { className: 'ghost' }) : '';
    if (cell.dataset.render !== wanted) {
      cell.innerHTML = wanted;
      cell.dataset.render = wanted;
      if (filled && i === state.lastCell) cell.firstChild?.classList.add('drop');
    }
    cell.classList.toggle('filled', filled);
    cell.classList.toggle('last', filled && i === state.lastCell);
    cell.classList.toggle('win', !!state.winLine && state.winLine.includes(i));
    cell.disabled = !(humanTurn && canPlace(state, i));
  }

  for (const slot of el.tray.children) {
    const p = Number(slot.dataset.piece);
    const inPool = has(state.avail, p);
    slot.classList.toggle('taken', !inPool);
    slot.classList.toggle('inhand', p === state.hand);
    slot.disabled = !(humanTurn && canSelect(state, p));
  }

  const left = countBits(state.avail);
  el.trayCount.textContent = `${left} left`;

  el.hand.innerHTML = state.hand >= 0 ? pieceSVG(state.hand) : '<span class="empty-slot" aria-hidden="true"></span>';
  el.hand.classList.toggle('has-piece', state.hand >= 0);
  const showName = state.status === 'playing' && state.hand >= 0;
  el.hint.className = 'hint' + (showName ? ' piece-name' : '');
  el.hint.textContent = showName
    ? pieceName(state.hand)
    : state.status === 'playing' && selecting
      ? 'Pick the piece your opponent must play'
      : '';

  for (const chip of el.turnbar.children) {
    const p = Number(chip.dataset.player);
    chip.querySelector('.pname').textContent = playerName(p);
    chip.classList.toggle('active', state.status === 'playing' && state.turn === p);
    chip.classList.toggle('winner', state.status === 'win' && state.winner === p);
  }

  el.status.className = 'status' + (state.status !== 'playing' ? ' final' : '');
  el.status.textContent = statusText();
  const mode = settings.mode === 'cpu' ? `vs Computer · ${settings.level}` : 'Two players';
  el.modeBadge.textContent = state.useSquares ? `${mode} · 2×2` : mode;

  el.undo.disabled = !history.length || thinking;
}

function statusText() {
  if (state.status === 'win') {
    if (settings.mode === 'cpu') return state.winner === 0 ? 'Quarto! You win.' : 'Quarto! The computer wins.';
    return `Quarto! ${playerName(state.winner)} wins.`;
  }
  if (state.status === 'draw') return 'Board full — a draw.';
  if (thinking) return 'Computer is thinking…';

  const selecting = state.phase === 'select';
  if (settings.mode === 'cpu') {
    if (state.turn === 0) return selecting ? 'Choose a piece for the computer' : 'Place your piece';
    return selecting ? 'The computer is choosing your piece' : 'The computer is placing';
  }
  const who = playerName(state.turn);
  return selecting ? `${who} — choose a piece for ${playerName(1 - state.turn)}` : `${who} — place the piece`;
}

function countBits(n) {
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
}

/* ------------------------------------------------------------------- moves */

function commit(next) {
  history.push(state);
  if (history.length > 64) history.shift();
  state = next;
}

function onSelect(piece) {
  if (thinking || !canSelect(state, piece) || isAI(state.turn)) return;
  commit(select(state, piece));
  render();
  drive();
}

function onPlace(cell) {
  if (thinking || !canPlace(state, cell) || isAI(state.turn)) return;
  commit(place(state, cell));
  render();
  drive();
}

function undo() {
  if (thinking || !history.length) return;
  do {
    state = history.pop();
  } while (history.length && (isAI(state.turn) || state.status !== 'playing'));
  render();
  drive();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Hand control to the computer whenever it is on turn. */
async function drive() {
  if (thinking || state.status !== 'playing' || !isAI(state.turn)) return;
  thinking = true;
  render();
  try {
    const started = Date.now();
    if (state.phase === 'place') {
      const move = await think(state.board, state.hand, state.avail);
      await wait(Math.max(0, 260 - (Date.now() - started)));
      commit(place(state, move.cell));
      render();
      if (state.status === 'playing') {
        await wait(420);
        const give = has(state.avail, move.give) ? move.give : firstAvailable(state.avail);
        commit(select(state, give));
      }
    } else {
      const move = await think(state.board, -1, state.avail);
      await wait(Math.max(0, 300 - (Date.now() - started)));
      const give = has(state.avail, move.give) ? move.give : firstAvailable(state.avail);
      commit(select(state, give));
    }
  } finally {
    thinking = false;
  }
  render();
  drive();
}

function firstAvailable(avail) {
  for (let p = 0; p < PIECES; p++) if (has(avail, p)) return p;
  return -1;
}

/* --------------------------------------------------------------- overlays */

function openOverlay(node) {
  node.hidden = false;
  requestAnimationFrame(() => node.classList.add('open'));
}

function closeOverlay(node) {
  node.classList.remove('open');
  setTimeout(() => {
    node.hidden = true;
  }, 180);
}

function syncSetup() {
  for (const group of el.setup.querySelectorAll('.segmented')) {
    const key = group.dataset.group;
    for (const b of group.children) {
      b.classList.toggle('on', String(settings[key]) === b.dataset.value);
    }
  }
  document.getElementById('squares-toggle').checked = settings.useSquares;
  const cpu = settings.mode === 'cpu';
  document.getElementById('field-level').hidden = !cpu;
  const first = document.getElementById('field-first');
  first.querySelectorAll('button')[0].textContent = cpu ? 'You' : 'Player 1';
  first.querySelectorAll('button')[1].textContent = cpu ? 'Computer' : 'Player 2';
}

function startGame() {
  state = newGame({ useSquares: settings.useSquares, first: Number(settings.first) });
  history = [];
  thinking = false;
  render();
  drive();
}

/* ----------------------------------------------------------------- wiring */

el.board.addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (cell) onPlace(Number(cell.dataset.cell));
});

el.tray.addEventListener('click', (e) => {
  const slot = e.target.closest('.slot');
  if (slot) onSelect(Number(slot.dataset.piece));
});

el.undo.addEventListener('click', undo);

el.newgame.addEventListener('click', () => {
  syncSetup();
  openOverlay(el.setup);
});

document.getElementById('setup-cancel').addEventListener('click', () => closeOverlay(el.setup));
document.getElementById('setup-start').addEventListener('click', () => {
  saveSettings();
  closeOverlay(el.setup);
  startGame();
});

el.setup.addEventListener('click', (e) => {
  const btn = e.target.closest('.segmented button');
  if (btn) {
    const key = btn.parentElement.dataset.group;
    settings[key] = key === 'first' ? Number(btn.dataset.value) : btn.dataset.value;
    syncSetup();
    return;
  }
  if (e.target === el.setup) closeOverlay(el.setup);
});

document.getElementById('squares-toggle').addEventListener('change', (e) => {
  settings.useSquares = e.target.checked;
});

document.getElementById('rules-btn').addEventListener('click', () => openOverlay(el.rules));
document.getElementById('rules-close').addEventListener('click', () => closeOverlay(el.rules));
el.rules.addEventListener('click', (e) => {
  if (e.target === el.rules) closeOverlay(el.rules);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!el.setup.hidden) closeOverlay(el.setup);
  if (!el.rules.hidden) closeOverlay(el.rules);
});

el.theme.addEventListener('click', () => {
  settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = settings.theme;
  saveSettings();
});

/* ------------------------------------------------------------------- boot */

document.documentElement.dataset.theme = settings.theme;
buildBoard();
buildTray();
startGame();
syncSetup();
