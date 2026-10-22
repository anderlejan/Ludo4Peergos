# Ludo4Peergos – design notes (developer documentation)

## What it is
A Ludo game that runs as a sandboxed Peergos custom app. Play against the computer (any number of computer
players), hot-seat on one device, or online with Peergos friends. Online games travel as messages in a Peergos
app chat, so they are end-to-end encrypted like every other Peergos chat.

## Files
```
peergos-app.json        manifest (name "ludo4peergos" is the app's identity – never change it)
assets/index.html       entry point (classic scripts, no build step, no external requests – CSP forbids them)
assets/css/app.css      layout + themes (CSS variables per theme)
assets/js/version.js    app version (must match the manifest; the release script checks)
assets/js/i18n.js       English + Czech strings
assets/js/rules.js      board geometry and the pure game engine (Node + browser)
assets/js/ai.js         computer players (Easy / Normal / Hard – see "Computer players")
assets/js/protocol.js   online protocol: encode/decode messages, replay a chat log into a game state
assets/js/storage.js    settings + saved games: Peergos data folder, localStorage cache
assets/js/net.js        Peergos chat API wrapper (create, list, read, send, delete)
assets/js/sound.js      Web Audio sound effects (generated, no audio files)
assets/js/board.js      SVG board, tokens, animations
assets/js/ui.js         small DOM helpers, dialogs, toasts
assets/js/app.js        screens and the controller
assets/usernotes/       the User notes module (feedback notes → prompts; unchanged copy of its master)
tests/                  node unit tests, mock Peergos server, Playwright tests
tools/make_release.py   builds releases/Ludo4Peergos-v<ver>.zip + source zip, checksums, never overwrites
```

## Rules (defaults, all switchable per game)
- 2–4 colours, turn order Red → Green → Yellow → Blue (clockwise).
- Leave the yard with a 6 (option: 1 or 6). Up to 3 tries per turn while no token is out.
- A 6 gives another roll; the third 6 in a row ends the turn without moving.
- Landing on an opponent sends it back to its yard, except on safe squares (start squares and stars).
- A capture and a token reaching home also give another roll.
- Home needs the exact number. The game ends when the first player has all four tokens home
  (option: play on for all places).
- Option `onePerSquare` (off by default, 0.3.0): one token per square for every token – landing on any token, own or
  opponent's, sends it to its yard; safe squares do not protect then (`Rules.protects`). An opponent hit counts as a
  capture (bonus roll), an own token does not. Opponents' home columns are never reached.
- Option `mustEnter` (off by default, 0.4.0): with a 6, while a token is in the yard, the only legal moves are the
  yard tokens (an own token on the start square goes back under `onePerSquare`).
- `protectOwn` (0.4.0, not a visible option – Settings set it for every new game): with `onePerSquare`, a move may not
  land on an own token (track or home column), except the forced entry of `mustEnter`. Games without the key (0.3.0)
  keep kicking own tokens.
- `safeBlock` (0.5.0, hidden like `protectOwn`, set for every new game): safe squares also work with `onePerSquare` –
  a token on a safe square cannot be captured, so a move onto a safe square holding an opponent is not legal, except a
  token entering on its own start square (it captures). Without the key (older games) `onePerSquare` ignores safe squares.
- `enterGrace` (0.6.0, hidden, set for every new game): with `mustEnter` + `onePerSquare`, a 6 right after the 6 that
  brought a token onto the empty start square (`state.last`: own entry, `selfKicked` 0, token still on start,
  `sixes ≥ 1`) is not forced to enter; the normal moves apply (own tokens protected).
- Settings are the one source of rules and speed for new games: the New game dialog starts from them and saves back.
- Legacy option `selfKick` (0.2.0, own tokens only, safe squares still protect) stays in the engine so old games replay
  the same way; Settings turn a saved `selfKick` into `onePerSquare`.
- Rules and speed belong to the game (`setup.rules`, `setup.speed`); Settings only holds the defaults for new games.
  0.7.0: until the first roll of a round the rules can still change (a local game: the player; online: the host, see
  the protocol); the first roll locks them.
