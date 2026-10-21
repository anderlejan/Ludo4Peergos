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

  /** One request; the whole body is read. Rejects after `ms` (0 = no limit) – Peergos can leave a request unanswered
   *  for good (e.g. its chat list when one chat fails to load: no error path in AppSandbox.vue). */
  function request(path, init, ms) {
    const go = (async () => {
      const r = await fetch(path, init);
      const text = await r.text();
      return { ok: r.ok, status: r.status, text, location: r.headers.get('location') };
    })();
    if (!ms) return go;
    let timer;
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Peergos did not answer: ' + path)), ms); });
    return Promise.race([go, limit]).finally(() => clearTimeout(timer));
  }

  // Queues: calls of one kind run one at a time – 'chat' (every chat call, see net.js) and 'data' (writes to the app's
  // data folder). 0.4.0: two separate queues and a time limit on every call. In 0.3.0 one shared queue without a limit
  // let a single call that Peergos never answered (its chat list can do that) stop everything behind it – e.g. the
  // Notes window, which waits for its data file. Reads of the app's own data files do not queue at all.
  const chains = {};
  const TIMEOUT = 30000;
  function api(path, init, opts) {
    const ms = opts && opts.timeout != null ? opts.timeout : TIMEOUT;
    const q = (opts && opts.queue) || 'chat';
    const step = () => request(path, init, ms);
    const run = (chains[q] || Promise.resolve()).then(step, step);
    chains[q] = run.catch(() => {});
    return run;
  }

  async function getJSON(path, opts) {
    if (!PEERGOS) return undefined;
    const r = await request(DATA + path, { method: 'GET', cache: 'no-store' }, (opts && opts.timeout) || TIMEOUT);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('GET ' + path + ' → ' + r.status);
    const text = r.text;
    if (!text.trim()) return null;
    return JSON.parse(text);
  }

  async function putText(path, text) {
    if (!PEERGOS) return false;
    const r = await api(DATA + path, { method: 'PUT', body: new TextEncoder().encode(text) }, { queue: 'data' });
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
