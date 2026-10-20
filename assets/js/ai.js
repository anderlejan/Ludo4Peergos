/* Ludo4Peergos – computer players. Pure functions; runs in the browser and in Node. */
(function (root) {
  'use strict';
  const R = (root.L4P && root.L4P.Rules) || (typeof require !== 'undefined' ? require('./rules.js') : null);

  /** How many opponent tokens could reach track cell `cell` with one roll (1..6), counting yard tokens on their start. */
  function threatsTo(state, color, cell) {
    let n = 0;
    for (let oc = 0; oc < 4; oc++) {
      if (oc === color || !state.seats[oc] || state.finished.indexOf(oc) >= 0) continue;
      for (const q of state.tokens[oc]) {
        if (q >= 0 && q <= R.LAST_TRACK) {
          for (let d = 1; d <= 6; d++) {
            const rel = q + d;
            if (rel <= R.LAST_TRACK && R.trackIndex(oc, rel) === cell) { n++; break; }
          }
        } else if (q === -1) {
          // A token entering on its start square threatens that square (with a 6).
          if (R.START[oc] === cell) n += 0.35;
        }
      }
    }
    return n;
  }

  function danger(state, color, rel) {
    if (rel < 0 || rel > R.LAST_TRACK) return 0;
    const cell = R.trackIndex(color, rel);
    if (R.protects(state.rules, cell)) return 0;
    return threatsTo(state, color, cell);
  }

  /** Scores one candidate move for the player to move. Higher is better. */
  function score(state, token, roll, level) {
    const c = state.turn;
    const { from, to } = R.target(state, token, roll);
    let s = 0;
    const caps = R.capturesAt(state, c, to);
    for (const [oc, j] of caps) s += 120 + state.tokens[oc][j] * 1.6; // hurting an advanced token is worth more
    if ((state.rules.selfKick || state.rules.onePerSquare) && to < R.FINISH) {
      for (let j = 0; j < 4; j++) if (j !== token && state.tokens[c][j] === to) s -= 75 + to * 1.6; // would send our own token home
    }
    if (from === -1) s += 70;
    if (to === R.FINISH) s += 90;
    else if (to > R.LAST_TRACK && from <= R.LAST_TRACK) s += 55;     // into the home column: safe for good
    const cellTo = to <= R.LAST_TRACK ? R.trackIndex(c, to) : -1;
    if (cellTo >= 0 && R.protects(state.rules, cellTo)) s += 22;
    s += to * 0.45;                                                   // general progress

    if (level !== 'easy') {
      const before = danger(state, c, from);
      const after = caps.length && state.rules.captureBonus ? danger(state, c, to) * 0.8 : danger(state, c, to);
      const worth = level === 'hard' ? (8 + Math.max(0, from) * 0.9) : 18;
      s += before * worth * (level === 'hard' ? 1.2 : 1);              // escaping a threat
      s -= after * worth * (level === 'hard' ? 1.35 : 1);              // walking into one
      if (level === 'hard') {
        // Keep a token sitting on its own start square only when it blocks nothing useful; prefer
        // spreading tokens rather than stacking them (a stack is lost together).
        for (let j = 0; j < 4; j++) if (j !== token && state.tokens[c][j] === to && to > 0 && to <= R.LAST_TRACK) s -= 6;
        // Chasing: landing just behind an opponent (1..6 squares) sets up a capture next turn.
        if (cellTo >= 0) {
          for (let oc = 0; oc < 4; oc++) {
            if (oc === c || !state.seats[oc]) continue;
            for (const q of state.tokens[oc]) {
              if (q < 0 || q > R.LAST_TRACK) continue;
              const cell = R.trackIndex(oc, q);
              const gap = (cell - cellTo + R.TRACK_LEN) % R.TRACK_LEN;
              if (gap >= 1 && gap <= 6 && !R.protects(state.rules, cell)) s += 7;
            }
          }
        }
      }
    }
    return s;
  }

  /**
   * Chooses a token to move. rnd = function returning [0,1). Returns -1 when no move is possible.
   */
  function choose(state, roll, level, rnd) {
    rnd = rnd || Math.random;
    const legal = R.legalMoves(state, roll);
    if (!legal.length) return -1;
    if (legal.length === 1) return legal[0];
    if (level === 'easy' && rnd() < 0.45) return legal[Math.floor(rnd() * legal.length)];
    let best = legal[0], bestScore = -Infinity;
    for (const t of legal) {
      // tiny random tie-breaker so identical scores don't always pick the lowest index
      const sc = score(state, t, roll, level) + rnd() * 0.01;
      if (sc > bestScore) { bestScore = sc; best = t; }
    }
    return best;
  }

  const AI = { choose, score, threatsTo, danger };
  root.L4P = root.L4P || {};
  root.L4P.AI = AI;
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
})(typeof window !== 'undefined' ? window : globalThis);
