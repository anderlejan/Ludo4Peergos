/* Ludo4Peergos – storage: the app's private Peergos data folder (/peergos-api/v0/data/...) with a
   localStorage copy for an instant start. Outside Peergos only localStorage is used. */
(function (root) {
  'use strict';
  const url = new URL(root.location.href);
  const PEERGOS = url.searchParams.has('username') && url.searchParams.has('pgi');
  const DATA = '/peergos-api/v0/data/';
  const LS = 'l4p.';

  function lsGet(k, d) { try { const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function lsDel(k) { try { localStorage.removeItem(LS + k); } catch (e) { /* ignore */ } }

  // ONE queue for every Peergos API call of this app (data folder AND chat, see net.js): Peergos changes the user's
  // encrypted tree for each of them, and overlapping calls can fail with "CAS exception updating cryptree node"
  // (seen with Peergos 1.39 when chat reads/sends and data writes overlapped). The body is read inside the queued step.
  let chain = Promise.resolve();
  function api(path, init) {
    const step = async () => {
      const r = await fetch(path, init);
      const text = await r.text();
      return { ok: r.ok, status: r.status, text, location: r.headers.get('location') };
    };
    const run = chain.then(step, step);
    chain = run.catch(() => {});
    return run;
  }

  async function getJSON(path) {
    if (!PEERGOS) return undefined;
    const r = await api(DATA + path, { method: 'GET', cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('GET ' + path + ' → ' + r.status);
    const text = r.text;
    if (!text.trim()) return null;
    return JSON.parse(text);
  }

  async function putText(path, text) {
    if (!PEERGOS) return false;
    const r = await api(DATA + path, { method: 'PUT', body: new TextEncoder().encode(text) });
    if (!(r.status === 200 || r.status === 201 || r.status === 204)) throw new Error('PUT ' + path + ' → ' + r.status);
    return true;
  }

  /**
   * A JSON document that is written at most once per `delay` ms, never twice at the same time,
   * always with its newest value. onStatus('saving'|'saved'|'error').
   */
  function Doc(path, delay, onStatus) {
    let pending = null, timer = null, running = false, retry = 0;
    const status = s => { try { onStatus && onStatus(s); } catch (e) { /* ignore */ } };
    async function flush() {
      timer = null;
      if (running || pending == null) return;
      running = true;
      const value = pending; pending = null;
      try {
        await putText(path, JSON.stringify(value, null, 1));
        retry = 0;
        status(pending == null ? 'saved' : 'saving');
      } catch (e) {
        if (pending == null) pending = value;      // keep the newest value for the retry
        retry = Math.min(retry + 1, 6);
        status('error');
        console.warn('save failed', path, e);
        timer = setTimeout(flush, 1000 * Math.pow(2, retry));
      }
      running = false;
      if (pending != null && !timer) timer = setTimeout(flush, delay);
    }
    return {
      set(value) {
        pending = value;
        if (!PEERGOS) { status('saved'); pending = null; return; }
        status('saving');
        if (!timer && !running) timer = setTimeout(flush, delay);
      },
      flushNow() { if (timer) { clearTimeout(timer); timer = null; } return flush(); },
      get busy() { return running || pending != null; },
    };
  }

  const Storage = { PEERGOS, api, getJSON, putText, Doc, lsGet, lsSet, lsDel, username: url.searchParams.get('username') || '' };
  root.L4P = root.L4P || {};
  root.L4P.Storage = Storage;
})(window);
