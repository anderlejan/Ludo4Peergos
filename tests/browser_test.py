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
    s = {'anim': 'instant', 'autoRoll': True, 'autoMove': True, 'sound': False, 'confirmLeave': False}
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
            # new round with the same players, in the same saved game (0.2.0)
            rec_id = pg.evaluate('L4P.App.game.sess.rec.id')
            pg.evaluate("document.getElementById('btn-rematch').click()")
            pg.wait_for_function('L4P.App.game && L4P.App.game.sess.rec && L4P.App.game.sess.rec.round === 2')
            rec = pg.evaluate('(() => { const r = L4P.App.game.sess.rec; return {id: r.id, round: r.round, rounds: r.rounds.length, actions: r.actions.length, over: L4P.App.game.state.over}; })()')
            ok('play again = round 2 of the same game', rec['id'] == rec_id and rec['rounds'] == 1 and not rec['over'], json.dumps(rec))
            ok('round 1 result kept (wins shown)', pg.locator('.pl-wins').count() == 4)
            # new round during a running game (asks first)
            pg.evaluate("document.getElementById('btn-new-round').click()")
            pg.wait_for_selector('.dlg-small .btn.primary')
            pg.click('.dlg-small .btn.primary')
            pg.wait_for_function('L4P.App.game.sess.rec.round === 3')
            ok('new round during the game = round 3, still one saved game', pg.evaluate('L4P.App.game.sess.rec.rounds.length') == 2)
            pg.click('.game-actions .btn:last-child')
            pg.wait_for_selector('.game-card')
            ok('home lists the saved game once', pg.locator('.game-card').count() == 1)
            ok('home card describes the setup (players, colour, speed, rules, round)', all(x in pg.inner_text('.game-card') for x in ('You: Red', 'Speed: Instant', 'Rules: standard rules', 'Round 3', 'Computer · Normal')), pg.inner_text('.game-card'))

            print('1b. quick game with 1 opponent and the saved settings; rules and speed locked in the game')
            # a 0.2.0 setting "selfKick" must come back as the 0.3.0 rule "one token per square" (for all tokens)
            pg.evaluate("L4P.App.set({level: 'hard', anim: 'fast', rules: Object.assign({}, L4P.Rules.DEFAULT_RULES, {selfKick: true})})")
            pg.evaluate("document.getElementById('quick-1').click()")
            pg.wait_for_function('L4P.App.game && L4P.App.game.state')
            setup = pg.evaluate('L4P.App.game.sess.rec.setup')
            ok('one opponent sits opposite (red vs yellow), level hard', setup['seats'][1] is None and setup['seats'][3] is None and setup['seats'][2]['kind'] == 'bot' and setup['seats'][2]['level'] == 'hard', json.dumps(setup['seats']))
            ok('saved rules and speed used (old selfKick → onePerSquare)', setup['rules']['onePerSquare'] is True and setup['rules']['selfKick'] is False and setup['speed'] == 'fast', json.dumps(setup['rules']))
            pg.evaluate("L4P.App.set({anim: 'slow', rules: Object.assign({}, L4P.Rules.DEFAULT_RULES)})")
            ok('changing settings does not change the running game', pg.evaluate('L4P.App.game.speedId') == 'fast' and pg.evaluate('L4P.App.game.currentRules().onePerSquare') is True)
            pg.click('#btn-settings')
            pg.click('.set-tab[data-sec="rules"]')
            ok('rules shown read-only during the game', pg.locator('.set-pane .rules.read-only input:disabled').count() == 8 and pg.locator('.set-pane .rules.read-only .seg-btn:disabled').count() == 4 and pg.locator('.lock-note').count() == 1)
            pg.click('.set-tab[data-sec="look"]')
            ok('speed locked during the game', pg.locator('#field-speed .seg-btn:disabled').count() == 4)
            ok('no full-screen button or setting any more', pg.locator('#btn-full').count() == 0 and 'full screen' not in pg.inner_text('.set-pane').lower())
            pg.keyboard.press('Escape')
            pg.click('#btn-game-rules')
            txt = pg.inner_text('.dlg-help')
            ok('How to play shows this game\'s rules (one token per square, own tokens protected)', 'Rules of this game' in txt and 'One token per square:' in txt and 'Your own tokens are protected' in txt and 'no safe squares' in txt and 'Speed: Fast' in txt, txt[:300])
            if SHOTS:
                pg.screenshot(path=os.path.join(SHOTS, 'help-game.png'))
            pg.keyboard.press('Escape')
            if SHOTS:
                pg.screenshot(path=os.path.join(SHOTS, 'quick-1.png'))
            pg.evaluate("L4P.App.set({level: 'normal', anim: 'instant', quickOpponents: 3})")
            pg.click('.game-actions .btn:last-child')
            pg.wait_for_selector('.game-card')
            pg.click('#btn-help')
            txt = pg.inner_text('.dlg-help')
            ok('How to play from the menu shows the rules for new games', 'Rules for new games' in txt and 'Your own tokens may share a square' in txt, txt[:200])
            pg.keyboard.press('Escape')
            # Settings → Rules: "one token per square" switches the safe squares off (same rule for all tokens)
            pg.click('#btn-settings')
            pg.click('.set-tab[data-sec="rules"]')
            ok('three tries rule described clearly', 'Three tries to roll a 6 while none of your tokens is on the board' in pg.inner_text('.set-pane'))
            ok('no stray "null" in Settings → Rules or its header', 'null' not in pg.inner_text('.dlg-settings'), pg.inner_text('.dlg-settings')[:300])
            pg.click('.rule-row[data-rule="onePerSquare"] .slider')
            time.sleep(0.3)
            ok('with one token per square the safe squares stay switchable (0.5.0) and are explained', pg.locator('#rule-safeSquares:disabled').count() == 0 and 'cannot be captured' in pg.inner_text('.rule-row[data-rule="safeSquares"]'))
            before = pg.evaluate('L4P.App.settings().rules.safeSquares')
            pg.click('.rule-row[data-rule="safeSquares"] .slider')
            time.sleep(0.3)
            ok('safe squares can be changed', pg.evaluate('L4P.App.settings().rules.safeSquares') is (not before))
            pg.click('.rule-row[data-rule="safeSquares"] .slider')
            time.sleep(0.3)
            ok('rule saved', pg.evaluate('L4P.App.settings().rules.onePerSquare') is True)
            ok('no stray "null" while saving', 'null' not in pg.inner_text('.dlg-settings'))
            if SHOTS:
                pg.screenshot(path=os.path.join(SHOTS, 'settings-rules.png'))
            pg.click('.rule-row[data-rule="onePerSquare"] .slider')
            time.sleep(0.3)
            ok('one token per square off again', pg.locator('#rule-safeSquares:disabled').count() == 0 and pg.evaluate('L4P.App.settings().rules.onePerSquare') is False)
            # the user's case: a rule switched on in Settings must reach a game started from the New game dialog
            pg.click('.set-tab[data-sec="rules"]')
            pg.click('.rule-row[data-rule="mustEnter"] .slider')
            time.sleep(0.3)
            ok('"a 6 must bring a token out" saved in Settings', pg.evaluate('L4P.App.settings().rules.mustEnter') is True)
            pg.keyboard.press('Escape')
            pg.click('#act-new')
            pg.wait_for_selector('.dlg-new')
            ok('New game dialog starts from the Settings rules', pg.evaluate("document.querySelector('.dlg-new #rule-mustEnter').checked") is True)
            pg.evaluate("L4P.App.set({autoRoll: false, autoMove: true, anim: 'instant'})")
            pg.click('.dlg-new .btn.primary')
            pg.wait_for_function('L4P.App.game && L4P.App.game.state')
            ok('the game from the dialog has the rule', pg.evaluate('L4P.App.game.sess.rec.setup.rules.mustEnter') is True)
            # make the die roll sixes; whoever starts, wait for our turn, then: 6 (bring one out), 6 (must bring another)
            pg.evaluate("() => { crypto.getRandomValues = arr => { arr.fill(5); return arr; }; }")
            me = pg.evaluate("L4P.App.game.state.seats.findIndex(s => s && s.kind === 'human')")
            end = time.time() + 30
            rolls = 0
            while time.time() < end and rolls < 2:
                if pg.evaluate("L4P.App.game.phase === 'roll' && L4P.App.game.state.turn === %d" % me):
                    pg.evaluate("document.getElementById('die').click()"); rolls += 1
                    time.sleep(1.0)
                time.sleep(0.1)
            toks = pg.evaluate('L4P.App.game.state.tokens[%d]' % me)
            ok('a second 6 brought a second token out (not the one already out moved on)', sorted(toks) == [-1, -1, 0, 0], json.dumps(toks))
            ok('the game said why ("A 6 must bring a token out")', 'must bring a token out' in pg.inner_text('body'))
            # 0.6.0 (enterGrace): with one token per square, the 6 right after bringing a token out moves it on
            pg.evaluate("L4P.App.set({rules: Object.assign({}, L4P.App.settings().rules, {mustEnter: true, onePerSquare: true}), autoRoll: false, autoMove: true, anim: 'instant'})")
            pg.evaluate("() => L4P.App.quickGame(1)")
            pg.wait_for_function('L4P.App.game && L4P.App.game.state && L4P.App.game.sess.rec.setup.rules.enterGrace === true')
            me = pg.evaluate("L4P.App.game.state.seats.findIndex(s => s && s.kind === 'human')")
            end = time.time() + 30
            rolls = 0
            while time.time() < end and rolls < 2:
                if pg.evaluate("L4P.App.game.phase === 'roll' && L4P.App.game.state.turn === %d" % me):
                    pg.evaluate("document.getElementById('die').click()"); rolls += 1
                    time.sleep(1.0)
                time.sleep(0.1)
            toks = pg.evaluate('L4P.App.game.state.tokens[%d]' % me)
            ok('one token per square: 6 brings a token out, the next 6 moves it on by six (not kicked)', sorted(toks) == [-1, -1, -1, 6], json.dumps(toks))
            ok('the game said why ("can move on")', 'can move on' in pg.inner_text('body'))
            pg.evaluate("L4P.App.set({rules: Object.assign({}, L4P.App.settings().rules, {mustEnter: false, onePerSquare: false}), autoRoll: true})")
            pg.reload(); pg.wait_for_function('window.L4P && window.L4P.App && document.querySelector("#main")')
            time.sleep(1.0)
            pg.click('#btn-settings')
            pg.click('.set-tab[data-sec="sound"]')
            ok('chat sound can be tried in Settings', pg.locator('#btn-test-chat').count() == 1)
            pg.keyboard.press('Escape')

            print('2. settings saved at once and restored')
            pg.click('#btn-settings')
            pg.click('.set-tab[data-sec="look"]')
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
            spy = "window.__snd = []; const p0 = L4P.Sound.play; L4P.Sound.play = n => { window.__snd.push(n); return p0(n); }"
            a.evaluate(spy); b.evaluate(spy)
            b.fill('.chat-input .text-in', 'Ahoj 👋')
            b.press('.chat-input .text-in', 'Enter')
            finished = play_until_over([a, b], timeout=400)
            ok('online game reaches the end on both sides', finished)
            sa = a.evaluate('JSON.stringify(L4P.App.game.state.tokens) + "|" + L4P.App.game.state.n')
            sb = b.evaluate('JSON.stringify(L4P.App.game.state.tokens) + "|" + L4P.App.game.state.n')
            ok('both players end in the same state', sa == sb, sa + ' vs ' + sb)
            ok('chat message arrived at alice (chat panel on the right)', 'Ahoj' in a.inner_text('.side-right'))
            ok('alice heard the chat sound, bob (the sender) did not', 'chat' in a.evaluate('window.__snd') and 'chat' not in b.evaluate('window.__snd'))
            # new round in the same chat: bob asks, alice agrees, alice's app (host) starts it
            end = time.time() + 10
            while time.time() < end and not b.evaluate("!!document.getElementById('btn-rematch')"):
                time.sleep(0.2)
            ok('the winner dialog offers bob a new round', b.evaluate("!!document.getElementById('btn-rematch')"))
            b.evaluate("document.getElementById('btn-rematch').click()")
            end = time.time() + 60
            while time.time() < end and not a.evaluate("!!document.getElementById('btn-agree')"):
                time.sleep(0.2)
            ok('alice is asked to agree', a.evaluate("!!document.getElementById('btn-agree')"))
            time.sleep(0.5)
            ok('the question is not hidden behind alice\'s results dialog', a.locator('.dlg-winner').count() == 0)
            a.evaluate("document.getElementById('btn-agree').click()")
            end = time.time() + 60
            while time.time() < end and not (a.evaluate('L4P.App.game.replay.rounds.length') == 2 and b.evaluate('L4P.App.game.replay.rounds.length') == 2):
                time.sleep(0.2)
            ok('round 2 started on both sides', a.evaluate('L4P.App.game.replay.rounds.length') == 2 and b.evaluate('L4P.App.game.replay.rounds.length') == 2)
            ok('chat kept across rounds', 'Ahoj' in b.inner_text('.side-right') and 'Round 2' in b.inner_text('.side-right'))
            ok('wins of round 1 shown', a.locator('.pl-wins').count() == 3)
            if SHOTS:
                a.screenshot(path=os.path.join(SHOTS, 'online-alice-end.png'))
                b.screenshot(path=os.path.join(SHOTS, 'online-bob-end.png'))
            # bob leaves the game: alice is told, her computer plays yellow; bob's list still has the game
            b.evaluate("document.getElementById('btn-leave').click()")
            b.wait_for_selector('.dlg-small .btn.primary')
            ok('leave asks first', 'for good' in b.inner_text('.dlg-small'))
            b.click('.dlg-small .btn.primary')
            b.wait_for_selector('#games-list .game-card.online', timeout=20000)
            time.sleep(1.5)
            ok('bob is back in the menu, the game is listed as left', 'You left' in b.inner_text('#games-list'), b.inner_text('#games-list')[:300])
            end = time.time() + 30
            while time.time() < end and 'bob left the game' not in a.inner_text('.side-right'):
                time.sleep(0.2)
            ok('alice sees "bob left the game" in the chat', 'bob left the game' in a.inner_text('.side-right'))
            ok('alice heard the leave sound', 'leave' in a.evaluate('window.__snd'))
            ok('alice\'s app knows that bob left', a.evaluate("L4P.App.game.replay.left.indexOf('bob') >= 0"))
            ok('yellow is now played by the computer', '(computer)' in a.inner_text('.players'))
            finished = play_until_over([a], timeout=300)
            dbg = a.evaluate("(() => { const g = L4P.App.game; const st = g.state; return {phase: g.phase, busy: g.busy, n: st.n, turn: st.turn, over: st.over, repN: g.replay.state.n, shownN: g.shownN, ctl: g.replay.controller(st.turn, st.n), resigned: g.replay.resignedAt, status: document.querySelector('.status').textContent}; })()")
            ok('alice can finish the game alone after bob left', finished, json.dumps(dbg))
            # Peergos leaves the chat out of its lists: bob's list still shows it (the app remembers opened games)
            post('/mock/hide-list', {'user': 'bob', 'v1': True})
            b.evaluate('L4P.App.renderHome()')
            time.sleep(1.5)
            ok('game listed when only the v0 list has it', b.locator('#games-list .game-card.online').count() == 1)
            post('/mock/hide-list', {'user': 'bob', 'v0': True, 'v1': True})
            b.evaluate('L4P.App.renderHome()')
            time.sleep(1.5)
            ok('game listed when no Peergos list has it (remembered in the data folder)', b.locator('#games-list .game-card.online').count() == 1)
            ok('remembered games are saved to the data folder', chat in mock_state()['data']['bob'].get('online-games.json', ''))
            post('/mock/hide-list', {'user': 'bob'})
            if SHOTS:
                a.screenshot(path=os.path.join(SHOTS, 'online-alice-after-leave.png'))
                b.screenshot(path=os.path.join(SHOTS, 'online-bob-home-left.png'))
            ok('no script errors (online, alice)', not a.errors, '; '.join(a.errors[:3]))
            ok('no script errors (online, bob)', not b.errors, '; '.join(b.errors[:3]))
            a.context.close(); b.context.close()

            print('3b. the host leaves: the game ends for everybody')
            a = new_page(browser, 'alice')
            fast(a)
            a.click('#act-friends')
            a.wait_for_selector('.dlg-new')
            post('/mock/invite-order', {'order': ['carol']})
            a.click('.dlg-new .btn.primary')
            a.wait_for_function('L4P.App.game && L4P.App.game.replay && L4P.App.game.replay.setup', timeout=10000)
            chat2 = a.evaluate('L4P.App.game.sess.chatId')
            post('/mock/join', {'chat': chat2, 'user': 'carol'})
            c = new_page(browser, 'carol', '&chatId=' + urllib.request.quote(chat2, safe='$'))
            fast(c, autoRoll=False)
            c.wait_for_function('L4P.App.game && L4P.App.game.replay && L4P.App.game.replay.setup', timeout=10000)
            a.evaluate("document.getElementById('btn-leave').click()")
            a.wait_for_selector('.dlg-small .btn.primary')
            ok('host is warned that the game ends for everybody', 'ends for everybody' in a.inner_text('.dlg-small'))
            a.click('.dlg-small .btn.primary')
            end = time.time() + 30
            while time.time() < end and not c.evaluate('!!(L4P.App.game && L4P.App.game.replay && L4P.App.game.replay.hostLeft)'):
                time.sleep(0.2)
            time.sleep(0.5)
            ok('carol sees that the host left and the game ended', 'the game has ended' in c.inner_text('.status') and c.evaluate('L4P.App.game.phase') == 'ended', c.inner_text('.status'))
            ok('no new-round or leave buttons for carol after that', c.locator('#btn-new-round').count() == 0 and c.locator('#btn-leave').count() == 0)
            if SHOTS:
                c.screenshot(path=os.path.join(SHOTS, 'online-host-left.png'))
            ok('no script errors (host leaves)', not a.errors and not c.errors, '; '.join((a.errors + c.errors)[:3]))
            a.context.close(); c.context.close()

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

            print('4b. "Roll again" only on your own turn – English and Czech')
            for lang, mine_text, other in (('en', 'Roll again', 'rolls again'), ('cs', 'Házíš znovu', 'hází znovu')):
                c = new_page(browser, 'carol')
                c.evaluate("l => L4P.App.set({anim: 'instant', sound: false, autoRoll: true, autoMove: true, lang: l, confirmLeave: false})", lang)
                c.evaluate("L4P.App.bannerLog.length = 0")
                c.click('#act-quick')
                c.wait_for_function('L4P.App.game && L4P.App.game.state')
                play_until_over([c], timeout=120)
                log = c.evaluate('L4P.App.bannerLog')
                wrong = [b for b in log if b['text'] == mine_text and not b['mine']]
                ok('%s: "%s" never shown on another player\'s turn (%d banners)' % (lang, mine_text, len(log)), not wrong and len(log) > 20, json.dumps(wrong[:3], ensure_ascii=False))
                ok('%s: others rolling again are named ("… %s")' % (lang, other), any(other in b['text'] and not b['mine'] for b in log))
                ok('%s: your own extra roll says "%s"' % (lang, mine_text), any(b['text'] == mine_text and b['mine'] for b in log))
                c.evaluate("L4P.App.set({lang: 'auto'})")
                c.context.close()

            print('5. Peergos never answers the chat list (as it can): Notes still opens, the app keeps working')
            post('/mock/hang', {'user': 'carol', 'paths': ['/peergos-api/v1/chat']})
            c = new_page(browser, 'carol')
            c.evaluate('L4P.App.set({anim: "instant", sound: false})')
            time.sleep(1.0)
            t0 = time.time()
            c.click('#btn-notes')
            opened = False
            while time.time() - t0 < 12 and not opened:
                opened = c.locator('.un-overlay').count() > 0
                time.sleep(0.1)
            ok('Notes opens while a Peergos call hangs (%.1f s)' % (time.time() - t0), opened)
            if SHOTS:
                c.screenshot(path=os.path.join(SHOTS, 'notes-while-hanging.png'))
            c.keyboard.press('Escape')
            c.evaluate("L4P.App.set({theme: 'forest'})")
            time.sleep(1.0)
            ok('settings are still saved while the chat list hangs', json.loads(mock_state()['data']['carol']['settings.json'])['theme'] == 'forest')
            end = time.time() + 20
            while time.time() < end and 'Looking for online games' in c.inner_text('#games-list'):
                time.sleep(0.5)
            ok('the game list gives up on the unanswered list after its time limit', 'Looking for online games' not in c.inner_text('#games-list'), c.inner_text('#games-list')[:200])
            post('/mock/hang', {'user': 'carol', 'paths': []})
            ok('no script errors (hanging Peergos call)', not [e for e in c.errors if 'did not answer' not in e], '; '.join(c.errors[:3]))
            c.context.close()

            print('6. a far-away player (slow chat reads) who switches windows: the game never stalls (0.5.0 did)')
            a = new_page(browser, 'alice')
            a.evaluate("L4P.App.set({anim: 'fast', autoRoll: true, autoMove: true, sound: false, confirmLeave: false, rules: L4P.Rules.DEFAULT_RULES})")
            a.click('#act-friends')
            a.wait_for_selector('.dlg-new')
            a.click('.seat-row:nth-child(2) .seg-btn:has-text("Computer")')
            post('/mock/invite-order', {'order': ['bob']})
            a.click('.dlg-new .btn.primary')
            a.wait_for_function('L4P.App.game && L4P.App.game.replay && L4P.App.game.replay.setup', timeout=15000)
            chat3 = a.evaluate('L4P.App.game.sess.chatId')
            post('/mock/join', {'chat': chat3, 'user': 'bob'})
            post('/mock/delay', {'user': 'bob', 'paths': ['/peergos-api/v1/chat/'], 'seconds': 2.5})
            b = new_page(browser, 'bob', '&chatId=' + urllib.request.quote(chat3, safe='$'))
            b.evaluate("L4P.App.set({anim: 'fast', autoRoll: true, autoMove: true, sound: false, confirmLeave: false})")
            b.wait_for_function('L4P.App.game && L4P.App.game.replay && L4P.App.game.replay.setup', timeout=30000)
            end = time.time() + 90; k = 0; last_n = -1; last_t = time.time(); stalled = None
            while time.time() < end:
                k += 1
                if k % 7 == 0:
                    b.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
                for pg in (a, b):
                    pg.evaluate("() => { const g = L4P.App.game; if (g && g.phase === 'pick') { const t = document.querySelector('.tok.pickable'); if (t) t.dispatchEvent(new MouseEvent('click', {bubbles: true})); } }")
                sa = a.evaluate("(() => { const g = L4P.App.game; return {n: g.state.n, over: g.state.over, phase: g.phase}; })()")
                if sa['n'] != last_n: last_n, last_t = sa['n'], time.time()
                elif time.time() - last_t > 30 and not sa['over']:
                    stalled = sa; break
                if sa['over']: break
                time.sleep(0.4)
            sb = b.evaluate("(() => { const g = L4P.App.game; return {n: g.state.n, net: document.querySelector('.net-state').textContent}; })()")
            ok('no stall in 90 s (moves keep coming: %d)' % last_n, stalled is None and last_n >= 15, json.dumps(stalled))
            ok('bob is never shown "Not connected" for slow reads', 'Not connected' not in sb['net'], sb['net'])
            post('/mock/delay', {'user': 'bob', 'paths': [], 'seconds': 0})
            ok('no script errors (slow reads)', not [e for e in a.errors + b.errors if 'did not answer' not in e], '; '.join((a.errors + b.errors)[:3]))
            a.context.close(); b.context.close()
            browser.close()
    finally:
        mock.terminate()
    print('FAILED: ' + ', '.join(failures) if failures else 'ALL OK')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
