/* Ludo4Peergos – online protocol. Encodes game messages for a Peergos app chat and replays a chat log
   into a game state. Pure functions; runs in the browser and in Node. See docs/DESIGN.md. */
(function (root) {
  'use strict';
  const R = (root.L4P && root.L4P.Rules) || (typeof require !== 'undefined' ? require('./rules.js') : null);

  const PREFIX = 'L4P1 ';
  const PROTOCOL = 1;

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

  function msg(kind, fields, appVersion) {
    return Object.assign({ v: PROTOCOL, a: appVersion || '', k: kind, id: randomId(10) }, fields);
  }

  /**
   * Replays a chat log. entries: [{author, text}] in this member's log order.
   * Returns {setup, state, history, says, joined, unknown, seen}.
   * history: [{action, events, author, n}] of the current game.
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
    let setup = null;
    for (const m of msgs) if (m.k === 'setup' && m.author === host && typeof m.g === 'string') setup = m;
    const out = { setup, state: null, history: [], says, unknown, seen, error: null };
    if (!setup) return out;
    let state;
    try { state = R.newGame(setup); } catch (e) { out.error = 'Bad setup: ' + e.message; return out; }

    const resignedAt = [null, null, null, null];
    for (const m of msgs) {
      if (m.k !== 'resign' || m.g !== setup.g) continue;
      const c = m.c, seat = state.seats[c];
      if (!Number.isInteger(c) || !seat || seat.kind !== 'human' || seat.user !== m.author) continue;
      const after = Number.isInteger(m.after) ? m.after : 0;
      if (resignedAt[c] == null || after < resignedAt[c]) resignedAt[c] = after;
    }
    const controller = (c, n) => {
      const seat = state.seats[c];
      if (!seat) return null;
      if (seat.kind === 'bot') return host;
      if (resignedAt[c] != null && n >= resignedAt[c]) return host;
      return seat.user;
    };

    let pool = msgs.filter(m => m.k === 'move' && m.g === setup.g && Number.isInteger(m.n));
    let progressed = true;
    while (progressed && !state.over) {
      progressed = false;
      for (let i = 0; i < pool.length; i++) {
        const m = pool[i];
        if (m.n !== state.n || m.c !== state.turn) continue;
        if (m.author !== controller(m.c, m.n)) continue;
        let res;
        try { res = R.apply(state, { r: m.r, t: m.t }); } catch (e) { continue; }
        out.history.push({ action: { r: m.r, t: m.t }, events: res.events, author: m.author, n: m.n, c: m.c, id: m.id });
        state = res.state;
        pool.splice(i, 1);
        progressed = true;
        break;
      }
    }
    out.state = state;
    out.resignedAt = resignedAt;
    out.controller = controller;
    return out;
  }

  const Protocol = { PREFIX, PROTOCOL, encode, decode, replay, chatOwner, msg, randomId, b64urlEncode, b64urlDecode };
  root.L4P = root.L4P || {};
  root.L4P.Protocol = Protocol;
  if (typeof module !== 'undefined' && module.exports) module.exports = Protocol;
})(typeof window !== 'undefined' ? window : globalThis);
