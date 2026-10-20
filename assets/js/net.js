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
    const r = await fetch(V0, { method: 'POST', body: fd });
    if (r.status !== 201) return null;
    const id = r.headers.get('location');
    return id && id.trim() ? id.trim() : null;
  }

  /** [{chatId, title, members, admins, latest:{message, creationTime}}] for this app's chats. */
  async function listGames() {
    const r = await fetch(V1, { method: 'GET', cache: 'no-store' });
    if (r.ok) {
      const j = JSON.parse(await r.text() || '{}');
      const chats = j.chats || [], latest = j.latestMessages || [];
      const out = chats.map((c, i) => Object.assign({}, c, { latest: latest[i] || null }));
      // v1 lists chats whose id starts with chat-<app>; keep only real app chats ($ after the name)
      return out.filter(c => /^chat-[^$]+\$/.test(c.chatId));
    }
    const r0 = await fetch(V0, { method: 'GET', cache: 'no-store' });
    if (!r0.ok) throw new Error('chat list → ' + r0.status);
    return JSON.parse(await r0.text() || '[]').map(c => ({ chatId: c.chatId, title: c.title, members: [], admins: [], latest: null }));
  }

  /**
   * Messages from index `from` on. Resolves {entries:[{type, author, text, timestamp, joinUsername, inviteUsername}], next, friends}.
   * Every call makes Peergos merge the other members' logs first (that is how new moves arrive).
   */
  async function read(chatId, from) {
    const r = await fetch(V1 + enc(chatId) + '?startIndex=' + (from | 0), { method: 'GET', cache: 'no-store' });
    if (!r.ok) throw new Error('read → ' + r.status);
    const j = JSON.parse(await r.text());
    const entries = (j.messages || []).map(m => ({
      type: m.type, author: m.author, text: m.text, timestamp: m.timestamp,
      joinUsername: m.joinUsername, inviteUsername: m.inviteUsername, removeUsername: m.removeUsername,
    }));
    const next = Number.isInteger(j.startIndex) ? j.startIndex : (from | 0) + entries.length;
    return { entries, next, friends: j.hasFriendsInChat };
  }

  async function send(chatId, text) {
    const r = await fetch(V0 + enc(chatId), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
    if (r.status !== 201 && r.status !== 200) throw new Error('send → ' + r.status);
    return true;
  }

  async function remove(chatId) {
    const r = await fetch(V0 + enc(chatId), { method: 'DELETE' });
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
