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
  7. new round; 0.7.0: before its first roll bob disagrees, alice switches rule sets, bob agrees, the roll locks them
  8. the game stays in bob's list; bob leaves the game
  9.–11. deleting games: what Peergos leaves (RemoveMember from the owner's client), a 0.7.0 delete of a running game
     (the "leave" reaches alice), an older app's delete (alice is told from Peergos' RemoveMember)
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--url', default='http://localhost:8777')
ap.add_argument('--zip', required=True, help='name of the ZIP (or, for Peergos 1.38, of an unpacked app folder) in /<user>/apps/')
ap.add_argument('--users', nargs=2, default=['alice', 'bob'])
ap.add_argument('--password', default='testpassword')
ap.add_argument('--shots')
ap.add_argument('--previous-zip', help='install this older release first, so the test zip is installed as an upgrade')
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


def install_from_zip(page, user, zipname=None):
    goto_view(page, 'Drive', 'downloadFile', '__drive')
    wait(lambda: page.evaluate("window.__drive.currentDir && !window.__drive.showSpinner"), 'drive listing', 180)
    path = '/%s/apps/%s' % (user, os.path.basename(zipname or A.zip))
    page.evaluate("p => window.__drive.changePath(p)", path)
    # a ZIP (Peergos 1.39+ installs from inside an archive) or an unpacked app folder (1.38 offers Install App only there)
    wait(lambda: page.evaluate("!window.__drive.showSpinner && window.__drive.files.some(f => f.getName() === 'peergos-app.json')"), 'the app listing', 180)
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
    goto_view(page, 'Launcher', 'launchAppFromUI', '__launcher')  # NewsFeed has a launchApp too
    # the launcher loads the installed apps after it shows; launching before that fails inside Peergos
    wait(lambda: page.evaluate("!window.__launcher.showSpinner && Array.isArray(window.__launcher.appsList) && window.__launcher.appsList.some(a => a.name === 'ludo4peergos')"), 'the launcher to list the app', 60)
    page.evaluate("window.__launcher.launchApp('ludo4peergos')")
    return wait(lambda: (lambda f: f if f and f.evaluate("!!(window.L4P && window.L4P.App && document.getElementById('main'))") else None)(app_frame(page)), 'the app to start', 120)


