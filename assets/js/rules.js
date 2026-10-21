/* Ludo4Peergos – board geometry and the pure game engine. Runs in the browser and in Node (tests). */
(function (root) {
  'use strict';

  const COLORS = ['red', 'green', 'yellow', 'blue'];
  const START = [0, 13, 26, 39];          // track index of each colour's start square
  const FINISH = 56;                       // relative position of a finished token
  const LAST_TRACK = 50;                   // last relative position on the shared track
  const TRACK_LEN = 52;

  // The 52 shared squares, clockwise, as [col, row] on a 15 x 15 grid, starting at Red's start square.
  const TRACK = (function () {
    const t = [];
    const push = (c, r) => t.push([c, r]);
    for (let c = 1; c <= 5; c++) push(c, 6);
    for (let r = 5; r >= 0; r--) push(6, r);
    push(7, 0); push(8, 0);
    for (let r = 1; r <= 5; r++) push(8, r);
    for (let c = 9; c <= 14; c++) push(c, 6);
    push(14, 7); push(14, 8);
    for (let c = 13; c >= 9; c--) push(c, 8);
    for (let r = 9; r <= 14; r++) push(8, r);
    push(7, 14); push(6, 14);
    for (let r = 13; r >= 9; r--) push(6, r);
    for (let c = 5; c >= 0; c--) push(c, 8);
    push(0, 7); push(0, 6);
    return t;
  })();

  // Home columns (relative positions 51..55) per colour.
  const HOME_COL = [
    [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
    [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
    [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
    [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  ];
  // Yard corner (top-left cell of the 6 x 6 yard) per colour.
  const YARD = [[0, 0], [9, 0], [9, 9], [0, 9]];
  // Where the four tokens wait in the yard (cell coordinates, fractional = centre of the spot).
  const YARD_SPOTS = YARD.map(([c, r]) => [[c + 2, r + 2], [c + 4, r + 2], [c + 2, r + 4], [c + 4, r + 4]]);
  // Where finished tokens sit in the centre triangle of their colour.
  const CENTER_SPOTS = [
    [[6.3, 7.17], [6.3, 7.83], [6.7, 7.3], [6.7, 7.7]],
    [[7.17, 6.3], [7.83, 6.3], [7.3, 6.7], [7.7, 6.7]],
    [[8.7, 7.17], [8.7, 7.83], [8.3, 7.3], [8.3, 7.7]],
    [[7.17, 8.7], [7.83, 8.7], [7.3, 8.3], [7.7, 8.3]],
  ];
  const STARS = [8, 21, 34, 47];
  const SAFE = START.concat(STARS);

  const DEFAULT_RULES = Object.freeze({
    enterOn: 'six',          // 'six' | 'oneOrSix'
    sixBonus: true,          // a 6 gives another roll
    threeSixes: true,        // the third 6 in a row ends the turn
    captureBonus: true,      // a capture gives another roll
    finishBonus: true,       // a token reaching home gives another roll
    safeSquares: true,       // start squares and stars protect tokens
    threeTries: true,        // up to 3 rolls while no token is out of the yard
    endMode: 'first',        // 'first' = the first player home wins | 'all' = play on for all places
    onePerSquare: false,     // one token per square for everybody: landing on ANY token (own or opponent) sends it to
                             // its yard; safe squares do not protect then (so the same rule holds for all tokens)
    selfKick: false,         // legacy (0.2.0): only own tokens are kicked; kept so old games replay the same way
    mustEnter: false,        // 0.4.0: a 6 must bring a token out of the yard while one is there (even onto an own token)
    protectOwn: false,       // 0.4.0: with onePerSquare, a move may not land on an own token (only a forced entry does);
                             // not a visible option – every game started by 0.4.0+ sets it, older games stay without it
  });

  function normalizeRules(r) {
    const out = Object.assign({}, DEFAULT_RULES);
    if (r && typeof r === 'object') {
      for (const k of Object.keys(DEFAULT_RULES)) {
        if (!(k in r)) continue;
        const def = DEFAULT_RULES[k];
        if (typeof def === 'boolean') out[k] = !!r[k];
        else if (k === 'enterOn') out[k] = r[k] === 'oneOrSix' ? 'oneOrSix' : 'six';
        else if (k === 'endMode') out[k] = r[k] === 'all' ? 'all' : 'first';
      }
    }
    return out;
  }

  function normalizeSeat(s) {
    if (!s || typeof s !== 'object') return null;
    const kind = ['human', 'bot', 'local'].includes(s.kind) ? s.kind : null;
    if (!kind) return null;
    const seat = { kind };
    if (s.user != null) seat.user = String(s.user).slice(0, 64);
    seat.name = String(s.name != null ? s.name : (s.user || '')).slice(0, 40);
    if (kind === 'bot') seat.level = ['easy', 'normal', 'hard'].includes(s.level) ? s.level : 'normal';
    return seat;
  }

  function activeColors(state) {
    const a = [];
    for (let c = 0; c < 4; c++) if (state.seats[c]) a.push(c);
    return a;
  }

  /** A new game. setup = {seats: [4 x seat|null], rules, first} */
  function newGame(setup) {
    const seats = [0, 1, 2, 3].map(i => normalizeSeat(setup && setup.seats && setup.seats[i]));
    const count = seats.filter(Boolean).length;
    if (count < 2) throw new Error('A game needs at least two players');
    const state = {
      rules: normalizeRules(setup && setup.rules),
      seats,
      tokens: [0, 1, 2, 3].map(() => [-1, -1, -1, -1]),
      turn: 0, sixes: 0, tries: 0, n: 0,
      finished: [], over: false, winner: null,
      last: null,
    };
    let first = setup && Number.isInteger(setup.first) ? setup.first : 0;
    if (first < 0 || first > 3 || !seats[first]) first = activeColors(state)[0];
    state.turn = first;
    return state;
  }

  function clone(state) {
    return {
      rules: state.rules, seats: state.seats,
      tokens: state.tokens.map(t => t.slice()),
      turn: state.turn, sixes: state.sixes, tries: state.tries, n: state.n,
      finished: state.finished.slice(), over: state.over, winner: state.winner,
      last: state.last,
    };
  }

  const trackIndex = (color, rel) => (START[color] + rel) % TRACK_LEN;
  const isSafeCell = idx => SAFE.indexOf(idx) >= 0;
  /** True when a token on track cell `idx` cannot be captured under these rules. */
  const protects = (rules, idx) => !!(rules && rules.safeSquares && !rules.onePerSquare && isSafeCell(idx));

  /** Grid position [col,row] of a token of `color` at relative position `rel` (token index for yard/centre spots). */
  function cellOf(color, rel, tokenIndex) {
    if (rel < 0) return YARD_SPOTS[color][tokenIndex || 0];
    if (rel <= LAST_TRACK) { const [c, r] = TRACK[trackIndex(color, rel)]; return [c + 0.5, r + 0.5]; }
    if (rel < FINISH) { const [c, r] = HOME_COL[color][rel - LAST_TRACK - 1]; return [c + 0.5, r + 0.5]; }
    return CENTER_SPOTS[color][tokenIndex || 0];
  }

  function tokensOut(state, color) {
    return state.tokens[color].some(p => p >= 0 && p < FINISH);
  }

  /** Would this roll be the forfeiting third six? */
  function isThirdSix(state, roll) {
    return state.rules.threeSixes && roll === 6 && state.sixes === 2;
  }

  /** Token indexes the player to move may move with `roll`. */
  function legalMoves(state, roll) {
    if (state.over) return [];
    if (isThirdSix(state, roll)) return [];
    const c = state.turn, out = [], r = state.rules, mine = state.tokens[c];
    // "a 6 must bring a token out": the only moves are the tokens in the yard (an own token on the start square goes back)
    if (r.mustEnter && roll === 6) {
      const yard = [0, 1, 2, 3].filter(i => mine[i] === -1);
      if (yard.length) return yard;
    }
    const canEnter = roll === 6 || (r.enterOn === 'oneOrSix' && roll === 1);
    const ownBlocks = to => r.onePerSquare && r.protectOwn && to < FINISH && mine.some(q => q === to);
    for (let i = 0; i < 4; i++) {
      const p = mine[i];
      if (p === -1) { if (canEnter && !ownBlocks(0)) out.push(i); }
      else if (p < FINISH && p + roll <= FINISH && !ownBlocks(p + roll)) out.push(i);
    }
    return out;
  }

  /** Where token i of the player to move ends up with `roll` (and the steps on the way). */
  function target(state, i, roll) {
    const p = state.tokens[state.turn][i];
    if (p === -1) return { from: -1, to: 0, path: [0] };
    const path = [];
    for (let s = p + 1; s <= p + roll; s++) path.push(s);
    return { from: p, to: p + roll, path };
  }

  /** Opponent tokens that would be captured if a token of `color` lands on relative position `rel`. */
  function capturesAt(state, color, rel) {
    if (rel < 0 || rel > LAST_TRACK) return [];
    const cell = trackIndex(color, rel);
    if (protects(state.rules, cell)) return [];
    const hits = [];
    for (let oc = 0; oc < 4; oc++) {
      if (oc === color || !state.seats[oc]) continue;
      for (let j = 0; j < 4; j++) {
        const q = state.tokens[oc][j];
        if (q >= 0 && q <= LAST_TRACK && trackIndex(oc, q) === cell) hits.push([oc, j]);
      }
    }
    return hits;
  }

  function nextColor(state, from) {
    for (let k = 1; k <= 4; k++) {
      const c = (from + k) % 4;
      if (state.seats[c] && state.finished.indexOf(c) < 0) return c;
    }
    return from;
  }

  /**
   * Applies one action {r: roll 1..6, t: token index or -1 for "no move"} for the player to move.
   * Returns {state, events} or throws on an illegal action. The input state is not changed.
   */
  function apply(state, action) {
    if (state.over) throw new Error('The game is over');
    const r = action && action.r, t = action && action.t;
    if (!Number.isInteger(r) || r < 1 || r > 6) throw new Error('Bad roll');
    if (!Number.isInteger(t) || t < -1 || t > 3) throw new Error('Bad token');
    const legal = legalMoves(state, r);
    if (t === -1 ? legal.length > 0 : legal.indexOf(t) < 0) throw new Error('Illegal move');

    const s = clone(state);
    const c = s.turn;
    const events = [];
    const hadOut = tokensOut(state, c);
    let extra = false, captured = [], reachedHome = false, colorDone = false, move = null;

    if (isThirdSix(state, r)) {
      events.push({ type: 'threeSixes', color: c });
      s.sixes = 0;
    } else {
      s.sixes = r === 6 ? s.sixes + 1 : 0;
      if (t >= 0) {
        move = target(state, t, r);
        s.tokens[c][t] = move.to;
        events.push({ type: 'move', color: c, token: t, from: move.from, to: move.to, path: move.path });
        captured = capturesAt(state, c, move.to);
        for (const [oc, j] of captured) {
          events.push({ type: 'capture', color: c, victim: oc, token: j, from: s.tokens[oc][j] });
          s.tokens[oc][j] = -1;
        }
        if ((s.rules.selfKick || s.rules.onePerSquare) && move.to >= 0 && move.to < FINISH) {
          for (let j = 0; j < 4; j++) {
            if (j !== t && s.tokens[c][j] === move.to) {
              events.push({ type: 'selfCapture', color: c, token: j, from: move.to });
              s.tokens[c][j] = -1;
            }
          }
        }
        if (move.to === FINISH) {
          reachedHome = true;
          events.push({ type: 'home', color: c, token: t });
          if (s.tokens[c].every(p => p === FINISH)) {
            colorDone = true;
            s.finished.push(c);
            events.push({ type: 'finished', color: c, place: s.finished.length });
          }
        }
      } else {
        events.push({ type: 'pass', color: c });
      }
      if (!colorDone) {
        extra = (r === 6 && s.rules.sixBonus) || (captured.length > 0 && s.rules.captureBonus) ||
          (reachedHome && s.rules.finishBonus);
      }
    }

    // Game end
    const remaining = activeColors(s).filter(x => s.finished.indexOf(x) < 0);
    if (colorDone && (s.rules.endMode === 'first' || remaining.length <= 1)) {
      if (s.rules.endMode === 'all') for (const x of remaining) s.finished.push(x);
      s.over = true;
      s.winner = s.finished[0];
      events.push({ type: 'over', winner: s.winner, order: s.finished.slice() });
    }

    // Who plays next
    let triesLeft = false;
    if (!s.over) {
      if (!extra && t === -1 && !hadOut && s.rules.threeTries && !isThirdSix(state, r)) {
        s.tries = state.tries + 1;
        triesLeft = s.tries < 3;
      }
      if (extra || triesLeft) {
        if (extra) s.tries = 0;
        if (extra) events.push({ type: 'again', color: c });
      } else {
        s.turn = nextColor(s, c);
        s.sixes = 0; s.tries = 0;
        events.push({ type: 'turn', color: s.turn });
      }
    }
    s.n = state.n + 1;
    s.last = { color: c, roll: r, token: t, from: move ? move.from : null, to: move ? move.to : null, captured };
    return { state: s, events };
  }

  /** Total progress 0..1 of a colour (for the side panel). */
  function progress(state, color) {
    let sum = 0;
    for (const p of state.tokens[color]) sum += p < 0 ? 0 : p + 1;
    return sum / (4 * (FINISH + 1));
  }

  /** Rebuilds a state from a setup and a list of actions (local saved games). */
  function replay(setup, actions) {
    let s = newGame(setup);
    for (const a of actions || []) s = apply(s, a).state;
    return s;
  }

  const Rules = {
    COLORS, START, FINISH, LAST_TRACK, TRACK, TRACK_LEN, HOME_COL, YARD, YARD_SPOTS, CENTER_SPOTS, STARS, SAFE,
    DEFAULT_RULES, normalizeRules, normalizeSeat, newGame, clone, legalMoves, target, capturesAt, apply, cellOf,
    trackIndex, isSafeCell, protects, tokensOut, activeColors, nextColor, progress, replay, isThirdSix,
  };
  root.L4P = root.L4P || {};
  root.L4P.Rules = Rules;
  if (typeof module !== 'undefined' && module.exports) module.exports = Rules;
})(typeof window !== 'undefined' ? window : globalThis);
