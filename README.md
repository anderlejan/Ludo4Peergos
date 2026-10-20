# Ludo4Peergos

The classic race game **Ludo** as a [Peergos](https://peergos.org) custom app – private, end-to-end encrypted,
and running entirely inside your own Peergos space.

- **Play against the computer** – one to three computer players (Easy, Normal, Hard). *Quick game* starts at once
  with 1, 2 or 3 opponents and your saved level, speed and rules.
- **Play on one device** – several people taking turns at the same screen.
- **Play online with your Peergos friends** – up to four players, and computer players can join online games too.
  Moves travel as messages in a Peergos app chat, so they are end-to-end encrypted like every Peergos chat.
- 12 colour themes (10 dark, 2 light) or "Follow Peergos", glossy or flat tokens, four game speeds, a banner and a
  glowing yard that show whose turn it is.
- House rules: leave the yard with a 6 or 1/6, bonus rolls for sixes, captures and reaching home, third six ends the
  turn, safe squares, three tries, one token per square, play on for all places. Each game keeps its own rules and
  speed; *How to play* shows the rules of the game you are in.
- **New round** with the same players, rules and speed, without leaving the game; wins are counted across rounds.
- The main menu shows how every game was set up (players, your colour, speed, rules in short, round).
- Settings are saved the moment you change them, in the app's private Peergos folder, so they follow you to every
  device. Games against the computer are saved after every move.
- English and Czech.

## Install

1. Download `Ludo4Peergos-v<version>.zip` from the [Releases](../../releases) page.
2. In Peergos, open **Drive** and upload the ZIP (any folder).
3. Click the ZIP to open it, open the menu (⋮) of **peergos-app.json** and choose **Install**.
4. Peergos shows the permissions the app asks for – confirm with **Install**:
   - *store and read files in a folder private to the app* – settings and saved games
   - *exchange messages with friends* – online games
5. Start **Ludo4Peergos** from the **Launcher** (the grid icon at the top of the left menu).

To update, install the ZIP of the newer version the same way and confirm "replace". Your settings and saved games
stay (Peergos keeps the app's data folder on updates).

## Playing with friends

1. Choose **Play with friends**, pick a colour for each seat (*You*, *Friend*, *Computer* or nobody) and press
   **Choose friends & start**.
2. Peergos opens its own dialog listing your friends – pick who to invite and press **Apply**.
3. Your friends find the invitation in their Peergos **News feed** ("… invited you to the App Ludo4Peergos") and press
   **Join**. The game opens in their Ludo4Peergos (they need the app installed – share the ZIP with them).
4. Everyone plays on their own device; moves appear for the others within a few seconds.

Good to know:
- Only Peergos friends can be invited.
- Computer players in an online game are played by the host's app – keep it open while they are on turn.
- A player who has to leave can **Hand over to the computer**; the host's app then plays their colour.
- **New round**: any player can ask for one (during or after a game). When everyone still playing agrees, the
  host's app starts it in the same chat – the chat history stays.
- Each player rolls on their own device – the game trusts its players, which is fine among friends.

Full screen: Peergos does not give apps the full-screen permission, so use your browser's own full screen (F11).

## Privacy and security

The app runs in Peergos' app sandbox: its own isolated origin, a strict content security policy, and no network
access except the Peergos API. It cannot read your files. It loads nothing from the internet – fonts, sounds and
graphics are all built in.

## Development

Plain HTML, CSS and JavaScript – no build step, no dependencies at run time.

```
peergos-app.json     the Peergos app manifest
assets/              the app (index.html, css/, js/, fonts/, icon.png, usernotes/)
docs/DESIGN.md       how it works: rules engine, online protocol, storage
tests/               unit tests, a mock of the Peergos API, browser and end-to-end tests
tools/make_release.py
```

Tests:

```
node tests/unit.test.js                  # rules, computer players, online protocol (1000 simulated games)
python3 tests/browser_test.py            # Chromium against tests/mock_peergos.py: local, settings, online games
python3 tests/peergos/e2e.py --zip …     # Chromium against a real local Peergos server (see the file's header)
```

For the end-to-end test, run a throw-away local Peergos server (the release jar from
[Peergos/web-ui releases](https://github.com/Peergos/web-ui/releases)), create test users with
`tests/peergos/Setup.java`, and upload the ZIP into each user's `apps` folder.

Releases: `python3 tools/make_release.py` checks the manifest, version and changelog, runs the unit tests, and writes
`Ludo4Peergos-v<version>.zip` (the installer), `Ludo4Peergos-Source-v<version>.zip` and `SHA256SUMS.txt`. It refuses to
overwrite a version that exists already.

## Licence

Ludo4Peergos is free software under the GNU General Public License v3.0 or later (see `LICENSE`).
Bundled fonts: Inter and Fredoka, SIL Open Font License 1.1 (`assets/fonts/*-OFL.txt`).
