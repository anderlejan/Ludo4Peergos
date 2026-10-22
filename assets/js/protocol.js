/* Ludo4Peergos – online protocol. Encodes game messages for a Peergos app chat and replays a chat log
   into a game state. Pure functions; runs in the browser and in Node. See docs/DESIGN.md. */
(function (root) {
  'use strict';
  const R = (root.L4P && root.L4P.Rules) || (typeof require !== 'undefined' ? require('./rules.js') : null);

  const PREFIX = 'L4P1 ';
  const PROTOCOL = 6; // 2 (app 0.2.0): speed, round, restartAsk/restartVote, rule selfKick
                     // 3 (app 0.3.0): leave, rule onePerSquare
                     // 4 (app 0.4.0): rules mustEnter and protectOwn (only setups that use them are stamped 4)
                     // 5 (app 0.5.0): rule safeBlock (safe squares together with one token per square)
                     // 6 (app 0.6.0): rule enterGrace (a 6 after bringing a token out does not kick it)

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
  /** A setup needs protocol 4 only when its rules use something a 0.3.0 app does not know (it would replay differently). */
  function setupNeeds(rules) {
    const r = rules || {};
    if (r.mustEnter && r.onePerSquare && r.enterGrace) return 6;
    if (r.onePerSquare && r.safeSquares && r.safeBlock) return 5;
    return r.mustEnter || (r.onePerSquare && r.protectOwn) ? 4 : 3;
  }
  function msg(kind, fields, appVersion) {
    const v = kind === 'setup' ? setupNeeds(fields && fields.rules) : (NEEDS[kind] || 2);
    return Object.assign({ v, a: appVersion || '', k: kind, id: randomId(10) }, fields);
  }

  /** A rule set suggested in the chat (0.7.0): only the numbered rules and the set's name are kept. */
  function cleanOffer(o) {
    if (!o || typeof o !== 'object' || !o.rules || typeof o.rules !== 'object' || !R || !R.RULE_ORDER) return null;
    const rules = {};
    for (const k of R.RULE_ORDER) if (k in o.rules && (typeof o.rules[k] === 'boolean' || typeof o.rules[k] === 'string')) rules[k] = o.rules[k];
    const out = { rules };
    if (typeof o.rulesSet === 'string') out.rulesSet = o.rulesSet.slice(0, 20);
    if (typeof o.rulesName === 'string' && o.rulesName.trim()) out.rulesName = o.rulesName.replace(/\s+/g, ' ').trim().slice(0, 40);
    return out;
  }

  /**
   * Plays the moves of one game (setup) found in msgs.
   * order: Map game id → index of its setup (a `leave` sent in an earlier round hands the seat over from move 0).
   * aliases: ids of setups this one replaced (rules changed before the first roll) – their resign/leave count here.
   */
  function playGame(setup, msgs, host, order, aliases) {
    const state0 = R.newGame(setup);
    let state = state0;
    const history = [];
    const resignedAt = [null, null, null, null];
    const handOver = (c, after) => { if (resignedAt[c] == null || after < resignedAt[c]) resignedAt[c] = after; };
    const myIndex = order && order.has(setup.g) ? order.get(setup.g) : -1;
    for (const m of msgs) {
      if (m.k === 'resign' && (m.g === setup.g || (aliases && aliases.has(m.g)))) {
        const c = m.c, seat = state0.seats[c];
        if (!Number.isInteger(c) || !seat || seat.kind !== 'human' || seat.user !== m.author) continue;
        handOver(c, m.g === setup.g && Number.isInteger(m.after) ? m.after : 0);
      } else if (m.k === 'leave' && m.author !== host) {
        // the player left the whole game (all rounds): the host's computer plays the seat
        let after;
        if (m.removed) { // Peergos removed the member: hand over after their last move in this game
          after = 0;
          for (const x of msgs) if (x.k === 'move' && x.g === setup.g && x.author === m.author && Number.isInteger(x.n) && x.n + 1 > after) after = x.n + 1;
        }
        else if (m.g === setup.g) after = Number.isInteger(m.after) ? m.after : 0;
        else if ((order && order.has(m.g) && order.get(m.g) < myIndex) || (aliases && aliases.has(m.g))) after = 0;
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
   * Returns {setup, state, history, says, unknown, seen, rounds, restart, resignedAt, controller, left, hostLeft, timeline,
   *          replaced, votes}.
   * replaced: Map g → g of the setup that replaced it (rules changed before the first roll, 0.7.0).
   * votes: {user: true|false} – players' answers to the rules of the current game (chat lines with rulesOk).
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
      // 0.7.0: a member who deleted their copy of the chat is removed by Peergos itself (the chat owner's app writes a
      // RemoveMember entry when the member's message log is gone) – that counts as leaving the game
      if (e.type === 'RemoveMember' && typeof e.removeUsername === 'string' && e.removeUsername) {
        const id = 'removed:' + e.removeUsername;
        if (!seen.has(id)) { seen.add(id); msgs.push({ v: 3, k: 'leave', id, removed: true, author: e.removeUsername, ts: e.timestamp }); }
        continue;
      }
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
    // 0.7.0: before the first roll the host may change the rules – a new setup of the same round that `replaces` the
    // previous one. The replaced setup is no round of its own; the chat shows which rules (numbers) changed, and what
    // was said for the replaced setup (a player handing over to the computer) holds for the new one.
    const byG = new Map(), replacedBy = new Map();
    setups.forEach(st => {
      if (typeof st.replaces === 'string' && byG.has(st.replaces) && !replacedBy.has(st.replaces)) replacedBy.set(st.replaces, st.g);
      if (!byG.has(st.g)) byG.set(st.g, st);
    });
    out.replaced = replacedBy;
    const aliasesOf = g => { const a = new Set(); let moved = true; while (moved) { moved = false; for (const [from, to] of replacedBy) if ((to === g || a.has(to)) && !a.has(from)) { a.add(from); moved = true; } } return a; };
    const played = new Map();
    const order = new Map();
    setups.forEach((st, k) => { if (!order.has(st.g)) order.set(st.g, k); });
    for (const st of setups) {
      if (played.has(st.g)) continue;
      try { played.set(st.g, playGame(st, msgs, host, order, aliasesOf(st.g))); } catch (e) { out.error = 'Bad setup: ' + e.message; }
    }
    // players who left the game (in log order); when the host leaves, the game ends for everybody
    out.left = [];
    for (const m of msgs) if (m.k === 'leave' && out.left.indexOf(m.author) < 0) out.left.push(m.author);
    out.hostLeft = out.left.indexOf(host) >= 0;
    for (let k = 0; k < setups.length; k++) {
      const st = setups[k], p = played.get(st.g);
      if (!p || replacedBy.has(st.g)) continue;
      out.rounds.push({ g: st.g, round: Number.isInteger(st.round) ? st.round : k + 1, over: p.state.over, winner: p.state.winner, finished: p.state.finished.slice(), seats: p.state.seats });
    }
    // chat lines and round starts in log order (the chat panel shows both)
    const roundOf = new Map(out.rounds.map(r => [r.g, r.round]));
    out.timeline = [];
    for (const m of msgs) {
      if (m.k === 'say' && typeof m.text === 'string') {
        const x = { kind: 'say', author: m.author, text: m.text.slice(0, 300), ts: m.ts, g: m.g };
        if (typeof m.rulesOk === 'boolean') x.rulesOk = m.rulesOk;
        const offer = cleanOffer(m.offer);
        if (offer) x.offer = offer;
        out.timeline.push(x);
      }
      else if (m.k === 'setup' && m.author === host && typeof m.replaces === 'string' && byG.has(m.replaces) && replacedBy.get(m.replaces) === m.g) {
        const before = byG.get(m.replaces);
        out.timeline.push({ kind: 'rules', author: m.author, g: m.g, round: Number.isInteger(m.round) ? m.round : null, ts: m.ts,
          changed: R && R.changedRules ? R.changedRules(before.rules, m.rules) : [] });
      }
      else if (m.k === 'setup' && m.author === host && (roundOf.has(m.g) || replacedBy.has(m.g))) out.timeline.push({ kind: 'round', round: roundOf.has(m.g) ? roundOf.get(m.g) : (Number.isInteger(m.round) ? m.round : 1), g: m.g });
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

    const isPlayer = u => setup.seats.some(s => s && s.kind === 'human' && s.user === u);
    // 0.7.0: what the players said about the rules of the current game (the last answer counts): {user: true|false}
    out.votes = {};
    for (const m of msgs) if (m.k === 'say' && m.g === setup.g && typeof m.rulesOk === 'boolean' && isPlayer(m.author)) out.votes[m.author] = m.rulesOk;

    // "new round?" – the latest question of the current game that nobody declined
    const needed = activeHumans(setup, cur.resignedAt);
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
