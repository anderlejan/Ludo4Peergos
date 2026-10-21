# Changelog

## 0.4.0 – test feedback round 3
- New rule (off by default): **a 6 must bring a token out** of the yard while one is there. With "one token per
  square" this also sends your own token on the start square back to the yard – the one case where that happens.
- "One token per square" now protects your own tokens: you cannot move onto a square where one of yours stands
  (opponents are still sent home, on every square). Games started with 0.3.0 keep their old rule.
- Fixed: the board said "Roll again" also when the computer or another player rolled again; it now says who it is
  ("Green rolls again" / "Zelený hází znovu"). Checked in English and Czech.
- Fixed: the **Notes** button did nothing when Peergos left a request unanswered (Peergos' chat list can stay
  unanswered for good when one chat fails to load – likely in the Peergos Windows app). The app no longer lets one
  unanswered call block anything else: every call has a time limit, chat calls and data saves wait in separate
  queues, reads of the app's own files do not wait at all, and Notes opens with this device's copy if Peergos is slow.
- Online protocol 4: only new games that use the new rules ask 0.3.0 players to update.

## 0.3.0 – test feedback round 2
- Online games you play in are always in the menu list now, also games a friend started: the app remembers every
  online game you open (also from the Peergos News feed) in its data folder, and asks both Peergos chat lists
  (one of them leaves out some chats). The list refreshes by itself every 30 seconds and when you come back to the app.
  An invitation still has to be opened once with **Join** in the News feed – before that, apps cannot see it.
- **Leave game** (replaces "Hand over to the computer"): the other players are told in the chat (with a sound and a
  message), and the host's computer plays your colour from then on, also in new rounds. If the host leaves, the game
  ends for everybody. Your menu shows the game as "You left".
- The full-screen button and setting are gone: Peergos never lets apps use full screen.
- Rule "three tries" (it was already there, on by default) now says clearly what it does: three tries to roll a 6
  while none of your tokens is on the board.
- **One token per square** now holds for all tokens: landing on any token – yours or an opponent's – sends it back to
  its yard, also on start squares and stars (safe squares are switched off with this rule, so the same rule holds for
  everybody). Your saved setting from 0.2.0 is carried over. The computer players know the rule.
- New sound when another player writes in the game chat (different from the other sounds; try it in Settings → Sound),
  and the chat panel flashes.
- All calls to Peergos (chat and the app's data folder) are made one at a time, as a safeguard against overlapping
  updates. (A red "CAS exception updating cryptree node" message seen in tests came from Peergos' own News feed refresh,
  not from the app.)
- Fixed: the status said "You's turn" while your own die was rolling.
- Online protocol 3: games started by 0.3.0 ask 0.2.0 players to update; 0.3.0 still plays 0.1.0/0.2.0 games.

## 0.2.0 – test feedback round 1
- Rules can no longer change during a game: each game keeps its own rules and speed. While a game is open,
  Settings shows them read-only ("locked – belongs to this game"); new games take them from Settings.
- New rule (off by default): **one token per square** – landing on your own token sends that token back to the yard,
  also when a new token enters on its start square. A possible move must still be made. The computer avoids it.
- Main menu: every saved game shows how it was set up – players with computer levels, your colour, speed, rules in
  short (differences from the standard rules), round and wins. The same summary is in the game ("This game").
- **New round** with the same players, rules and speed without leaving the game – after it ends or during it
  (asks first). Online, any player can ask; everyone still playing has to agree, then the host's app starts it in
  the same chat (the chat stays, with "Round N" marks). Wins per colour are counted across rounds.
- Yellow is a clearer yellow in all themes (darker shades amber instead of olive), easier to tell from green.
- Game layout: players, die and moves on the left, the board in the middle, the online chat on the right.
- Slower, easier to follow play: every speed takes twice as long as before (0.1.0), a banner on the board says whose
  turn it is ("Your turn!", "Green's turn", "Roll again"), and the active player's yard glows. The speed is chosen per
  game (New game dialog) and cannot change while the game runs.
- Full screen: the button is off by default and only offered where the browser allows it. Inside Peergos it cannot
  work – Peergos does not give apps the full-screen permission (checked with Peergos 1.39); use the browser's F11.
- Quick game: pick 1, 2 or 3 computer opponents right on the card (the first sits opposite you); it uses your saved
  level, speed and rules.
- How to play is written from the rules of the open game (or, in the menu, from the rules for new games).
- Online protocol 2: games started by 0.2.0 ask 0.1.0 players to update; 0.2.0 still plays 0.1.0 games.

## 0.1.0 – first test version
- Classic Ludo for 2–4 players: you against the computer (Easy, Normal, Hard – any number of computer players),
  several people on one device, or online with Peergos friends.
- Online games run through a Peergos app chat: Peergos asks which friends to invite, they join from their News feed.
  Computer players can be added to online games too (the host's app plays them). In-game chat, hand over to the
  computer, play again.
- Animated board, 3D die, sound effects (generated, no audio files), confetti for the winner.
- 12 colour themes (10 dark, 2 light) plus "Follow Peergos"; glossy or flat tokens; four animation speeds.
- House rules per game: leave the yard with 6 or 1/6, bonus rolls, third six, safe squares, three tries, play on
  for all places.
- Settings are saved at once into the app's private Peergos folder and follow you to every device; local games are
  saved after every move and can be continued later.
- English and Czech.
- Notes window for collecting wanted changes and turning them into feedback.
