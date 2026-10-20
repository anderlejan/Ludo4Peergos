#!/usr/bin/env python3
"""End-to-end test of the release ZIP in a REAL local Peergos server (never a real account).

Needs: a local throw-away Peergos server (see the README's "Testing" section), users created and befriended
with tests/peergos/Setup.java, and the ZIP uploaded into each user's drive at /<user>/apps/<zip name>.

  python3 tests/peergos/e2e.py --url http://localhost:8777 --zip Ludo4Peergos-v0.1.0.zip --users alice bob \
      --password testpassword [--shots DIR]

What it checks, in Chromium, through the Peergos web UI:
  1. the ZIP installs from the drive (browse into the archive → peergos-app.json → Install), for both users
  2. the app starts inside the real sandbox (cross-origin isolated, CSP) without script errors
  3. settings are written to the app's data folder and come back after closing and reopening the app
  4. alice creates an online game with Peergos' own friend picker (bob + a computer seat)
  5. bob gets the invitation in the News feed, presses Join, the game opens in his app
  6. both play to the end over the real chat API and end in the same state
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--url', default='http://localhost:8777')
ap.add_argument('--zip', required=True)
ap.add_argument('--users', nargs=2, default=['alice', 'bob'])
ap.add_argument('--password', default='testpassword')
ap.add_argument('--shots')
ap.add_argument('--headed', action='store_true')
A = ap.parse_args()
failures = []

VUE = """(window.__pgVue || (window.__pgVue = {
 root() { const a = document.querySelector('#app'); return a && a._vnode && a._vnode.component ? a._vnode.component.proxy : null; },
 children(c) { const out = []; const walk = v => { if (v == null || typeof v !== 'object') return;
   if (Array.isArray(v)) { v.forEach(walk); return; }
   if (v.component) { if (v.component.proxy) out.push(v.component.proxy); else walk(v.component.subTree); return; }
   if (v.suspense) { walk(v.suspense.activeBranch); return; } walk(v.children); }; walk(c.$.subTree); return out; },
 shown(c) { return c.$el != null && c.$el.nodeType === 1 && document.contains(c.$el); },
 find(method) { const q = []; const r = this.root(); if (r) q.push(r);
   while (q.length) { const c = q.shift(); if (typeof c[method] === 'function' && this.shown(c)) return c; q.push(...this.children(c)); } return null; }
}))"""


def ok(name, cond, extra=''):
    print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond or not extra else ' – ' + str(extra)), flush=True)
    if not cond:
        failures.append(name)
    return cond


def wait(fn, what, timeout=120, every=0.5):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            last = fn()
            if last:
                return last
        except Exception as e:  # frame not there yet etc.
            last = e
        time.sleep(every)
    raise TimeoutError('timed out waiting for ' + what + ' (last: %r)' % (last,))


def shot(page, name):
    if A.shots:
        page.screenshot(path=os.path.join(A.shots, name + '.png'))


def login(page, user):
    page.goto(A.url + '/')
    wait(lambda: page.evaluate("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Sign in' && !b.disabled)"), 'sign in button', 300)
    page.evaluate("""([u, p]) => { const set = (el, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        s.call(el, v); el.dispatchEvent(new Event('input', {bubbles: true})); };
        set(document.querySelector('input[name=username]'), u); set(document.querySelector('input[name=password]'), p);
        [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Sign in').click(); }""", [user, A.password])
    wait(lambda: page.evaluate("/upgrade/i.test(document.body.innerText)"), 'sign in to complete', 300)


def goto_view(page, label, method, handle):
    for _ in range(5):
        found = page.evaluate("([m, h]) => { const c = " + VUE + ".find(m); if (c) { window[h] = c; return true; } return false; }", [method, handle])
        if found:
            return
        page.evaluate("l => { const b = [...document.querySelectorAll('button, a')].find(x => x.textContent.trim() === l); if (b) b.click(); }", label)
        try:
            wait(lambda: page.evaluate("([m, h]) => { const c = " + VUE + ".find(m); if (c) { window[h] = c; return true; } return false; }", [method, handle]), label, 60)
            return
        except TimeoutError:
            pass
    raise RuntimeError('view ' + label + ' never appeared')


def install_from_zip(page, user):
    goto_view(page, 'Drive', 'downloadFile', '__drive')
    wait(lambda: page.evaluate("window.__drive.currentDir && !window.__drive.showSpinner"), 'drive listing', 180)
    path = '/%s/apps/%s' % (user, os.path.basename(A.zip))
    page.evaluate("p => window.__drive.changePath(p)", path)
    wait(lambda: page.evaluate("!!window.__drive.archive && !window.__drive.showSpinner && window.__drive.files.some(f => f.getName() === 'peergos-app.json')"), 'the archive listing', 180)
    shot(page, 'install-1-archive-' + user)

    def open_menu():
        page.evaluate("""() => { window.__drive.closeMenu && window.__drive.closeMenu();
            const card = [...document.querySelectorAll('.grid-card, .drive-table tbody tr')].find(c => c.textContent.includes('peergos-app.json'));
            card.querySelector('[aria-label=menu]').click(); }""")
        time.sleep(1.5)
        return page.evaluate("(() => { const e = document.querySelector('#app-install'); return !!e && e.getClientRects().length > 0; })()")
    wait(open_menu, 'Install in the menu of peergos-app.json', 60, 0.1)
    page.evaluate("document.querySelector('#app-install').click()")
    dialog = "[...document.querySelectorAll('.app-install-container, .pg-dialog')].find(x => x.textContent.includes('App Installation'))"
    wait(lambda: page.evaluate("(() => { const x = " + dialog + "; return !!x && x.textContent.includes('Ludo4Peergos'); })()"), 'the install dialog', 60)
    text = page.evaluate("(" + dialog + ").textContent")
    ok('install dialog for %s names the permissions' % user, 'Ludo4Peergos' in text, text[:300])
    shot(page, 'install-2-dialog-' + user)
    page.evaluate("[...(" + dialog + ").querySelectorAll('button')].find(b => b.textContent.trim() === 'Install').click()")
    def finished():
        # an upgrade (same app installed already) asks "replace with version …?" first
        page.evaluate("() => { const c = " + VUE + ".find('confirmReplaceAppInstall'); if (c && c.showConfirm) { window.__replaced = true; c.confirm_consumer_func(); } }")
        return page.evaluate("!(" + dialog + ")")
    wait(finished, 'the installation to finish', 180)
    if page.evaluate("!!window.__replaced"):
        print('    (replaced an installed version – upgrade path)', flush=True)


def app_frame(page):
    # page.frames does not list the sandbox's out-of-process frames; go through the iframe elements instead
    outer = page.query_selector('#sandboxId')
    fo = outer and outer.content_frame()
    inner = fo and fo.query_selector('#appSandboxId')
    fi = inner and inner.content_frame()
    return fi if fi and '/index.html' in fi.url and 'username=' in fi.url else None


def launch(page):
    goto_view(page, 'Launcher', 'launchApp', '__launcher')
    page.evaluate("window.__launcher.launchApp('ludo4peergos')")
    return wait(lambda: (lambda f: f if f and f.evaluate("!!(window.L4P && window.L4P.App && document.getElementById('main'))") else None)(app_frame(page)), 'the app to start', 120)


def close_app(page):
    page.evaluate("() => { const q = [window.__launcher]; while (q.length) { const c = q.shift(); if (c && typeof c.closeSandbox === 'function') { c.closeSandbox(); return; } if (c) q.push(..." + VUE + ".children(c)); } }")
    wait(lambda: page.evaluate("!document.querySelector('#sandboxId')"), 'the app to close', 60)


def main():
    alice, bob = A.users
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not A.headed)
        pages = {}
        errors = {alice: [], bob: []}
        for u in (alice, bob):
            ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
            pg = ctx.new_page()
            pg.on('pageerror', lambda e, u=u: errors[u].append('pageerror: ' + str(e)))
            pg.on('console', lambda m, u=u: errors[u].append(m.text) if m.type == 'error' and ('L4P' in m.text or 'app.js' in m.text or 'Ludo' in m.text) else None)
            pages[u] = pg
        print('1. sign in and install from the ZIP', flush=True)
        for u in (alice, bob):
            login(pages[u], u)
            install_from_zip(pages[u], u)
            ok('installed for ' + u, True)

        print('2. start in the sandbox', flush=True)
        a = pages[alice]
        fa = launch(a)
        ok('cross-origin isolated sandbox', fa.evaluate('window.crossOriginIsolated') is True)
        ok('running inside Peergos (data + chat available)', fa.evaluate('L4P.Storage.PEERGOS && L4P.Net.available') is True)
        ok('username passed in', fa.evaluate('L4P.Storage.username') == alice)
        shot(a, 'app-1-home')

        print('3. settings saved to the data folder and restored', flush=True)
        fa.evaluate("L4P.App.set({theme: 'aurora', anim: 'fast'})")
        time.sleep(4)
        close_app(a)
        fa = launch(a)
        wait(lambda: fa.evaluate("document.documentElement.dataset.theme === 'aurora'"), 'restored theme', 60)
        ok('theme restored after reopening the app', True)
        stored = fa.evaluate("fetch('/peergos-api/v0/data/settings.json').then(r => r.text())")
        ok('settings.json in the Peergos data folder holds the theme', json.loads(stored).get('theme') == 'aurora', stored[:200])
        fa.evaluate("L4P.App.set({theme: 'midnight'})")

        print('4. alice creates an online game', flush=True)
        fa.evaluate("L4P.App.set({anim: 'instant', autoRoll: true, autoMove: true, sound: false, pollMs: 600})")
        fa.click('#act-friends')
        fa.wait_for_selector('.dlg-new')
        fa.click('.seat-row:nth-child(4) .seg-btn:has-text("Computer")')
        shot(a, 'game-1-setup')
        fa.click('.dlg-new .btn.primary')
        # Peergos' own "add friends" dialog in the main page
        wait(lambda: a.evaluate("(() => { const c = " + VUE + ".find('addFriends'); if (c) { window.__add = c; return true; } return false; })()"), 'the Peergos friend picker', 60)
        shot(a, 'game-2-peergos-friend-picker')
        a.evaluate("u => { window.__add.targetUsernames = [u]; window.__add.addFriends(); window.__add.applyChange(); }", bob)
        wait(lambda: fa.evaluate("!!(L4P.App.game && L4P.App.game.replay && L4P.App.game.replay.setup)"), 'the game to open for alice', 120)
        seats = fa.evaluate("L4P.App.game.replay.setup.seats")
        ok('bob seated, computer on blue', any(s and s.get('user') == bob for s in seats) and seats[3]['kind'] == 'bot', json.dumps(seats))
        chat = fa.evaluate("L4P.App.game.sess.chatId")
        ok('app chat id', chat.startswith('chat-ludo4peergos$' + alice + '$'), chat)
        shot(a, 'game-3-alice-waiting')

        print('5. bob joins from the News feed', flush=True)
        b = pages[bob]
        goto_view(b, 'Newsfeed', 'joinConversation', '__feed')

        def join_button():
            b.evaluate("() => { if (window.__feed.refresh) window.__feed.refresh(); }")
            time.sleep(3)
            return b.evaluate("[...document.querySelectorAll('button')].some(x => x.textContent.trim() === 'Join')")
        try:
            wait(join_button, 'the invitation in the feed', 240, 0.1)
        except TimeoutError:
            shot(b, 'game-4-bob-feed-missing')
            raise
        shot(b, 'game-4-bob-feed')
        b.evaluate("[...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Join').click()")
        fb = wait(lambda: (lambda f: f if f and f.evaluate("!!(window.L4P && L4P.App && L4P.App.game && L4P.App.game.replay && L4P.App.game.replay.setup)") else None)(app_frame(b)), 'the game to open for bob', 180)
        ok('bob opened the game via Join', fb.evaluate("L4P.App.game.sess.chatId") == chat)
        fb.evaluate("L4P.App.set({anim: 'instant', autoRoll: true, autoMove: true, sound: false, pollMs: 600})")
        fb.evaluate("() => { const i = document.querySelector('.chat-input .text-in'); i.value = 'Hello from bob'; i.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter'})); }")
        shot(b, 'game-5-bob-joined')

        print('6. play to the end', flush=True)
        end = time.time() + 1800
        last_n = -1
        last_report = time.time()
        while time.time() < end:
            done = 0
            for f in (fa, fb):
                st = f.evaluate("(() => { const g = L4P.App.game; return g && g.state ? {over: g.state.over, phase: g.phase, n: g.state.n} : null; })()")
                if not st:
                    continue
                if st['over']:
                    done += 1
                elif st['phase'] == 'pick':
                    f.evaluate("() => { const t = document.querySelector('.tok.pickable'); if (t) t.dispatchEvent(new MouseEvent('click', {bubbles: true})); }")
                elif st['phase'] == 'roll':
                    f.evaluate("() => document.getElementById('die').click()")
                if f is fa:
                    last_n = st['n']
            if done == 2:
                break
            if time.time() - last_report > 30:
                print('    … move %d' % last_n, flush=True)
                last_report = time.time()
            time.sleep(0.3)
        sa = fa.evaluate("JSON.stringify(L4P.App.game.state.tokens) + ' n=' + L4P.App.game.state.n + ' over=' + L4P.App.game.state.over")
        sb = fb.evaluate("JSON.stringify(L4P.App.game.state.tokens) + ' n=' + L4P.App.game.state.n + ' over=' + L4P.App.game.state.over")
        ok('the game ended on both sides', 'over=true' in sa and 'over=true' in sb, sa + ' / ' + sb)
        ok('both sides have the same final state', sa == sb, sa + ' / ' + sb)
        ok('bob\'s chat line reached alice', 'Hello from bob' in fa.inner_text('.side'))
        shot(a, 'game-6-alice-end')
        shot(b, 'game-6-bob-end')
        for u in (alice, bob):
            ok('no app script errors for ' + u, not errors[u], errors[u][:5])
        browser.close()
    print('FAILED: ' + ', '.join(failures) if failures else 'ALL OK')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
