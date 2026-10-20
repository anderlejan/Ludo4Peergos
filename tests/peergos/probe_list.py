#!/usr/bin/env python3
"""Probe on a local Peergos server: does a game a friend started show up in the invited player's game list?
Uses the helpers of e2e.py. python3 tests/peergos/probe_list.py --zip <zip in /<user>/apps/> [--shots DIR]"""
import json, sys, time, os
sys.path.insert(0, os.path.dirname(__file__))
import e2e
from e2e import A, login, install_from_zip, launch, close_app, goto_view, wait, VUE, shot
from playwright.sync_api import sync_playwright


def raw_lists(f):
    return f.evaluate("""async () => {
      const v0 = await (await fetch('/peergos-api/v0/chat/')).text();
      const v1 = await (await fetch('/peergos-api/v1/chat/')).text();
      return {v0, v1}; }""")


with sync_playwright() as p:
    browser = p.chromium.launch()
    pa = browser.new_context(viewport={'width': 1440, 'height': 900}).new_page()
    pb = browser.new_context(viewport={'width': 1440, 'height': 900}).new_page()
    for u, pg in (('alice', pa), ('bob', pb)):
        login(pg, u)
        install_from_zip(pg, u)
    fa = launch(pa)
    fa.evaluate("L4P.App.set({anim: 'instant', sound: false})")
    fa.click('#act-friends')
    fa.wait_for_selector('.dlg-new')
    fa.click('.dlg-new .btn.primary')
    wait(lambda: pa.evaluate("(() => { const c = " + VUE + ".find('addFriends'); if (c) { window.__add = c; return true; } return false; })()"), 'friend picker', 60)
    pa.evaluate("u => { window.__add.targetUsernames = [u]; window.__add.addFriends(); window.__add.applyChange(); }", 'bob')
    wait(lambda: fa.evaluate("!!(L4P.App.game && L4P.App.game.replay && L4P.App.game.replay.setup)"), 'alice game', 120)
    chat = fa.evaluate('L4P.App.game.sess.chatId')
    print('chat', chat)
    # bob BEFORE joining: what does his app list?
    fb = launch(pb)
    print('bob before join:', json.dumps(raw_lists(fb))[:600])
    close_app(pb)
    goto_view(pb, 'Newsfeed', 'joinConversation', '__feed')

    def join_button():
        pb.evaluate("() => { if (window.__feed.refresh) window.__feed.refresh(); }")
        time.sleep(3)
        return pb.evaluate("[...document.querySelectorAll('button')].some(x => x.textContent.trim() === 'Join')")
    wait(join_button, 'invitation', 240, 0.1)
    pb.evaluate("[...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Join').click()")
    fb = wait(lambda: (lambda f: f if f and f.evaluate("!!(window.L4P && L4P.App && L4P.App.game && L4P.App.game.replay && L4P.App.game.replay.setup)") else None)(e2e.app_frame(pb)), 'bob game', 180)
    print('bob joined; in game:', fb.evaluate('L4P.App.game.sess.chatId') == chat)
    close_app(pb)
    try:
        fb = launch(pb)
    except Exception as e:
        print('LAUNCH FAILED', e)
        print(pb.evaluate("(() => { const l = window.__launcher; return JSON.stringify({shown: !!(l && l.$el && document.contains(l.$el)), spinner: l && l.showSpinner, apps: l && l.appsList ? l.appsList.map(a => a.name) : null, keys: l ? Object.keys(l.$data || {}).slice(0, 40) : null}); })()"))
        shot(pb, 'probe-launch-failed')
        raise
    time.sleep(6)
    print('bob after join, from the launcher:', json.dumps(raw_lists(fb))[:1500])
    print('bob home list text:', fb.inner_text('#games-list')[:400])
    shot(pb, 'probe-bob-home')
    browser.close()
