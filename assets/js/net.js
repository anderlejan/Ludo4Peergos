/* Ludo4Peergos – Peergos app chat API (needs the EXCHANGE_MESSAGES_WITH_FRIENDS permission).
   v0 creates chats (Peergos' own "invite friends" dialog) and sends; v1 lists chats with members and
   reads messages with their authors. */
(function (root) {
  'use strict';
  const S = root.L4P.Storage;
  const V0 = '/peergos-api/v0/chat/';
  const V1 = '/peergos-api/v1/chat/';

  const enc = id => String(id).split('/').map(encodeURIComponent).join('/').replace(/%24/g, '$');

  /** Opens Peergos' friend picker and creates the chat. Resolves the chat id, or null when cancelled. */
  async function createGame(title, maxInvites) {
    const fd = new FormData();
    fd.append('title', title);
    fd.append('maxInvites', String(Math.max(1, Math.min(3, maxInvites | 0))));
    const r = await S.api(V0, { method: 'POST', body: fd }, { timeout: 0 }); // waits for the user in Peergos' friend picker
    if (r.status !== 201) return null;
    const id = r.location;
    return id && id.trim() ? id.trim() : null;
  }

  // Every chat call goes through the app's single Peergos API queue (Storage.api), shared with the data folder:
  // overlapping calls can make Peergos fail with "CAS exception updating cryptree node".
  const call = (path, init) => S.api(path, init);

  /**
   * [{chatId, title, members, admins, latest:{message, creationTime}}] for this app's chats.
   * Both lists are asked: v1 has the members but leaves out chats without a recent message (a game you just
   * joined can be one of them), v0 lists every chat of the app. A chat in either list is shown.
   */
  async function listGames() {
    const byId = new Map();
    let ok = 0, lastErr = null;
    try {
      const r = await S.api(V1, { method: 'GET', cache: 'no-store' }, { timeout: 12000 }); // can hang in Peergos, see storage.js
      if (!r.ok) throw new Error('chat list v1 → ' + r.status);
      const j = JSON.parse(r.text || '{}');
      const chats = j.chats || [], latest = j.latestMessages || [];
      chats.forEach((c, i) => { if (c && /^chat-[^$]+\$/.test(c.chatId)) byId.set(c.chatId, Object.assign({}, c, { latest: latest[i] || null })); });
      ok++;
    } catch (e) { lastErr = e; console.warn(e); }
    try {
      const r0 = await call(V0, { method: 'GET', cache: 'no-store' });
      if (!r0.ok) throw new Error('chat list v0 → ' + r0.status);
      for (const c of JSON.parse(r0.text || '[]')) {
        if (!c || !/^chat-[^$]+\$/.test(c.chatId) || byId.has(c.chatId)) continue;
        byId.set(c.chatId, { chatId: c.chatId, title: c.title, members: [], admins: [], latest: null });
      }
      ok++;
    } catch (e) { lastErr = e; console.warn(e); }
    if (!ok) throw lastErr || new Error('chat list failed');
    return Array.from(byId.values());
  }

  /**
   * Messages from index `from` on. Resolves {entries:[{type, author, text, timestamp, joinUsername, inviteUsername}], next, friends}.
   * Every call makes Peergos merge the other members' logs first (that is how new moves arrive).
   */
  // 0.6.0: far from the server a read can take 25 s and more (measured: +1.2 s per request → 25–27 s), so reads get
  // 90 s, and sends their own queue – in 0.5.0 a move waited behind a running read before it was even sent.
  async function read(chatId, from) {
    const r = await S.api(V1 + enc(chatId) + '?startIndex=' + (from | 0), { method: 'GET', cache: 'no-store' }, { queue: 'chat', timeout: 90000 });
    if (!r.ok) throw new Error('read → ' + r.status);
    const j = JSON.parse(r.text);
    const entries = (j.messages || []).map(m => ({
      type: m.type, author: m.author, text: m.text, timestamp: m.timestamp,
      joinUsername: m.joinUsername, inviteUsername: m.inviteUsername, removeUsername: m.removeUsername,
    }));
    const next = Number.isInteger(j.startIndex) ? j.startIndex : (from | 0) + entries.length;
    return { entries, next, friends: j.hasFriendsInChat };
  }

  async function send(chatId, text) {
    const r = await S.api(V0 + enc(chatId), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    }, { queue: 'chatSend', timeout: 60000 });
    if (r.status !== 201 && r.status !== 200) throw new Error('send → ' + r.status);
    return true;
  }

  async function remove(chatId) {
    const r = await call(V0 + enc(chatId), { method: 'DELETE' });
    return r.status === 204 || r.status === 200;
  }

  /** Queue of outgoing messages: sent one after another, retried with back-off, in order. */
  function Outbox(chatId, onState) {
    const q = [];
    let busy = false, failures = 0, timer = null;
    async function pump() {
      timer = null;
      if (busy || !q.length) { onState && onState(q.length ? 'sending' : 'idle'); return; }
      busy = true;
      onState && onState('sending');
      try {
        await send(chatId, q[0]);
        q.shift(); failures = 0;
      } catch (e) {
        failures++;
        onState && onState('offline');
        console.warn('send failed', e);
      }
      busy = false;
      if (q.length) timer = setTimeout(pump, failures ? Math.min(30000, 1000 * Math.pow(2, failures)) : 0);
      else onState && onState('idle');
    }
    return {
      push(text) { q.push(text); if (!busy && !timer) pump(); },
      get size() { return q.length; },
      get pendingTexts() { return q.slice(); },
    };
  }

  const Net = { available: S.PEERGOS, createGame, listGames, read, send, remove, Outbox };
  root.L4P.Net = Net;
})(window);