- Numbers (0.7.0, `Rules.RULE_ORDER` / `ruleNo`, never reorder – a new rule gets the next number): 1 `enterOn`,
  2 `mustEnter`, 3 `threeTries`, 4 `sixBonus`, 5 `threeSixes`, 6 `captureBonus`, 7 `finishBonus`, 8 `onePerSquare`,
  9 `safeSquares`, 10 `endMode`, 11 `selfKick` (old games only). `Rules.changedRules(a, b)` lists the numbers that play
  differently (`effectiveRules`: before 0.5.0, safe squares did nothing together with one token per square).
- Rule sets (0.7.0, app.js): built-in `standard` (the defaults) and `czech` – "Člověče, nezlob se!" as the common Czech
  editions describe it (rules sheets of Alza and EFKO, checked 2026-10-22; a Piatnik sheet lists the extra roll after a 6
  only as an optional agreement): enter with a 6, a 6 rolls again (no third-six
  limit), three tries, captures give no extra roll, no extra roll for reaching home, one token per square with own tokens
  blocking, no safe squares, the first home wins. Own sets live in `settings.ruleSets` (`[{id, name, rules}]`, the
  numbered rules only, at most 20). A setup records where its rules came from: `rulesSet` (built-in id) or `rulesName`.

Positions: `-1` = yard, `0..50` = main track relative to the colour's start square, `51..55` = home column,
`56` = home (finished). Track cell of a token = `(START[colour] + rel) % 52`.

## Computer players (`ai.js`, 0.7.0)
All three levels get the legal moves from the engine (`Rules.legalMoves`) and look at positions through it (captures,
safe squares, extra rolls, entering, end of game), so they play every rule set by its rules.
- **Easy** – 60 % a random move, otherwise the token that gets furthest, avoiding captures. A child-like player
  (captures when it sees one, likes to bring tokens out) beats it about two games in three.
