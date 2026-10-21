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
assets/js/ai.js         computer players (Easy / Normal / Hard)
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
- Legacy option `selfKick` (0.2.0, own tokens only, safe squares still protect) stays in the engine so old games replay
  the same way; Settings turn a saved `selfKick` into `onePerSquare`.
- Rules and speed belong to the game (`setup.rules`, `setup.speed`) and never change while it runs; Settings only
  holds the defaults for new games.

Positions: `-1` = yard, `0..50` = main track relative to the colour's start square, `51..55` = home column,
`56` = home (finished). Track cell of a token = `(START[colour] + rel) % 52`.

## Online protocol (chat messages)
Text of each chat message: `L4P1 ` + base64url(UTF-8 JSON). JSON always has `v` (protocol 1), `a` (app version),
`k` (kind), `id` (random, for de-duplication) and, for game messages, `g` (game id).

| kind | sent by | fields |
|---|---|---|
| `setup` | host (chat owner) | `seats[4]` (`null` or `{kind:'human'|'bot', user, level, name}`), `rules`, `first`, `speed`, `round`, `ask` (the new-round question it answers) |
| `move` | the player whose turn it is (host for computer seats) | `n` (move number), `c` (colour), `r` (roll), `t` (token or -1) |
| `resign` | a human player (0.1/0.2 apps) | `c`, `after` (their move counter when resigning) – this game only |
| `leave` | a human player | `c`, `after` – leaves the whole chat (all rounds); from the host it ends the game |
| `say` | anyone | `text` (short chat line / emoji) |
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
rules use `mustEnter` or `onePerSquare`+`protectOwn` (a 0.3.0 app would replay those differently).

Who runs the computer players online: the host's app. If the host is offline, the game waits on computer turns.

## Storage
- `data/settings.json` – all settings, written ~250 ms after each change (localStorage keeps a copy for an
  instant start; the data folder is the truth and follows the user to other devices).
- `data/local-games.json` – saved local games (setup + list of actions), the newest 30.
- `data/online-games.json` – online games this user created or opened (`{chatId: {title, added, opened}}`, deleted
  ones as `{removed}`), so they stay in the menu even when Peergos' chat lists leave them out.
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
  The red Peergos toast "CAS exception updating cryptree node" seen in tests came from Peergos' News feed refresh with
  no app running (`tests/peergos/probe_cas_game.py`).
- Each member's log is append-only and keeps every author's own order, but messages of different authors can
  be merged in a different order on each device – hence the order-independent protocol above.
