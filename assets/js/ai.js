/* Ludo4Peergos – computer players. Pure functions; runs in the browser and in Node.

   Levels (0.7.0) – see docs/DESIGN.md "Computer players":
   - easy:   plays mostly by chance and would rather not capture – an opponent a small child can beat.
   - normal: looks at its own move (strategies below, one move deep): captures, runs from danger, uses safe squares,
             brings tokens out and home.
   - hard:   weighs every move by its effect on everybody's chance to win: the race standing, which tokens are in
             danger (and from whom, in turn order), what the next player can roll and will likely do. So it attacks a
             player who is about to win, chases when it is behind, plays safe when it is ahead, and never spends a turn
             on a token that cannot change the outcome.

   Every strategy reads the rules through the engine (legal moves, captures, safe squares, extra rolls, entering,
   end of game), so the computer plays every rule set by its rules. */
(function (root) {
  'use strict';
  const R = (root.L4P && root.L4P.Rules) || (typeof require !== 'undefined' ? require('./rules.js') : null);

  // ───────────────────────── shared helpers ─────────────────────────

  /** Moves that end in the same place are the same move (e.g. two tokens in the yard): keep one of each. */
  function distinctMoves(state, legal) {
    const seen = new Set(), out = [];
    for (const t of legal) { const p = state.tokens[state.turn][t]; if (!seen.has(p)) { seen.add(p); out.push(t); } }
    return out;
  }

  /** Active colours from the player to move on, in turn order (finished colours left out). */
  function turnOrder(state) {
    const seq = [];
    for (let k = 0; k < 4; k++) {
      const c = (state.turn + k) % 4;
      if (state.seats[c] && state.finished.indexOf(c) < 0) seq.push(c);
    }
    return seq;
  }

  // ───────────────────────── strategy: safety (who can hit a token, and how likely) ─────────────────────────

  /** How many opponent tokens could reach track cell `cell` with one roll (1..6), counting yard tokens on their start.
   *  (Used by the one-move heuristic.) */
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
          if (R.START[oc] === cell) n += 0.35; // a token entering on its start square threatens that square (with a 6)
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

  /**
   * Probability that token j of colour X (on the track) is captured before X can move it again – by each other
   * colour's roll, as the rules allow: exact rolls 1..6, a 6 and then the rest (with "a 6 gives another roll"),
   * a token entering onto its start square; a 6 that must bring a token out cannot be used to capture; safe squares
   * protect. Colours that move before X count fully, the others less (X may move away first).
   */
  function hitChance(state, X, j, pos) {
    const rules = state.rules, p = state.tokens[X][j];
    if (p < 0 || p > R.LAST_TRACK) return 0;
    const cell = R.trackIndex(X, p);
    const safe = R.protects(rules, cell);
    let miss = 1;
    for (let Y = 0; Y < 4; Y++) {
      if (Y === X || pos[Y] == null) continue;
      const yt = state.tokens[Y];
      const yard = yt.indexOf(-1) >= 0;
      const forced6 = !!(rules.mustEnter && yard);
      let rolls = 0, combo = 0;
      if (yard && cell === R.START[Y] && (!safe || (rules.onePerSquare && rules.safeBlock))) {
        rolls |= 1 << 6;
        if (rules.enterOn === 'oneOrSix') rolls |= 1 << 1;
      }
      if (!safe) {
        const rel = (cell - R.START[Y] + R.TRACK_LEN) % R.TRACK_LEN; // the square on Y's way round the board
        if (rel <= R.LAST_TRACK) {
          for (const q of yt) {
            if (q < 0 || q > R.LAST_TRACK) continue;
            const k = rel - q;
            if (k >= 1 && k <= 6) { if (!(forced6 && k === 6)) rolls |= 1 << k; }
            else if (k >= 7 && k <= 12 && rules.sixBonus && !forced6) combo += 1 / 36;
          }
        }
      }
      if (!rolls && !combo) continue;
      let direct = 0;
      for (let k = 1; k <= 6; k++) if (rolls & (1 << k)) direct++;
      const pY = Math.min(1, direct / 6 + combo) * TUNE.chance; // a player does not always take the capture
      const w = pos[Y] < pos[X] ? 1 : TUNE.later;
      miss *= 1 - w * pY;
    }
    return 1 - miss;
  }

  // ───────────────────────── strategy: race (who is ahead, by how much) ─────────────────────────

  // "Solitaire" race: the expected number of rolls a colour needs to bring its tokens home when nobody gets in its way –
  // with the exact roll needed at the end (larger rolls are lost), the entering roll, and (one token per square) own tokens
  // blocking each other. Exact (dynamic programming) for the three tokens furthest from home; the nearest token adds its
  // distance / 3.5. Distances: 0 = home, 1..56 = on the board (56 = start square), 57 = yard.
  const V = 58;
  const tables = {};
  function exactTable(enterOne, blockOwn) {
    const key = (enterOne ? 1 : 0) + (blockOwn ? 2 : 0);
    if (tables[key]) return tables[key];
    const E = new Float32Array(V * V * V);
    const at = (a, b, c) => {
      let t;
      if (a > b) { t = a; a = b; b = t; }
      if (b > c) { t = b; b = c; c = t; }
      if (a > b) { t = a; a = b; b = t; }
      return E[(a * V + b) * V + c];
    };
    const ds = [0, 0, 0];
    for (let sum = 1; sum <= 3 * 57; sum++) {
      for (let a = 0; a <= 57; a++) {
        for (let b = a; b <= 57; b++) {
          const c = sum - a - b;
          if (c < b || c > 57) continue;
          ds[0] = a; ds[1] = b; ds[2] = c;
          let tot = 0, stay = 0;
          for (let r = 1; r <= 6; r++) {
            let best = Infinity;
            for (let i = 0; i < 3; i++) {
              const d = ds[i];
              if (d === 0 || (i > 0 && d === ds[i - 1])) continue;
              let nd;
              if (d === 57) { if (!(r === 6 || (enterOne && r === 1))) continue; nd = 56; }
              else { if (r > d) continue; nd = d - r; }
              if (blockOwn && nd > 0 && ((i !== 0 && ds[0] === nd) || (i !== 1 && ds[1] === nd) || (i !== 2 && ds[2] === nd))) continue;
              const e = i === 0 ? at(nd, b, c) : i === 1 ? at(a, nd, c) : at(a, b, nd);
              if (e < best) best = e;
            }
            if (best === Infinity) stay++; else tot += best;
          }
          E[(a * V + b) * V + c] = stay >= 6 ? 999 : (1 + tot / 6) / (1 - stay / 6);
        }
      }
    }
    return (tables[key] = E);
  }
  /** Expected rolls of the solitaire race for a colour's four tokens (positions as in the game state). */
  function soloRolls(K, tokens) {
    const d = tokens.map(p => (p === R.FINISH ? 0 : p < 0 ? 57 : R.FINISH - p)).sort((x, y) => x - y);
    const near = d[0] === 57 ? 56 / 3.5 + 1 : d[0] / 3.5;
    return K.table[(d[1] * V + d[2]) * V + d[3]] + near;
  }

  // Tuned with thousands of computer games (tests/unit.test.js has the checks): depth 2 = the next player's roll and
  // reply, and my own next roll in a two-player game or after a bonus roll; blend = weight of the one-move heuristic
  // (keeps its tactics where the evaluation sees no difference); chance / later / varBase: see hitChance and raceOf.
  const TUNE = { depth: 2, blend: 0.0003, chance: 0.9, later: 0.45, varBase: 25 };

  /** Numbers that follow from the rules: rolls per turn, chance to bring a token out, tries, the race table. */
  function raceParams(rules) {
    return {
      rpt: rules.sixBonus ? (rules.threeSixes ? 1 + 1 / 6 + 1 / 36 : 1.2) : 1,
      enterP: rules.enterOn === 'oneOrSix' ? 1 / 3 : 1 / 6,
      tries: rules.threeTries ? 3 : 1,
      table: exactTable(rules.enterOn === 'oneOrSix', !!(rules.onePerSquare && rules.protectOwn)),
    };
  }

  /** Expected number of turns until a colour has all four tokens home, and how uncertain that is ({mu, v} in turns). */
  function raceOf(K, tokens) {
    if (tokens.every(p => p === R.FINISH)) return { mu: 0, v: 0.01 };
    const rolls = soloRolls(K, tokens);
    let mu = rolls / K.rpt;
    // nothing on the board: the rolls spent waiting for the entering number come several per turn (three tries)
    if (!tokens.some(p => p >= 0 && p < R.FINISH)) { const wait = 1 / K.enterP; mu += wait / K.tries - wait / K.rpt; }
    return { mu, v: (0.24 * rolls + TUNE.varBase) / (K.rpt * K.rpt) };
  }

  /**
   * How good `tokens` (all colours) is for colour `me`, 0..1: the chance to win ("first home wins") or the expected share
   * of opponents beaten ("play for all places"). Race times are compared pairwise (logistic), the player to move first
   * has a small head start.
   */
  function utility(K, state, me, tokens, pos, seq) {
    const n = seq.length;
    if (pos[me] == null) return 1; // finished
    const mu = [], v = [];
    for (const c of seq) { const r = raceOf(K, tokens[c]); mu[c] = r.mu + pos[c] / n; v[c] = r.v; }
    const before = (a, b) => 1 / (1 + Math.exp(-1.7 * (mu[b] - mu[a]) / Math.sqrt(v[a] + v[b])));
    if (state.rules.endMode === 'all') {
      const others = state.seats.filter(Boolean).length - 1;
      let beat = 0;
      for (const d of seq) if (d !== me) beat += before(me, d);
      return others > 0 ? beat / others : 1;
    }
    let mine = 0, sum = 0;
    for (const c of seq) {
      let w = 1;
      for (const d of seq) if (d !== c) w *= before(c, d);
      sum += w;
      if (c === me) mine = w;
    }
    return sum > 0 ? mine / sum : 0;
  }

  /** The value of a finished game for `me`. */
  function terminal(state, me) {
    if (state.rules.endMode === 'all') {
      const k = state.finished.indexOf(me), n = state.seats.filter(Boolean).length;
      return k < 0 || n < 2 ? 0 : (n - 1 - k) / (n - 1);
    }
    return state.winner === me ? 1 : 0;
  }

  /**
   * Evaluation of a position for `me` (strategies combined): the race standing, plus every token in danger – the
   * position as it would be after that capture, weighted by its chance. This is what makes the computer chase the
   * last token of a player who is about to win, or keep its own leading token out of reach.
   */
  function evaluate(state, me, K) {
    if (state.over) return terminal(state, me);
    K = K || raceParams(state.rules);
    const seq = turnOrder(state), pos = [];
    seq.forEach((c, k) => { pos[c] = k; });
    const u0 = utility(K, state, me, state.tokens, pos, seq);
    let u = u0;
    for (const X of seq) {
      for (let j = 0; j < 4; j++) {
        const h = hitChance(state, X, j, pos);
        if (h < 0.002) continue;
        const tk = state.tokens.slice();
        tk[X] = tk[X].slice(); tk[X][j] = -1;
        u += h * (utility(K, state, me, tk, pos, seq) - u0);
      }
    }
    return u;
  }

  // ───────────────────────── level "normal": the one-move heuristic ─────────────────────────

  /** Scores one candidate move for the player to move, looking at this move only. Higher is better. */
  function score(state, token, roll) {
    const c = state.turn;
    const { from, to } = R.target(state, token, roll);
    let s = 0;
    const caps = R.capturesAt(state, c, to);
    for (const [oc, j] of caps) s += 120 + state.tokens[oc][j] * 1.6; // hurting an advanced token is worth more
    if ((state.rules.selfKick || state.rules.onePerSquare) && to < R.FINISH) {
      for (let j = 0; j < 4; j++) if (j !== token && state.tokens[c][j] === to) s -= 75 + to * 1.6; // own token would go home
    }
    if (from === -1) s += 70;
    if (to === R.FINISH) s += 90;
    else if (to > R.LAST_TRACK && from <= R.LAST_TRACK) s += 55; // into the home column: safe for good
    const cellTo = to <= R.LAST_TRACK ? R.trackIndex(c, to) : -1;
    if (cellTo >= 0 && R.protects(state.rules, cellTo)) s += 22;
    s += to * 0.45; // general progress
    const before = danger(state, c, from);
    const after = caps.length && state.rules.captureBonus ? danger(state, c, to) * 0.8 : danger(state, c, to);
    const worth = 8 + Math.max(0, from) * 0.9;
    s += before * worth * 1.2; // escaping a threat
    s -= after * worth * 1.35; // walking into one
    // spread tokens rather than stacking them (a stack is lost together)
    for (let j = 0; j < 4; j++) if (j !== token && state.tokens[c][j] === to && to > 0 && to <= R.LAST_TRACK) s -= 6;
    // chasing: landing just behind an opponent (1..6 squares) sets up a capture next turn
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
    return s;
  }

  function chooseNormal(state, roll, legal, rnd) {
    let best = legal[0], bestScore = -Infinity;
    for (const t of legal) {
      const sc = score(state, t, roll) + rnd() * 0.01; // tiny random tie-breaker
      if (sc > bestScore) { bestScore = sc; best = t; }
    }
    return best;
  }

  // ───────────────────────── level "easy" ─────────────────────────

  /** Mostly a random move; otherwise the token that gets furthest – and it would rather not capture. */
  function chooseEasy(state, roll, legal, rnd) {
    if (rnd() < 0.6) return legal[Math.floor(rnd() * legal.length)];
    let best = legal[0], bs = -Infinity;
    for (const t of legal) {
      const { to } = R.target(state, t, roll);
      let s = Math.max(0, to) + rnd() * 6;
      if (R.capturesAt(state, state.turn, to).length) s -= 40;
      if (s > bs) { bs = s; best = t; }
    }
    return best;
  }

  // ───────────────────────── level "hard": look at the next rolls ─────────────────────────

  /** The value of a position after my move: the next player (me again after a bonus roll) rolls 1..6 and picks the
   *  move that is best for them; the result is evaluated for me. */
  function lookahead(state, me, K, depth) {
    if (state.over) return terminal(state, me);
    const Y = state.turn;
    let total = 0;
    for (let r = 1; r <= 6; r++) {
      const legal = R.legalMoves(state, r);
      let next = null;
      if (!legal.length) next = R.apply(state, { r, t: -1 }).state;
      else {
        let bestV = -Infinity;
        for (const t of distinctMoves(state, legal)) {
          const s2 = R.apply(state, { r, t }).state;
          const v = evaluate(s2, Y, K);
          if (v > bestV) { bestV = v; next = s2; }
        }
      }
      total += depth > 1 && !next.over && (next.turn === me || Y === me) ? lookahead(next, me, K, depth - 1) : evaluate(next, me, K);
    }
    return total / 6;
  }

  function chooseHard(state, roll, legal, rnd) {
    const me = state.turn, K = raceParams(state.rules);
    let best = legal[0], bestV = -Infinity, bestTie = -Infinity;
    for (const t of distinctMoves(state, legal)) {
      const s1 = R.apply(state, { r: roll, t }).state;
      const tie = score(state, t, roll) + rnd() * 0.01; // equal values (e.g. a lost cause): the heuristic decides
      const v = lookahead(s1, me, K, TUNE.depth) + TUNE.blend * tie;
      const eps = 1e-9 * Math.max(1e-6, Math.abs(v), Math.abs(bestV === -Infinity ? 0 : bestV));
      if (v > bestV + eps || (Math.abs(v - bestV) <= eps && tie > bestTie)) { bestV = v; bestTie = tie; best = t; }
    }
    return best;
  }

  const LEVELS = { easy: chooseEasy, normal: chooseNormal, hard: chooseHard };

  /**
   * Chooses a token to move. rnd = function returning [0,1). Returns -1 when no move is possible.
   */
  function choose(state, roll, level, rnd) {
    rnd = rnd || Math.random;
    const legal = R.legalMoves(state, roll);
    if (!legal.length) return -1;
    if (legal.length === 1) return legal[0];
    return (LEVELS[level] || chooseNormal)(state, roll, legal, rnd);
  }

  const AI = { TUNE, choose, score, threatsTo, danger, hitChance, evaluate, utility, raceParams, raceOf, soloRolls, exactTable, LEVELS: Object.keys(LEVELS) };
  root.L4P = root.L4P || {};
  root.L4P.AI = AI;
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
})(typeof window !== 'undefined' ? window : globalThis);