- **Normal** – the one-move heuristic `score()` (0.6.0's Hard): capture (more for advanced tokens), bring out, home
  column and home, safe squares, progress, escaping / avoiding squares within 1–6 of an opponent, not stacking, chasing.
- **Hard** – an evaluation of the whole position plus a look at the next rolls:
  - *race* (`raceOf`): the expected rolls each colour needs to get home if nobody interferes – an exact dynamic
    programme (`exactTable`, ~20 ms once per rule variant) for the three tokens furthest from home, with the exact roll
    at the end, the entering roll and (one token per square) own tokens blocking; turned into turns with the rules'
    rolls per turn and three tries;
  - *win chances* (`utility`): race times compared pairwise (logistic, variance from the remaining rolls), the player to
    move has a head start; "first home wins" → my chance to win, "all places" → expected share of opponents beaten;
  - *danger* (`hitChance`): for every token on the track, the chance it is captured before its owner moves again –
    exact rolls 1–6, 6-then-the-rest with a bonus roll, entering onto a start square, a 6 that must bring a token out,
    safe squares – in turn order; `evaluate` = win chances + Σ chance × (win chances after that capture). This is what
    values chasing the last token of a player about to win and keeping its own leading token out of reach;
  - *look-ahead* (`lookahead`, depth 2): the next player rolls 1–6 and plays its best reply by the same evaluation; in a
    two-player game (or after my bonus roll) my next roll is looked at too. ~0.5–1 ms a move (max ~60 ms) in Node.
  - the one-move heuristic is blended in with a tiny weight (`TUNE.blend`) for tactics the evaluation is blind to.
  - Measured (fixed dice, thousands of games): Hard beats Normal 57 % (standard rules) / 58 % (Czech rules) of
    two-player games and wins 28.6 % of four-player games against three Normal players (25 % = even); in four-player
    Czech games (no safe squares, many captures) it is about even with Normal. Unit tests keep five positions where Hard
    must not make a dumb move (e.g. chase the last token of a player about to win instead of moving a token in the home
    column – the move Normal makes there).

## Online protocol (chat messages)
Text of each chat message: `L4P1 ` + base64url(UTF-8 JSON). JSON always has `v` (protocol 1), `a` (app version),
`k` (kind), `id` (random, for de-duplication) and, for game messages, `g` (game id).

| kind | sent by | fields |
|---|---|---|
| `setup` | host (chat owner) | `seats[4]` (`null` or `{kind:'human'|'bot', user, level, name}`), `rules`, `first`, `speed`, `round`, `ask` (the new-round question it answers); 0.7.0: `agree` (players may agree on the rules), `rulesSet` / `rulesName` (where the rules come from), `replaces` (id of the setup whose rules it changes before the first roll) |
| `move` | the player whose turn it is (host for computer seats) | `n` (move number), `c` (colour), `r` (roll), `t` (token or -1) |
| `resign` | a human player (0.1/0.2 apps) | `c`, `after` (their move counter when resigning) – this game only |
| `leave` | a human player | `c`, `after` – leaves the whole chat (all rounds); from the host it ends the game |
| `say` | anyone | `text` (short chat line / emoji); 0.7.0: `rulesOk` (true/false: agrees with the rules of game `g`), `offer` (`{rules, rulesSet?, rulesName?}`: a suggested rule set) – the text says the same for older apps |
| `restartAsk` | a human player | asks for a new round of the current game `g` |
| `restartVote` | a human player | `ask` (id of the question), `yes` (false closes the question) |

Replay (`Protocol.replay`): the current game is the last `setup` from the host (each author's messages keep their
order in every member's copy). Moves of that game are applied in move-number order: move `n` is accepted only when
the state is at `n`, the colour is to play, the author controls that seat and the move is legal. Messages that
arrive early wait in a pool. Because only one author can ever make move `n`, the result does not depend on the
order in which Peergos merges the members' logs. A resigned seat is played by the host's computer from move
`after` on. `leave` works like `resign` for the round it names and from move 0 in every later round (a new round the
host started before it saw the leave); new rounds give left players' seats to computer players. When the host leaves,
`replay` sets `hostLeft` and every app stops the game (nobody else can run the computer players). The roller rolls on
their own device (crypto random) – fine among friends.

New round: when every human player who still plays himself (not handed over) has agreed (the asker counts as yes),
the host's app sends a new `setup` with the same seats, rules and speed, `round + 1` and `ask` = the question's id; it
checks first that no setup for that question exists. Every round of the chat is replayed (`rounds`: results, wins).
Protocol version 2 (app 0.2.0) added `speed`, `round`, `ask`, the restart messages and the rule `selfKick`; a 0.1.0 app
ignores protocol-2 messages and asks its user to update. Protocol 3 (app 0.3.0) added `leave` and the rule
`onePerSquare`; 0.2.0 apps ignore protocol-3 messages and ask to update. Each message carries the lowest protocol
that understands it (`setup` and `leave` = 3, everything else = 2), so a 0.3.0 player can still play in a game a
0.2.0 host started (only a `leave` is not seen by that host). Protocol 4 (app 0.4.0): a setup is stamped 4 only when its
rules use `mustEnter` or `onePerSquare`+`protectOwn` (a 0.3.0 app would replay those differently). Protocol 5 (app 0.5.0):
a setup with `onePerSquare` + `safeSquares` + `safeBlock`. Protocol 6 (app 0.6.0): `mustEnter` + `onePerSquare` + `enterGrace`.

Changing the rules before the first roll (0.7.0): the host sends a new `setup` of the same round with the same seats,
`first`, `speed` (and `ask`, `agree`) and `replaces` = the current setup's id. `replay` treats a replaced setup as no
round of its own, puts a `{kind: 'rules', changed: [numbers]}` line into the timeline instead of a second round line,
and lets a `resign`/`leave` sent for the replaced setup count for the new one. The new setup is simply the last one, so
apps of 0.6.0 play it the same way (they only show the round line twice) – no new protocol version. If a player's move
for the replaced setup crosses the change, it is ignored (the change wins; the app only offers it while no move is
known). `votes` (`{user: true|false}`) are the players' last `rulesOk` for the current setup. With `agree` set and a
computer player to begin, the host's app waits for the host to start the game with the die (phase `start`, or after
the think time with "roll automatically"); without `agree` the computer starts at once.

Deleting an online game from the list (0.7.0): while the user still plays in it, the app first sends `leave` (same as
**Leave game**) and hides the game (`online-games.json`: `{removed, purge}`); its copy of the chat is deleted
(`DELETE /peergos-api/v0/chat/<id>`) only a week later (`purgeRemoved` at start). Peergos hands a member's messages to
the others only from that member's copy (`Messenger.mergeMessages` reads the member's chat mirror), so deleting it at
once loses every message not merged yet – on a real 1.39 server the `leave` never arrived. When a member's copy is
gone, the chat OWNER's Peergos client writes a `RemoveMember` entry (`removeUsername`) on its next merge (non-admins
silently stop reading that member); `replay` treats that entry as a `leave` of that player, handed over after the
player's last move. That covers players with older apps who delete a game (0.6.0 deleted at once, sending nothing).
A member who joins and deletes before the owner ever read their log stays "invited" in the owner's view (Peergos
treats them as a pending member and writes nothing). Before 0.7.0 a delete sent nothing and the others waited for
ever.

