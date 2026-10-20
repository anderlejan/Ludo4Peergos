/* Ludo4Peergos – online protocol. Encodes game messages for a Peergos app chat and replays a chat log
   into a game state. Pure functions; runs in the browser and in Node. See docs/DESIGN.md. */
(function (root) {
  'use strict';
  const R = (root.L4P && root.L4P.Rules) || (typeof require !== 'undefined' ? require('./rules.js') : null);

  const PREFIX = 'L4P1 ';
  const PROTOCOL = 3; // 2 (app 0.2.0): speed, round, restartAsk/restartVote, rule selfKick
                     // 3 (app 0.3.0): leave, rule onePerSquare

  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function randomId(len) {
    const a = new Uint8Array(len || 9);
    (root.crypto || globalThis.crypto).getRandomValues(a);
    return Array.from(a, b => (b % 36).toString(36)).join('');
  }

  function encode(obj) { return PREFIX + b64urlEncode(JSON.stringify(obj)); }

  function decode(text) {
    if (typeof text !== 'string' || !text.startsWith(PREFIX)) return null;
    try {
      const o = JSON.parse(b64urlDecode(text.slice(PREFIX.length).trim()));
      if (!o || typeof o !== 'object' || typeof o.k !== 'string' || typeof o.id !== 'string') return null;
      return o;
    } catch (e) { return null; }
  }

  /** Owner (host) of an app chat: chat-<app>$<owner>$<uuid> */
  function chatOwner(chatId) {
    const s = String(chatId || '');
    const a = s.indexOf('$');
    if (a < 0) return null;
    const b = s.indexOf('$', a + 1);
    return b < 0 ? null : s.substring(a + 1, b);
  }

  // Each message carries the lowest protocol that understands it, so a 0.3.0 player can still play in a game an older
  // app started (moves, chat, new-round votes are protocol 2). New games (setup) and `leave` need protocol 3.
  const NEEDS = { setup: 3, leave: 3 };
  function msg(kind, fields, appVersion) {
    return Object.assign({ v: NEEDS[kind] || 2, a: appVersion || '', k: kind, id: randomId(10) }, fields);
  }

  /**
   * Plays the moves of one game (setup) found in msgs.
   * order: Map game id → index of its setup (a `leave` sent in an earlier round hands the seat over from move 0).
   */
  function playGame(setup, msgs, host, order) {
    const state0 = R.newGame(setup);
    let state = state0;
    const history = [];
    const resignedAt = [null, null, null, null];
    const handOver = (c, after) => { if (resignedAt[c] == null || after < resignedAt[c]) resignedAt[c] = after; };
    const myIndex = order && order.has(setup.g) ? order.get(setup.g) : -1;
    for (const m of msgs) {
      if (m.k === 'resign' && m.g === setup.g) {
        const c = m.c, seat = state0.seats[c];
        if (!Number.isInteger(c) || !seat || seat.kind !== 'human' || seat.user !== m.author) continue;
        handOver(c, Number.isInteger(m.after) ? m.after : 0);
      } else if (m.k === 'leave' && m.author !== host) {
        // the player left the whole game (all rounds): the host's computer plays the seat
        let after;
        if (m.g === setup.g) after = Number.isInteger(m.after) ? m.after : 0;
        else if (order && order.has(m.g) && order.get(m.g) < myIndex) after = 0;
        else continue;
        state0.seats.forEach((seat, c) => { if (seat && seat.kind === 'human' && seat.user === m.author) handOver(c, after); });
      }
    }
    const controller = (c, n) => {
      const seat = state0.seats[c];
      if (!seat) return null;
      if (seat.kind === 'bot') return host;
      if (resignedAt[c] != null && n >= resignedAt[c]) return host;
      return seat.user;
    };
    const pool = msgs.filter(m => m.k === 'move' && m.g === setup.g && Number.isInteger(m.n));
    let progressed = true;
    while (progressed && !state.over) {
      progressed = false;
      for (let i = 0; i < pool.length; i++) {
        const m = pool[i];
        if (m.n !== state.n || m.c !== state.turn) continue;
        if (m.author !== controller(m.c, m.n)) continue;
        let res;
        try { res = R.apply(state, { r: m.r, t: m.t }); } catch (e) { continue; }
        history.push({ action: { r: m.r, t: m.t }, events: res.events, author: m.author, n: m.n, c: m.c, id: m.id });
        state = res.state;
        pool.splice(i, 1);
        progressed = true;
        break;
      }
    }
    return { state, history, resignedAt, controller };
  }

  /** Human players of a setup who still play themselves (not handed over to the computer). */
  function activeHumans(setup, resignedAt) {
    const out = [];
    (setup.seats || []).forEach((s, c) => { if (s && s.kind === 'human' && s.user && (!resignedAt || resignedAt[c] == null) && out.indexOf(s.user) < 0) out.push(s.user); });
    return out;
  }

  /**
   * Replays a chat log. entries: [{author, text}] in this member's log order.
   * Returns {setup, state, history, says, unknown, seen, rounds, restart, resignedAt, controller, left, hostLeft, timeline}.
   * history: [{action, events, author, n, c}] of the current game (= the host's last setup).
   * rounds: [{g, round, over, winner, finished}] of every game in this chat, oldest first.
   * restart: the open "new round?" question of the current game, or null:
   *   {id, author, votes: {user: true|false}, needed: [users], complete, declinedBy}
   */
  function replay(entries, host) {
    const seen = new Set();
    const msgs = [];
    const says = [];
    let unknown = 0;
    for (const e of entries || []) {
      const m = decode(e.text);
      if (!m) continue;
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      if (m.v > PROTOCOL) { unknown++; continue; }
      m.author = e.author;
      m.ts = e.timestamp;
      if (m.k === 'say' && typeof m.text === 'string') says.push({ author: e.author, text: m.text.slice(0, 300), ts: e.timestamp, g: m.g });
      msgs.push(m);
    }
    const setups = msgs.filter(m => m.k === 'setup' && m.author === host && typeof m.g === 'string');
    const out = { setup: null, state: null, history: [], says, unknown, seen, error: null, rounds: [], restart: null, setups };
    const played = new Map();
    const order = new Map();
    setups.forEach((st, k) => { if (!order.has(st.g)) order.set(st.g, k); });
    for (const st of setups) {
      if (played.has(st.g)) continue;
      try { played.set(st.g, playGame(st, msgs, host, order)); } catch (e) { out.error = 'Bad setup: ' + e.message; }
    }
    // players who left the game (in log order); when the host leaves, the game ends for everybody
    out.left = [];
    for (const m of msgs) if (m.k === 'leave' && out.left.indexOf(m.author) < 0) out.left.push(m.author);
    out.hostLeft = out.left.indexOf(host) >= 0;
    for (let k = 0; k < setups.length; k++) {
      const st = setups[k], p = played.get(st.g);
      if (!p) continue;
      out.rounds.push({ g: st.g, round: Number.isInteger(st.round) ? st.round : k + 1, over: p.state.over, winner: p.state.winner, finished: p.state.finished.slice(), seats: p.state.seats });
    }
    // chat lines and round starts in log order (the chat panel shows both)
    const roundOf = new Map(out.rounds.map(r => [r.g, r.round]));
    out.timeline = [];
    for (const m of msgs) {
      if (m.k === 'say' && typeof m.text === 'string') out.timeline.push({ kind: 'say', author: m.author, text: m.text.slice(0, 300), ts: m.ts });
      else if (m.k === 'setup' && m.author === host && roundOf.has(m.g)) out.timeline.push({ kind: 'round', round: roundOf.get(m.g), g: m.g });
      else if (m.k === 'leave' && out.timeline.every(x => !(x.kind === 'left' && x.author === m.author))) out.timeline.push({ kind: 'left', author: m.author, host: m.author === host, ts: m.ts });
    }
    const setup = setups.length ? setups[setups.length - 1] : null;
    if (!setup || !played.get(setup.g)) return out;
    const cur = played.get(setup.g);
    out.setup = setup;
    out.state = cur.state;
    out.history = cur.history;
    out.resignedAt = cur.resignedAt;
    out.controller = cur.controller;

    // "new round?" – the latest question of the current game that nobody declined
    const needed = activeHumans(setup, cur.resignedAt);
    const isPlayer = u => setup.seats.some(s => s && s.kind === 'human' && s.user === u);
    let ask = null;
    for (const m of msgs) if (m.k === 'restartAsk' && m.g === setup.g && isPlayer(m.author)) ask = m;
    if (ask && !out.hostLeft) {
      const votes = {};
      votes[ask.author] = true;
      let declinedBy = null;
      for (const m of msgs) {
        if (m.k !== 'restartVote' || m.ask !== ask.id || !isPlayer(m.author)) continue;
        if (m.yes === false) { declinedBy = m.author; votes[m.author] = false; }
        else if (votes[m.author] !== false) votes[m.author] = true;
      }
      const complete = !declinedBy && needed.every(u => votes[u] === true);
      out.restart = { id: ask.id, author: ask.author, votes, needed, complete, declinedBy };
    }
    return out;
  }

  const Protocol = { PREFIX, PROTOCOL, encode, decode, replay, playGame, activeHumans, chatOwner, msg, randomId, b64urlEncode, b64urlDecode };
  root.L4P = root.L4P || {};
  root.L4P.Protocol = Protocol;
  if (typeof module !== 'undefined' && module.exports) module.exports = Protocol;
})(typeof window !== 'undefined' ? window : globalThis);
