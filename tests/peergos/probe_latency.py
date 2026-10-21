#!/usr/bin/env python3
"""Probe on a LOCAL Peergos server: an online game where bob is "far away" (Chrome network emulation adds latency and
limits bandwidth for every request of his Peergos page). Records the app's chat reads and sends (durations, errors),
the status line ("Not connected – retrying"), and how long bob waits to see alice's moves.
  python3 tests/peergos/probe_latency.py --zip <zip in /<user>/apps/> --latency 300 [--kbps 8000] [--minutes 4]"""
import argparse, json, os, sys, time
_argv = sys.argv
ap = argparse.ArgumentParser()
ap.add_argument('--zip', required=True); ap.add_argument('--url', default='http://localhost:8777')
ap.add_argument('--latency', type=int, default=300); ap.add_argument('--kbps', type=int, default=8000)
ap.add_argument('--minutes', type=float, default=4); ap.add_argument('--install', action='store_true')
A = ap.parse_args()
sys.argv = [sys.argv[0], '--zip', A.zip, '--url', A.url]
sys.path.insert(0, os.path.dirname(__file__))
import e2e
from e2e import login, install_from_zip, launch, goto_view, wait, VUE, app_frame
from playwright.sync_api import sync_playwright

HOOK = r"""() => { if (window.__netlog) return; window.__netlog = [];
  // raw request time (fetch) and total time including the app's queue (Storage.api)
  const f0 = window.fetch.bind(window);
  window.fetch = async (u, init) => { const t0 = performance.now(); const path = String(u);
    try { const r = await f0(u, init); const kind = /\/chat\/?$/.test(path) ? 'list' : (init && init.method === 'PUT' && /chat/.test(path)) ? 'send' : /chat/.test(path) ? 'read' : 'data';
      r.clone().text().then(() => __netlog.push({k: 'raw-' + kind, ms: performance.now() - t0})); return r; }
    catch (e) { __netlog.push({k: 'raw-err', ms: performance.now() - t0, err: String(e).slice(0, 60)}); throw e; } };
  const S = L4P.Storage, a0 = S.api;
  S.api = (path, init, opts) => { const t0 = performance.now(); const kind = /\/chat\/?$/.test(path) ? 'list' : (init && init.method === 'PUT' && /chat/.test(path)) ? 'send' : /chat/.test(path) ? 'read' : 'data';
    const pr = a0(path, init, opts);
    pr.then(() => __netlog.push({k: kind, ms: performance.now() - t0}), e => __netlog.push({k: kind, ms: performance.now() - t0, err: String(e.message || e).slice(0, 80)}));
    return pr; }; }"""
FAST = "L4P.App.set({anim: 'fast', autoRoll: true, autoMove: true, sound: false})"

with sync_playwright() as p:
    br = p.chromium.launch()
    pa = br.new_context(viewport={'width': 1300, 'height': 850}).new_page()
    pb = br.new_context(viewport={'width': 1300, 'height': 850}).new_page()
    for u, pg in (('alice', pa), ('bob', pb)):
        login(pg, u)
        if A.install: install_from_zip(pg, u)
    fa = launch(pa); fa.evaluate(FAST)
    print('app version', fa.evaluate('L4P.VERSION'), flush=True)
    fa.click('#act-friends'); fa.wait_for_selector('.dlg-new')
    fa.click('.dlg-new .btn.primary')
    wait(lambda: pa.evaluate("(() => { const c = " + VUE + ".find('addFriends'); if (c) { window.__add = c; return true; } return false; })()"), 'friend picker', 60)
    pa.evaluate("u => { window.__add.targetUsernames = [u]; window.__add.addFriends(); window.__add.applyChange(); }", 'bob')
    wait(lambda: fa.evaluate("!!(L4P.App.game && L4P.App.game.replay && L4P.App.game.replay.setup)"), 'alice game', 120)
    # bob is far away from here on
    cdp = pb.context.new_cdp_session(pb)
    cdp.send('Network.enable')
    cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': A.latency, 'downloadThroughput': A.kbps * 125, 'uploadThroughput': A.kbps * 125 // 2})
    print('bob: +%d ms per request, %d kbit/s down' % (A.latency, A.kbps), flush=True)
    t0 = time.time()
    goto_view(pb, 'Newsfeed', 'joinConversation', '__feed')
    def join_button():
        pb.evaluate("() => { if (window.__feed.refresh) window.__feed.refresh(); }"); pb.wait_for_timeout(4000)
        return pb.evaluate("[...document.querySelectorAll('button')].some(x => x.textContent.trim() === 'Join')")
    wait(join_button, 'invitation', 400, 0.1)
    pb.evaluate("[...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Join').click()")
    fb = wait(lambda: (lambda f: f if f and f.evaluate("!!(window.L4P && L4P.App && L4P.App.game && L4P.App.game.replay && L4P.App.game.replay.setup)") else None)(app_frame(pb)), 'bob game', 400)
    print('bob joined after %.0f s' % (time.time() - t0), flush=True)
    fb.evaluate(FAST); fb.evaluate(HOOK); fa.evaluate(HOOK)
    end = time.time() + A.minutes * 60
    offline_seen, samples, lag = 0, 0, []
    while time.time() < end:
        try:
            sa = fa.evaluate("(() => { const g = L4P.App.game; return {n: g.state.n, over: g.state.over}; })()")
            sb = fb.evaluate("(() => { const g = L4P.App.game; return {n: g.state.n, over: g.state.over, phase: g.phase, net: document.querySelector('.net-state').textContent}; })()")
        except Exception as e:
            print('eval error', e); pa.wait_for_timeout(1000); continue
        samples += 1
        if 'Not connected' in sb['net']: offline_seen += 1
        lag.append(sa['n'] - sb['n'])
        if sa['over'] and sb['over']: break
        pa.wait_for_timeout(1000)
    la = fa.evaluate('window.__netlog'); lb = fb.evaluate('window.__netlog')
    def stats(log, k):
        xs = sorted(x['ms'] for x in log if x['k'] == k and 'err' not in x); errs = [x['err'] for x in log if x['k'] == k and 'err' in x]
        if not xs: return '%s: none ok, %d errors %s' % (k, len(errs), errs[:2])
        return '%s: %d ok, median %.1f s, p90 %.1f s, max %.1f s; %d errors %s' % (k, len(xs), xs[len(xs)//2]/1000, xs[int(len(xs)*.9)]/1000, xs[-1]/1000, len(errs), errs[:2])
    for who, lg in (('alice', la), ('bob  ', lb)):
        for k in ('read', 'send', 'raw-read', 'raw-send', 'list'):
            print(who, 'total' if not k.startswith('raw') else 'peergos', stats(lg, k))
    print('bob status "Not connected" in %d of %d samples; moves bob is behind alice: median %d, max %d' % (offline_seen, samples, sorted(lag)[len(lag)//2], max(lag)))
    print('moves played: alice n=%s' % fa.evaluate('L4P.App.game.state.n'))
    br.close()
