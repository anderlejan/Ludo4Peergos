#!/usr/bin/env python3
"""Probe on a LOCAL Peergos server: does closing and reopening the app during a running online game make Peergos
show "CAS exception updating cryptree node"? alice hosts (with computer players), bob joins, then bob closes and
reopens his app N times while alice's app keeps playing. Prints toast times relative to bob's close/launch marks.
  python3 tests/peergos/probe_cas_game.py [--cycles 6]"""
import argparse, os, sys, time
sys.argv, _argv = [sys.argv[0], '--zip', 'x'], sys.argv
sys.path.insert(0, os.path.dirname(__file__))
import e2e
from e2e import login, launch, close_app, goto_view, wait, VUE, app_frame
from playwright.sync_api import sync_playwright
sys.argv = _argv
ap = argparse.ArgumentParser(); ap.add_argument('--cycles', type=int, default=6); ap.add_argument('--play', type=float, default=12)
A = ap.parse_args()
T0 = time.time()
ev = []
def log(who, kind, text): ev.append((round(time.time() - T0, 2), who, kind, text[:160]))
INIT = """if (window.top === window) { new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) {
  const t = (n.textContent || ''); if (/CAS exception|concurrent modification/i.test(t)) console.log('TOAST ' + t.slice(0, 100)); } }).observe(document, {childList: true, subtree: true}); }"""
FAST = "L4P.App.set({anim: 'instant', autoRoll: true, autoMove: true, sound: false, pollMs: 600, confirmLeave: false})"
with sync_playwright() as p:
    br = p.chromium.launch()
    pages = {}
    for u in ('alice', 'bob'):
        ctx = br.new_context(viewport={'width': 1440, 'height': 900})
        ctx.add_init_script(INIT)
        pg = ctx.new_page()
        pg.on('console', lambda m, u=u: log(u, 'TOAST', m.text) if 'TOAST' in m.text else None)
        login(pg, u)
        pages[u] = pg
    a, b = pages['alice'], pages['bob']
    fa = launch(a); fa.evaluate(FAST)
    fa.click('#act-friends'); fa.wait_for_selector('.dlg-new')
    fa.click('.seat-row:nth-child(2) .seg-btn:has-text("Computer")')
    fa.click('.seat-row:nth-child(4) .seg-btn:has-text("Computer")')
    fa.click('.dlg-new .btn.primary')
    wait(lambda: a.evaluate("(() => { const c = " + VUE + ".find('addFriends'); if (c) { window.__add = c; return true; } return false; })()"), 'friend picker', 60)
    a.evaluate("u => { window.__add.targetUsernames = [u]; window.__add.addFriends(); window.__add.applyChange(); }", 'bob')
    wait(lambda: fa.evaluate("!!(L4P.App.game && L4P.App.game.replay && L4P.App.game.replay.setup)"), 'alice game', 120)
    chat = fa.evaluate('L4P.App.game.sess.chatId')
    goto_view(b, 'Newsfeed', 'joinConversation', '__feed')
    def join_button():
        b.evaluate("() => { if (window.__feed.refresh) window.__feed.refresh(); }")
        b.wait_for_timeout(3000)
        return b.evaluate("[...document.querySelectorAll('button')].some(x => x.textContent.trim() === 'Join')")
    wait(join_button, 'invitation', 240, 0.1)
    b.evaluate("[...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Join').click()")
    fb = wait(lambda: (lambda f: f if f and f.evaluate("!!(window.L4P && L4P.App && L4P.App.game && L4P.App.game.replay && L4P.App.game.replay.setup)") else None)(app_frame(b)), 'bob game', 180)
    fb.evaluate(FAST)
    log('bob', 'mark', 'joined')
    def play(sec):
        end = time.time() + sec
        while time.time() < end:
            for pg in (a, b):
                f = app_frame(pg)
                if not f: continue
                try:
                    f.evaluate("() => { const g = L4P.App.game; if (!g) return; if (g.phase === 'roll') document.getElementById('die').click(); if (g.phase === 'pick') { const t = document.querySelector('.tok.pickable'); if (t) t.dispatchEvent(new MouseEvent('click', {bubbles: true})); } }")
                except Exception: pass
            a.wait_for_timeout(250); b.wait_for_timeout(50)
    play(A.play)
    for k in range(A.cycles):
        log('bob', 'mark', 'close %d (n=%s)' % (k, fa.evaluate('L4P.App.game.state.n')))
        close_app(b)
        log('bob', 'mark', 'launch %d' % k)
        fb = launch(b); fb.evaluate(FAST)
        wait(lambda: fb.evaluate("!!document.querySelector('#games-list .game-card[data-chat]')"), 'list', 60)
        fb.evaluate("s => [...document.querySelectorAll('#games-list .game-card[data-chat]')].find(e => e.dataset.chat === s).click()", chat)
        log('bob', 'mark', 'opened %d' % k)
        play(A.play)
    a.wait_for_timeout(3000)
    br.close()
for e in ev:
    print('%7.2f %-5s %-5s %s' % e)
print('TOASTS:', sum(1 for e in ev if e[2] == 'TOAST'))
