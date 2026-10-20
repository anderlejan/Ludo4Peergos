#!/usr/bin/env python3
"""Probe on a LOCAL Peergos server: when does Peergos show "CAS exception updating cryptree node" around app starts?
Records every /peergos-api request of the app (time, method, path), Peergos' own console errors and error toasts.
  python3 tests/peergos/probe_cas.py --user bob [--cycles 3]"""
import argparse, json, os, sys, time
sys.argv, _argv = [sys.argv[0], '--zip', 'x'], sys.argv
sys.path.insert(0, os.path.dirname(__file__))
import e2e
from e2e import login, launch, close_app
from playwright.sync_api import sync_playwright
sys.argv = _argv
ap = argparse.ArgumentParser(); ap.add_argument('--user', default='bob'); ap.add_argument('--cycles', type=int, default=3); ap.add_argument('--gap', type=float, default=0); ap.add_argument('--ingame', action='store_true')
A = ap.parse_args()
T0 = time.time()
ev = []
def log(kind, text): ev.append((round(time.time() - T0, 2), kind, text[:220]))
with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={'width': 1440, 'height': 900})
    ctx.add_init_script("""if (window.top === window) { new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) {
      const t = (n.textContent || ''); if (/CAS exception/i.test(t)) console.log('TOAST ' + t.slice(0, 120)); } }).observe(document, {childList: true, subtree: true}); }""")
    pg = ctx.new_page()
    ctx.on('request', lambda r: log('req', r.method + ' ' + r.url.split('/peergos-api/')[1]) if '/peergos-api/' in r.url else None)
    ctx.on('requestfinished', lambda r: log('done', r.method + ' ' + r.url.split('/peergos-api/')[1]) if '/peergos-api/' in r.url else None)
    pg.on('console', lambda m: log('console', m.text) if ('CAS' in m.text or 'TOAST' in m.text or m.type == 'error') else None)
    login(pg, A.user)
    log('mark', 'logged in')
    for k in range(A.cycles):
        log('mark', 'launch %d' % k)
        f = launch(pg)
        if A.ingame:  # open the newest online game, so the app polls the chat when it is closed
            pg.wait_for_timeout(4000)
            f.evaluate("L4P.App.set({pollMs: 600})")
            f.evaluate("document.querySelector('#games-list .game-card[data-chat]').click()")
            log('mark', 'opened game')
            pg.wait_for_timeout(15000)
        else:
            pg.wait_for_timeout(45000)
        log('mark', 'close %d' % k)
        close_app(pg)
        if A.gap: pg.wait_for_timeout(A.gap * 1000)
    br.close()
for e in ev:
    if e[1] in ('mark', 'console') or 'chat' in e[2] or 'data' in e[2]:
        print('%7.2f %-7s %s' % e)