Who runs the computer players online: the host's app. If the host is offline, the game waits on computer turns; nothing
is lost – every open replays the whole chat.

## Storage
- `data/settings.json` – all settings, written ~250 ms after each change (localStorage keeps a copy for an
  instant start; the data folder is the truth and follows the user to other devices).
- `data/local-games.json` – saved local games (setup + list of actions), the newest 30.
- `data/online-games.json` – online games this user created or opened (`{chatId: {title, added, opened}}`, deleted
  ones as `{removed, purge?}` – `purge`: when to delete the Peergos copy of the chat), so they stay in the menu even
  when Peergos' chat lists leave them out.
- `data/user-notes.json`, `data/notes-texts/*.md` – User notes module.

## Peergos facts this relies on
- The app's files are served from an isolated origin with a strict CSP: no external requests, everything is bundled.
- `/peergos-api/v0/data/` is the app's private folder (`STORE_APP_DATA`).
- Chats of an app have ids `chat-ludo4peergos$<owner>$<uuid>`. `POST /peergos-api/v0/chat/` opens Peergos' own
  "add friends" dialog; invited friends get the invitation in their News feed and open the game with **Join**, which
  launches the app with `?chatId=`. Every read (`GET /peergos-api/v1/chat/<id>?startIndex=`) merges the other
  members' message logs, so new moves arrive by polling.
- The chat list: `GET /peergos-api/v1/chat/` (with members) leaves out chats whose recent-message list is empty;
  `GET /peergos-api/v0/chat/` lists every chat of the app. The app asks both and shows the union, plus remembered games.
- Peergos calls (`Storage.api`): chat calls run one at a time in the 'chat' queue, data-folder writes in the 'data'
  queue, data reads directly; every call has a time limit (30 s; chat list 12 s; the friend-picker POST none, it waits
  for the user). Peergos can leave a request unanswered for good – its v1 chat list has no error path when one chat
  fails to load (`buildLatestMessageMap` in AppSandbox.vue, 1.38 and 1.39) – and in 0.3.0 such a call blocked the one
  shared queue, so the Notes window never opened. `tests/mock_peergos.py` `POST /mock/hang` reproduces it.
  0.6.0: sends have their own queue ('chatSend', 60 s) next to reads ('chat', 90 s); measured far from the server
  (+1.2 s per request) a read takes 25–27 s, and in 0.5.0 every move waited behind one. One poll at a time.
  Turn code compares positions (move number, turn, tokens), not state objects: a chat update can hand over an equal
  state as a new object, and in 0.5.0 that stopped a turn waiting on its banner for good (`tests/browser_test.py` 6).
  The red Peergos toast "CAS exception updating cryptree node" seen in tests came from Peergos' News feed refresh with
  no app running (`tests/peergos/probe_cas_game.py`).
- Each member's log is append-only and keeps every author's own order, but messages of different authors can
  be merged in a different order on each device – hence the order-independent protocol above.