def close_app(page):
    page.evaluate("() => { const c = " + VUE + ".find('closeSandbox'); if (c) c.closeSandbox(); }")
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
            # record Peergos' own error toasts (e.g. "CAS exception updating cryptree node") in the main page
            pg.add_init_script("""if (window.top === window) { window.__pgErrors = []; new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) {
                const t = (n.textContent || ''); if (/CAS exception|concurrent modification/i.test(t) && window.__pgErrors.length < 50) window.__pgErrors.push({t: Date.now(), text: t.slice(0, 160)}); } })
                .observe(document, {childList: true, subtree: true}); }""")
            pages[u] = pg
        print('1. sign in and install from the ZIP', flush=True)
        for u in (alice, bob):
            login(pages[u], u)
            if A.previous_zip:
                install_from_zip(pages[u], u, A.previous_zip)
                ok('previous version installed for ' + u, True)
            install_from_zip(pages[u], u)
            ok('installed for ' + u, True)

        print('2. start in the sandbox', flush=True)
        a = pages[alice]
        fa = launch(a)
        ok('cross-origin isolated sandbox', fa.evaluate('window.crossOriginIsolated') is True)
        ok('running inside Peergos (data + chat available)', fa.evaluate('L4P.Storage.PEERGOS && L4P.Net.available') is True)
        ok('username passed in', fa.evaluate('L4P.Storage.username') == alice)
        ok('the installed app is the tested version', fa.evaluate('L4P.VERSION') == json.load(open(os.path.join(os.path.dirname(__file__), '..', '..', 'peergos-app.json')))['version'])
        fs = fa.evaluate("({enabled: document.fullscreenEnabled, button: !!document.getElementById('btn-full')})")
        ok('full screen is not allowed for apps in Peergos; the app has no full-screen button', fs['enabled'] is False and fs['button'] is False, fs)
        try:
            fa.evaluate("document.documentElement.requestFullscreen()")
            ok('requestFullscreen is refused inside the sandbox', False, 'it was accepted')
        except Exception as e:
            ok('requestFullscreen is refused inside the sandbox', True)
            print('    (refusal: %s)' % str(e).splitlines()[0][:160], flush=True)
        shot(a, 'app-1-home')
        fa.click('#btn-notes')
        wait(lambda: fa.evaluate("!!document.querySelector('.un-overlay')"), 'the Notes window', 20)
        ok('the Notes window opens in the real sandbox', True)
        fa.evaluate("document.querySelector('.un-overlay .un-close').click()")

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
        # 0.5.0: a rule switched on in Settings reaches the New game dialog; no stray "null" in Settings
        fa.click('#btn-settings')
        fa.click('.set-tab[data-sec="rules"]')
        fa.click('.rule-row[data-rule="mustEnter"] .slider')
        time.sleep(1.5)
        ok('no stray "null" in Settings (header and rules)', 'null' not in fa.inner_text('.dlg-settings'), fa.inner_text('.dlg-settings')[:200])
        fa.evaluate("document.querySelector('.dlg-settings .dlg-close') ? document.querySelector('.dlg-settings .dlg-close').click() : null")
        fa.click('#act-new')
        fa.wait_for_selector('.dlg-new')
        ok('the New game dialog has the rule switched on in Settings', fa.evaluate("document.querySelector('.dlg-new #rule-mustEnter').checked") is True)
        fa.evaluate("[...document.querySelectorAll('.dlg-new .btn')].find(b => !b.classList.contains('primary')).click()")
        fa.evaluate("L4P.App.set({rules: Object.assign({}, L4P.App.settings().rules, {mustEnter: false})})")

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
        feed_from = b.evaluate('Date.now()')
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
        feed_to = b.evaluate('Date.now()')
        fb.evaluate("L4P.App.set({anim: 'instant', autoRoll: true, autoMove: true, sound: false, pollMs: 600})")
        fa.evaluate("window.__snd = []; const p0 = L4P.Sound.play; L4P.Sound.play = n => { window.__snd.push(n); return p0(n); }")
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
        ok('bob\'s chat line reached alice', 'Hello from bob' in fa.inner_text('.side-right'))
        ok('alice heard the chat sound', 'chat' in fa.evaluate('window.__snd'))
        shot(a, 'game-6-alice-end')
        print('7. new round in the same chat (bob asks, alice agrees, her app starts it)', flush=True)
        for f in (fa, fb):  # 0.7.0: nobody rolls by itself, so the players can talk about the rules first
            f.evaluate("L4P.App.set({autoRoll: false})")
        wait(lambda: fb.evaluate("!!document.getElementById('btn-rematch')"), 'the winner dialog for bob', 30)
        fb.evaluate("document.getElementById('btn-rematch').click()")
        wait(lambda: fa.evaluate("!!document.getElementById('btn-agree')"), 'alice to be asked', 120)
        shot(a, 'game-7-alice-asked')
        fa.evaluate("document.getElementById('btn-agree').click()")
        wait(lambda: fa.evaluate('L4P.App.game.replay.rounds.length') == 2 and fb.evaluate('L4P.App.game.replay.rounds.length') == 2, 'round 2 on both sides', 180)
        ok('round 2 started on both sides', True)
        ok('chat kept across rounds', 'Hello from bob' in fb.inner_text('.side-right') and 'Round 2' in fb.inner_text('.side-right'))
        print('7b. before the first roll of round 2: bob disagrees, alice switches to the Czech rules, bob agrees', flush=True)
        ok('round 2 keeps "let players agree on the rules"', fa.evaluate('L4P.App.game.replay.setup.agree') is True)
        wait(lambda: fb.evaluate("!!document.getElementById('btn-rules-disagree')"), 'bob\'s agree / disagree buttons', 120)
        fb.evaluate("document.getElementById('btn-rules-disagree').click()")
        wait(lambda: 'Not agreed: ' + bob in fa.inner_text('.info-box'), 'alice to see that bob disagrees', 180)
        ok('alice sees that bob disagrees (over the real chat)', True)
        fa.evaluate("document.getElementById('btn-change-rules').click()")
        fa.wait_for_selector('.dlg-rules')
        fa.click('.dlg-rules .set-chip[data-set="czech"] .set-pick')
        fa.click('#btn-apply-rules')
        wait(lambda: fb.evaluate("L4P.App.game.replay.setup.rulesSet") == 'czech', 'bob to get the Czech rules', 180)
        ok('bob plays the new rules, still round 2', fb.evaluate('L4P.App.game.replay.rounds.length') == 2 and fb.evaluate('L4P.App.game.state.rules.onePerSquare') is True)
        wait(lambda: 'switched to' in fb.inner_text('.side-right'), 'the rules line in bob\'s chat', 60)
        ok('bob\'s chat says which rules changed', True)
        fb.evaluate("document.getElementById('btn-rules-agree').click()")
        wait(lambda: 'Everybody agrees' in fa.inner_text('.info-box'), 'alice to see that everybody agrees', 180)
        ok('alice sees that everybody agrees', True)
        shot(a, 'game-7b-rules-agreed')
        for f in (fa, fb):
            f.evaluate("L4P.App.set({autoRoll: true})")
        fa.evaluate("() => { if (L4P.App.game.phase === 'start') document.getElementById('die').click(); }")
        wait(lambda: fa.evaluate('L4P.App.game.state.n') >= 1, 'the first roll of round 2', 180)
        wait(lambda: fa.evaluate("!document.getElementById('btn-change-rules')"), 'the rules to lock', 60)
        ok('the first roll locks the rules', True)
        fa.evaluate("document.getElementById('btn-game-rules').click()")
        ok('How to play shows the rules of this game', 'Rules of this game' in fa.inner_text('.dlg-help'))
        shot(a, 'game-8-rules')
        fa.evaluate("UI_close = document.querySelector('.dlg-help .dlg-close'); UI_close && UI_close.click()")
        shot(b, 'game-6-bob-end')

        print('8. the game a friend started stays in bob\'s list; bob leaves the game', flush=True)
        close_app(b)
        fb = launch(b)  # from the launcher, not from the News feed
        wait(lambda: fb.evaluate("!!document.querySelector('#games-list .game-card[data-chat]')"), 'the game in bob\'s list', 90)
        ok('bob\'s menu lists the game alice started', fb.evaluate("[...document.querySelectorAll('#games-list .game-card[data-chat]')].some(e => e.dataset.chat === %s)" % json.dumps(chat)))
        stored = fb.evaluate("fetch('/peergos-api/v0/data/online-games.json').then(r => r.ok ? r.text() : '')")
        ok('the game is remembered in bob\'s data folder', chat in stored, stored[:200])
        shot(b, 'game-9-bob-list')
        fb.evaluate("s => [...document.querySelectorAll('#games-list .game-card[data-chat]')].find(e => e.dataset.chat === s).click()", chat)
        wait(lambda: fb.evaluate("!!(L4P.App.game && L4P.App.game.replay && L4P.App.game.replay.setup && document.getElementById('btn-leave'))"), 'bob back in the game', 120)
        fb.evaluate("L4P.App.set({anim: 'instant', sound: false, pollMs: 600})")
        fb.evaluate("document.getElementById('btn-leave').click()")
        fb.wait_for_selector('.dlg-small .btn.primary')
        fb.click('.dlg-small .btn.primary')
        wait(lambda: fb.evaluate("!!document.querySelector('#games-list .game-card[data-chat]') && document.getElementById('games-list').innerText.includes('You left')"), 'bob back in the menu, game marked as left', 120)
        ok('bob is back in the menu, the game is marked "You left"', True)
        wait(lambda: 'left the game' in fa.inner_text('.side-right'), 'alice to see that bob left', 180)
        ok('alice sees that bob left (chat line)', True)
        ok('alice heard the leave sound', 'leave' in fa.evaluate('window.__snd'))
        yellow = fa.evaluate("L4P.App.game.state.seats.findIndex(s => s && s.user === %s)" % json.dumps(bob))
        n0 = fa.evaluate('L4P.App.game.state.n')
        def host_plays_bob():
            st = fa.evaluate("(() => { const g = L4P.App.game; if (g.phase === 'roll') document.getElementById('die').click(); if (g.phase === 'pick') { const t = document.querySelector('.tok.pickable'); if (t) t.dispatchEvent(new MouseEvent('click', {bubbles: true})); } return g.replay.history.some(h => h.c === %d && h.n >= %d && h.author === %s); })()" % (yellow, n0, json.dumps(alice)))
            return st
        wait(host_plays_bob, 'alice\'s computer to play bob\'s colour', 300, 1)
        ok('alice\'s app plays bob\'s colour after he left', True)
        shot(a, 'game-10-alice-after-leave')
        shot(b, 'game-11-bob-left')

        print('9. bob deletes the game from his list: what does Peergos itself show alice?', flush=True)
        types_before = fa.evaluate("s => L4P.Net.read(s, 0).then(r => r.entries.map(e => e.type + ':' + (e.author || e.joinUsername || e.removeUsername || '')))", chat)
        fb.evaluate("s => [...document.querySelectorAll('#games-list .game-card[data-chat]')].find(e => e.dataset.chat === s).querySelector('.icon-btn').click()", chat)
        fb.wait_for_selector('.dlg-small .btn.primary')
        ok('bob (who already left) is asked plainly', 'Remove this online game' in fb.inner_text('.dlg-small'), fb.inner_text('.dlg-small')[:200])
        fb.click('.dlg-small .btn.primary')
        wait(lambda: fb.evaluate("s => ![...document.querySelectorAll('#games-list .game-card[data-chat]')].some(e => e.dataset.chat === s)", chat), 'the game to leave bob\'s list', 60)
        ok('the game is gone from bob\'s list', True)
        time.sleep(20)
        types_after = fa.evaluate("s => L4P.Net.read(s, 0).then(r => r.entries.map(e => e.type + ':' + (e.author || e.joinUsername || e.removeUsername || '')))", chat)
        new = types_after[len(types_before):]
        kinds = sorted(set(t.split(':')[0] for t in types_after))
        print('    alice\'s chat entry types: %s; new after bob\'s delete: %s' % (kinds, new[:10]), flush=True)
        ok('recorded what Peergos shows after a delete (see the line above)', True)

        def new_game_with_bob(label):
            close_app(a)
            fa2 = launch(a)
            fa2.evaluate("L4P.App.set({anim: 'instant', autoRoll: true, autoMove: true, sound: false, pollMs: 600, agreeRules: false})")
            fa2.click('#act-friends')
            fa2.wait_for_selector('.dlg-new')
            fa2.click('.dlg-new .btn.primary')
            wait(lambda: a.evaluate("(() => { const c = " + VUE + ".find('addFriends'); if (c) { window.__add = c; return true; } return false; })()"), 'the Peergos friend picker (' + label + ')', 60)
            a.evaluate("u => { window.__add.targetUsernames = [u]; window.__add.addFriends(); window.__add.applyChange(); }", bob)
            wait(lambda: fa2.evaluate("!!(L4P.App.game && L4P.App.game.replay && L4P.App.game.replay.setup)"), 'the game for alice (' + label + ')', 120)
            cid = fa2.evaluate("L4P.App.game.sess.chatId")
            close_app(b)
            goto_view(b, 'Newsfeed', 'joinConversation', '__feed')
            def join_btn():
                b.evaluate("() => { if (window.__feed.refresh) window.__feed.refresh(); }")
                time.sleep(3)
                return b.evaluate("[...document.querySelectorAll('button')].some(x => x.textContent.trim() === 'Join')")
            wait(join_btn, 'the invitation (' + label + ')', 240, 0.1)
            b.evaluate("[...document.querySelectorAll('button')].filter(x => x.textContent.trim() === 'Join').pop().click()")
            fb2 = wait(lambda: (lambda f: f if f and f.evaluate("c => !!(window.L4P && L4P.App && L4P.App.game && L4P.App.game.replay && L4P.App.game.replay.setup && L4P.App.game.sess.chatId === c)", cid) else None)(app_frame(b)), 'the game for bob (' + label + ')', 180)
            fb2.evaluate("L4P.App.set({anim: 'instant', autoRoll: true, autoMove: true, sound: false, pollMs: 600})")
            # play until alice has seen at least one move of bob (his message log has been read once)
            def bob_moved():
                for f in (fa2, fb2):
                    f.evaluate("() => { const g = L4P.App.game; if (g.phase === 'pick') { const t = document.querySelector('.tok.pickable'); if (t) t.dispatchEvent(new MouseEvent('click', {bubbles: true})); } }")
                return fa2.evaluate("u => L4P.App.game.replay.history.some(h => h.author === u)", bob)
            wait(bob_moved, 'a move of bob at alice (' + label + ')', 300, 1)
            fb2.evaluate("L4P.App.set({autoRoll: false})")
            return fa2, fb2, cid

        print('10. bob (0.7.0) deletes a RUNNING game: the "leave" reaches alice', flush=True)
        fa2, fb2, chat2 = new_game_with_bob('10')
        fb2.evaluate("document.querySelector('.game-actions .btn:last-child').click()")
        wait(lambda: fb2.evaluate("s => [...document.querySelectorAll('#games-list .game-card[data-chat]')].some(e => e.dataset.chat === s)", chat2), 'the game in bob\'s list', 90)
        fb2.evaluate("s => [...document.querySelectorAll('#games-list .game-card[data-chat]')].find(e => e.dataset.chat === s).querySelector('.icon-btn').click()", chat2)
        fb2.wait_for_selector('.dlg-small .btn.primary')
        ok('bob is told that the others will be told', 'the others are told' in fb2.inner_text('.dlg-small'), fb2.inner_text('.dlg-small')[:200])
        fb2.click('.dlg-small .btn.primary')
        wait(lambda: fb2.evaluate("s => ![...document.querySelectorAll('#games-list .game-card[data-chat]')].some(e => e.dataset.chat === s)", chat2), 'the game to leave bob\'s list', 120)
        ok('bob\'s copy of the chat is kept for now (deleted a week later)', fb2.evaluate("s => L4P.Net.listGames().then(l => l.some(c => c.chatId === s))", chat2) is True)
        wait(lambda: bob + ' left the game' in fa2.inner_text('.side-right'), 'alice to see that bob left (10)', 240)
        ok('alice sees "bob left the game" after bob deleted the running game', True)
        shot(a, 'game-12-alice-bob-deleted')
        close_app(a)

        print('11. bob with an OLDER app deletes a running game (no "leave"): Peergos\' RemoveMember tells alice', flush=True)
        fa3, fb3, chat3 = new_game_with_bob('11')
        st = fb3.evaluate("s => L4P.Net.remove(s)", chat3)  # what 0.6.0 did on delete (same call, no "leave" before it)
        ok('the old way of deleting (DELETE of the chat copy) worked', st is True, st)
        wait(lambda: bob + ' left the game' in fa3.inner_text('.side-right'), 'alice to see that bob left (11)', 300)
        ok('alice sees "bob left the game" (from Peergos\' RemoveMember)', True)
        ok('alice\'s computer takes over bob\'s colour', fa3.evaluate("u => L4P.App.game.replay.left.indexOf(u) >= 0", bob))
        shot(a, 'game-13-alice-old-delete')
        for u in (alice, bob):
            ok('no app script errors for ' + u, not errors[u], errors[u][:5])
            pe = pages[u].evaluate('window.__pgErrors || []')
            # Peergos' own News feed refresh (bob waits there for the invitation, refreshing it) can raise this error
            # with no app running – seen 2026-10-20 with 1.39.0. Report those, fail only on the others.
            feed = [e for e in pe if u == bob and feed_from <= e['t'] <= feed_to]
            other = [e for e in pe if e not in feed]
            if feed:
                print('    (Peergos error toast during the News feed / Join phase, not from the app: %s)' % feed[0]['text'][:90], flush=True)
            ok('no Peergos CAS / concurrent-modification error toasts while the app runs, for ' + u, not other, [e['text'] for e in other[:3]])
        browser.close()
    print('FAILED: ' + ', '.join(failures) if failures else 'ALL OK')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
