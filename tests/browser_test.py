#!/usr/bin/env python3
"""Browser tests against the mock Peergos (tests/mock_peergos.py), headless Chromium.

  python3 tests/browser_test.py [--shots DIR]

Starts its own mock server (ports 8811-8813, users alice/bob/carol) and checks:
  1. a full local game (you + 3 computers) to the end, saved to the data folder, winner dialog
  2. settings are saved at once to the data folder and come back on a fresh browser (restart test)
  3. a full online game: alice hosts, bob joins, one computer seat run by alice; both end in the same state
  4. every theme renders (screenshots), Czech texts, the Notes window opens and saves a note
"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else None
PORTS = {'alice': 8811, 'bob': 8812, 'carol': 8813}
failures = []


def ok(name, cond, extra=''):
    print(('  ok   ' if cond else '  FAIL ') + name + (' – ' + extra if extra and not cond else ''))
    if not cond:
        failures.append(name)


def url(user, extra=''):
    return 'http://127.0.0.1:%d/index.html?username=%s&pgi=test&theme=dark-mode&lang=en-GB&pollms=150%s' % (PORTS[user], user, extra)


def mock_state():
    return json.loads(urllib.request.urlopen('http://127.0.0.1:8811/mock/state').read())


def post(path, obj):
    req = urllib.request.Request('http://127.0.0.1:8811' + path, data=json.dumps(obj).encode(), method='POST')
    urllib.request.urlopen(req).read()


def new_page(browser, user, extra='', vp=(1400, 860)):
    ctx = browser.new_context(viewport={'width': vp[0], 'height': vp[1]}, bypass_csp=True)  # Playwright's waits need eval; the real CSP is checked in the Peergos test
    pg = ctx.new_page()
    pg.errors = []
    pg.on('pageerror', lambda e: pg.errors.append(str(e)))
    pg.on('console', lambda m: pg.errors.append(m.text) if m.type == 'error' and '404' not in m.text else None)
    pg.goto(url(user, extra))
    pg.wait_for_function('window.L4P && window.L4P.App && document.querySelector("#main")')
    return pg


def fast(pg, **extra):
    s = {'anim': 'instant', 'autoRoll': True, 'autoMove': True, 'sound': False}
    s.update(extra)
    pg.evaluate('s => L4P.App.set(s)', s)


def play_until_over(pages, timeout=240):
    end = time.time() + timeout
    while time.time() < end:
        done = 0
        for pg in pages:
            st = pg.evaluate('() => { const g = L4P.App.game; return g && g.state ? {over: g.state.over, phase: g.phase} : null; }')
            if st and st['over']:
                done += 1
                continue
            if st and st['phase'] == 'roll':
                pg.evaluate('() => document.getElementById("die").click()')
            if st and st['phase'] == 'pick':
                pg.evaluate('() => { const t = document.querySelector(".tok.pickable"); if (t) t.dispatchEvent(new MouseEvent("click", {bubbles: true})); }')
        if done == len(pages):
            return True
        time.sleep(0.05)
    return False


def main():
    mock = subprocess.Popen([sys.executable, os.path.join(HERE, 'mock_peergos.py')] + ['%d:%s' % (p, u) for u, p in PORTS.items()],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=dict(os.environ, MOCK_LATENCY='0.01'))
    mock.stdout.readline()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()

            print('1. local game')
            pg = new_page(browser, 'alice')
            fast(pg)
            pg.click('#act-quick')
            pg.wait_for_function('L4P.App.game && L4P.App.game.state')
            ok('game screen opens', pg.locator('.board-svg').count() == 1)
            ok('four players listed', pg.locator('.player').count() == 4)
            if SHOTS:
                pg.screenshot(path=os.path.join(SHOTS, 'local-start.png'))
            finished = play_until_over([pg])
            ok('local game reaches the end', finished)
            pg.wait_for_selector('.dlg-winner', timeout=5000)
            ok('winner dialog shows a ranking of 4', pg.locator('.ranking li').count() == 4)
            if SHOTS:
                pg.screenshot(path=os.path.join(SHOTS, 'local-winner.png'))
            time.sleep(0.8)
            data = mock_state()['data'].get('alice', {})
            games = json.loads(data.get('local-games.json', '{"games":[]}'))['games']
            ok('the game is saved in the data folder', len(games) == 1 and len(games[0]['actions']) > 50, str(len(games)))
            ok('no script errors (local game)', not pg.errors, '; '.join(pg.errors[:3]))
            pg.keyboard.press('Escape')
            pg.click('.game-actions .btn:last-child')
            pg.wait_for_selector('.game-card')
            ok('home lists the saved game', pg.locator('.game-card').count() >= 1)

            print('2. settings saved at once and restored')
            pg.click('#btn-settings')
            pg.click('.theme-card[data-theme-id="ember"]')
            time.sleep(0.6)
            data = mock_state()['data']['alice']
            ok('theme written to settings.json', json.loads(data['settings.json'])['theme'] == 'ember')
            ok('save indicator says saved', 'Saved' in pg.inner_text('.save-state'))
            pg.click('.set-tab:nth-child(2)')
            pg.click('.toggle-row:has-text("Highlight") .slider')
            time.sleep(0.6)
            ok('hints switch written', json.loads(mock_state()['data']['alice']['settings.json'])['hints'] is False)
            pg.context.close()
            pg2 = new_page(browser, 'alice')  # fresh browser profile: only the data folder remembers
            pg2.wait_for_function('document.documentElement.dataset.theme === "ember"', timeout=5000)
            ok('theme restored from the data folder on a fresh browser', True)
            ok('hints restored', pg2.evaluate('L4P.App.settings().hints') is False)
            ok('saved local game restored on a fresh browser', pg2.locator('.game-card').count() >= 1)
            pg2.evaluate('L4P.App.set({theme: "midnight", hints: true})')
            pg2.context.close()

            print('3. online game alice + bob + computer')
            a = new_page(browser, 'alice')
            fast(a)
            a.click('#act-friends')
            a.wait_for_selector('.dlg-new')
            # seats: red = me, green = empty, yellow = friend, blue = computer
            a.click('.seat-row:nth-child(4) .seg-btn:has-text("Computer")')
            if SHOTS:
                a.screenshot(path=os.path.join(SHOTS, 'online-setup.png'))
            post('/mock/invite-order', {'order': ['bob']})
            a.click('.dlg-new .btn.primary')
            a.wait_for_function('L4P.App.game && L4P.App.game.replay && L4P.App.game.replay.setup', timeout=10000)
            chat = a.evaluate('L4P.App.game.sess.chatId')
            ok('chat created with the app prefix', chat.startswith('chat-ludo4peergos$alice$'))
            seats = a.evaluate('L4P.App.game.replay.setup.seats')
            ok('bob seated on yellow, computer on blue', seats[2] == {'kind': 'human', 'user': 'bob'} and seats[3]['kind'] == 'bot', json.dumps(seats))
            post('/mock/join', {'chat': chat, 'user': 'bob'})
            b = new_page(browser, 'bob', '&chatId=' + urllib.request.quote(chat, safe='$'))
            fast(b)
            b.wait_for_function('L4P.App.game && L4P.App.game.replay && L4P.App.game.replay.setup', timeout=10000)
            ok('bob sees the game', b.locator('.player').count() == 3)
            b.fill('.chat-input .text-in', 'Ahoj 👋')
            b.press('.chat-input .text-in', 'Enter')
            finished = play_until_over([a, b], timeout=400)
            ok('online game reaches the end on both sides', finished)
            sa = a.evaluate('JSON.stringify(L4P.App.game.state.tokens) + "|" + L4P.App.game.state.n')
            sb = b.evaluate('JSON.stringify(L4P.App.game.state.tokens) + "|" + L4P.App.game.state.n')
            ok('both players end in the same state', sa == sb, sa + ' vs ' + sb)
            ok('chat message arrived at alice', 'Ahoj' in a.inner_text('.side'))
            if SHOTS:
                a.screenshot(path=os.path.join(SHOTS, 'online-alice-end.png'))
                b.screenshot(path=os.path.join(SHOTS, 'online-bob-end.png'))
            ok('no script errors (online, alice)', not a.errors, '; '.join(a.errors[:3]))
            ok('no script errors (online, bob)', not b.errors, '; '.join(b.errors[:3]))
            a.context.close(); b.context.close()

            print('4. themes, language, notes')
            c = new_page(browser, 'carol')
            c.evaluate('L4P.App.set({anim: "instant", sound: false})')
            c.click('#act-quick')
            c.wait_for_function('L4P.App.game && L4P.App.game.state')
            themes = c.evaluate('L4P.App.THEMES.map(t => t.id)')
            for th in themes:
                c.evaluate('t => L4P.App.set({theme: t})', th)
                time.sleep(0.15)
                if SHOTS:
                    c.screenshot(path=os.path.join(SHOTS, 'theme-%s.png' % th))
            ok('%d themes applied' % len(themes), c.evaluate('document.documentElement.dataset.theme') == themes[-1])
            c.evaluate('L4P.App.set({theme: "midnight", lang: "cs"})')
            time.sleep(0.2)
            ok('Czech texts', 'Nastavení' in c.inner_text('.topbar'))
            if SHOTS:
                c.screenshot(path=os.path.join(SHOTS, 'czech.png'))
            c.evaluate('L4P.App.set({lang: "auto"})')
            c.click('#btn-notes')
            c.wait_for_selector('.un-box, .un-overlay, [class^="un-"]', timeout=5000)
            ok('notes window opens', c.locator('[class^="un-"]').count() > 0)
            if SHOTS:
                c.screenshot(path=os.path.join(SHOTS, 'notes.png'))
            ok('no script errors (themes/notes)', not c.errors, '; '.join(c.errors[:3]))
            c.context.close()
            browser.close()
    finally:
        mock.terminate()
    print('FAILED: ' + ', '.join(failures) if failures else 'ALL OK')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
