/* Ludo4Peergos – screens and game controller. */
(function (root) {
  'use strict';
  const L = root.L4P;
  const { Rules: R, AI, Protocol: P, Storage: S, Net, Sound, Board, UI, I18n } = L;
  const { h, icon, toast, dialog, confirm } = UI;
  const t = I18n.t;
  const VERSION = L.VERSION;
  const url = new URL(root.location.href);
  const ME = S.username || '';
  const PEERGOS_THEME = url.searchParams.get('theme') || '';
  const PEERGOS_LANG = url.searchParams.get('lang') || '';
  const POLL_MS = Math.max(0, parseInt(url.searchParams.get('pollms') || '0', 10)) || 0; // test hook

  // ───────────────────────────── themes and settings ─────────────────────────────
  const THEMES = [
    { id: 'midnight', name: 'Midnight', dark: true, sw: ['#0f1530', '#f5c451', '#ef4f5f', '#2fbf71', '#ffd60a', '#4c8dff'] },
    { id: 'obsidian', name: 'Obsidian', dark: true, sw: ['#0b0c0f', '#38e1ff', '#ff4d6d', '#20d68f', '#ffe11a', '#4d7cff'] },
    { id: 'aurora', name: 'Aurora', dark: true, sw: ['#0d1f2a', '#6ff2c4', '#ff6b8b', '#3fd98a', '#ffe14d', '#6aa8ff'] },
    { id: 'ember', name: 'Ember', dark: true, sw: ['#1a1310', '#ff9a3c', '#e8473c', '#5fb84a', '#ffd21f', '#4f8fd6'] },
    { id: 'forest', name: 'Forest', dark: true, sw: ['#0f1a14', '#c6e86b', '#e5544b', '#3fbf74', '#ffd83d', '#4c9ad8'] },
    { id: 'ocean', name: 'Ocean', dark: true, sw: ['#071a2b', '#4fd1e8', '#ff6670', '#2fcf98', '#ffdc3b', '#3d8bff'] },
    { id: 'velvet', name: 'Velvet', dark: true, sw: ['#1a0f22', '#ff7ac6', '#ff5470', '#45cc84', '#ffdd3c', '#7b8cff'] },
    { id: 'nord', name: 'Nord', dark: true, sw: ['#2e3440', '#88c0d0', '#bf616a', '#8fbf7f', '#f5d36b', '#81a1c1'] },
    { id: 'graphite', name: 'Graphite', dark: true, sw: ['#18191b', '#8ab4ff', '#e05a5a', '#47b36f', '#ffd43b', '#5a8ee0'] },
    { id: 'neon', name: 'Neon', dark: true, sw: ['#0a0614', '#ff2bd6', '#ff3864', '#00e09a', '#ffe500', '#00c2ff'] },
    { id: 'classic', name: 'Classic', dark: false, sw: ['#f3ead8', '#b5282f', '#d62f3a', '#1a9a4c', '#ffcc00', '#1f6fd1'] },
    { id: 'sand', name: 'Sand', dark: false, sw: ['#efe6d6', '#8a5a2b', '#c8473f', '#3f9655', '#f5c400', '#3f78b5'] },
  ];
  const DEFAULTS = {
    theme: 'auto', lang: 'auto', sound: true, volume: 0.6, anim: 'normal', tokens: 'glossy',
    autoMove: true, autoRoll: false, hints: true, confirmLeave: true, showNotes: true,
    level: 'normal', rules: settingsRules(R.DEFAULT_RULES), quickOpponents: 3,
    lastLocal: null, lastOnline: null, settingsSection: 'look', savedAt: 0,
  };
  // Durations in ms. 0.2.0: twice as slow as 0.1.0 (step, think, dice, pause) plus a turn banner.
  const SPEED = {
    slow: { step: 520, think: 1900, dice: 1520, pause: 1800, banner: 1500 },
    normal: { step: 340, think: 1240, dice: 1120, pause: 1300, banner: 1100 },
    fast: { step: 180, think: 600, dice: 680, pause: 760, banner: 700 },
    instant: { step: 0, think: 60, dice: 0, pause: 120, banner: 0 },
  };
  const SPEEDS = ['slow', 'normal', 'fast', 'instant'];
  const speedId = v => (SPEEDS.indexOf(v) >= 0 ? v : 'normal');

  /** Rules kept in Settings (defaults for new games). 0.2.0 had "selfKick" (own tokens only); since 0.3.0 the
   *  option is "one token per square" for every token, so a saved selfKick becomes onePerSquare. */
  function settingsRules(r) {
    const had = !!(r && typeof r === 'object' && r.safeBlock === true); // only 0.5.0+ settings carry it
    const n = R.normalizeRules(r);
    if (n.selfKick) { n.selfKick = false; n.onePerSquare = true; }
    // before 0.5.0 one token per square switched the safe squares off (the switch was locked): keep that as it was
    if (!had && n.onePerSquare) n.safeSquares = false;
    n.protectOwn = true; // 0.4.0: own tokens are protected in every new game (see Rules.legalMoves)
    n.safeBlock = true;  // 0.5.0: safe squares work together with one token per square
    n.enterGrace = true; // 0.6.0: a second 6 right after bringing a token out moves on instead of kicking it
    return n;
  }
  let settings = Object.assign({}, DEFAULTS, S.lsGet('settings', {}));
  delete settings.showFullscreen;
  settings.rules = settingsRules(settings.rules);
  let saveState = 'saved';
  const saveListeners = new Set();
  const settingsDoc = S.Doc('settings.json', 250, s => { saveState = s; saveListeners.forEach(f => f(s)); });

  function applySettings() {
    let theme = settings.theme;
    if (theme === 'auto' || !THEMES.some(x => x.id === theme)) theme = PEERGOS_THEME === 'dark-mode' ? 'midnight' : (PEERGOS_THEME === '' && url.searchParams.has('theme') ? 'classic' : 'midnight');
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.tokens = settings.tokens;
    I18n.setLang(I18n.resolve(settings.lang, PEERGOS_LANG));
    Sound.configure(settings.sound, settings.volume);
    const nb = document.getElementById('btn-notes');
    if (nb) nb.hidden = !settings.showNotes;
    const sb = document.getElementById('btn-sound');
    if (sb) { sb.replaceChildren(icon(settings.sound ? 'sound' : 'mute')); sb.title = t('menu.sound'); }
  }

  /** Changes settings and saves at once (no Save button anywhere). */
  function set(patch, opts) {
    if (patch && patch.rules) patch = Object.assign({}, patch, { rules: settingsRules(patch.rules) });
    Object.assign(settings, patch);
    settings.savedAt = Date.now();
    S.lsSet('settings', settings);
    settingsDoc.set(settings);
    applySettings();
    if (game && game.onSettings) game.onSettings(patch);
    if (!(opts && opts.quiet)) refreshTexts();
  }

  async function loadRemoteSettings() {
    try {
      const remote = await S.getJSON('settings.json');
      if (remote && typeof remote === 'object') {
        if ((remote.savedAt || 0) > (settings.savedAt || 0)) {
          settings = Object.assign({}, DEFAULTS, remote);
          delete settings.showFullscreen;
          settings.rules = settingsRules(settings.rules);
          S.lsSet('settings', settings);
          applySettings();
          refreshTexts();
        } else if ((remote.savedAt || 0) < (settings.savedAt || 0)) {
          settingsDoc.set(settings); // this device has newer settings
        }
      } else if (remote === null && settings.savedAt) {
        settingsDoc.set(settings);
      }
    } catch (e) { console.warn('settings load', e); }
  }

  // ───────────────────────────── saved local games ─────────────────────────────
  // record: {id, created, updated, title, setup {seats, rules, first, speed}, actions, round, rounds: [{round, over, winner, finished, n}]}
  let localGames = S.lsGet('localGames', []);
  const gamesDoc = S.Doc('local-games.json', 400);
  function saveLocalGames() {
    localGames.sort((a, b) => b.updated - a.updated);
    localGames = localGames.slice(0, 30);
    S.lsSet('localGames', localGames);
    gamesDoc.set({ version: 1, games: localGames });
  }
  async function loadRemoteGames() {
    try {
      const remote = await S.getJSON('local-games.json');
      if (remote && Array.isArray(remote.games)) {
        const byId = new Map(localGames.map(g => [g.id, g]));
        let changed = false;
        for (const g of remote.games) {
          const mine = byId.get(g.id);
          if (!mine || (g.updated || 0) > (mine.updated || 0)) { byId.set(g.id, g); changed = true; }
        }
        localGames = Array.from(byId.values());
        if (changed) { S.lsSet('localGames', localGames); if (screen === 'home') renderHome(); }
        if (localGames.length !== remote.games.length) saveLocalGames();
      } else if (remote === null && localGames.length) saveLocalGames();
    } catch (e) { console.warn('games load', e); }
  }

  // What the home screen knows about online games (setup, round, wins) – per browser, refreshed when a game is opened.
  let onlineInfo = S.lsGet('onlineInfo', {});
  function rememberOnline(chatId, rep) {
    if (!rep || !rep.setup) return;
    const wins = [0, 0, 0, 0];
    for (const r of rep.rounds) if (r.over && r.winner != null) wins[r.winner]++;
    onlineInfo[chatId] = { seats: rep.setup.seats, rules: rep.setup.rules, speed: rep.setup.speed || null, round: rep.rounds.length ? rep.rounds[rep.rounds.length - 1].round : 1,
      over: rep.state.over, turn: rep.state.turn, wins, checked: Date.now(),
      left: (rep.left || []).indexOf(ME) >= 0, hostLeft: !!rep.hostLeft, leftUsers: rep.left || [] };
    S.lsSet('onlineInfo', onlineInfo);
  }

  // Online games this user created or opened (also from the News feed), kept in the app's data folder, so a game
  // stays in the list even when Peergos' chat list leaves it out. {chatId: {title, added, opened, removed?}}
  let knownOnline = S.lsGet('knownOnline', {});
  const knownDoc = S.Doc('online-games.json', 400);
  function saveKnown() { S.lsSet('knownOnline', knownOnline); knownDoc.set({ version: 1, games: knownOnline }); }
  function knowGame(chatId, title) {
    if (!chatId) return;
    const k = knownOnline[chatId] || { added: Date.now() };
    if (k.removed) return; // deleted on purpose: keep it out
    const changed = !knownOnline[chatId] || (title && k.title !== title);
    k.opened = Date.now();
    if (title) k.title = title;
    knownOnline[chatId] = k;
    if (changed || !k.saved || Date.now() - k.saved > 3600000) { k.saved = Date.now(); saveKnown(); } else S.lsSet('knownOnline', knownOnline);
  }
  function forgetGame(chatId) {
    knownOnline[chatId] = { removed: Date.now() };
    saveKnown();
  }
  async function loadRemoteKnown() {
    try {
      const remote = await S.getJSON('online-games.json');
      if (remote && remote.games && typeof remote.games === 'object') {
        let changed = false, push = false;
        for (const [id, g] of Object.entries(remote.games)) {
          const mine = knownOnline[id];
          if (!mine) { knownOnline[id] = g; changed = true; }
          else if (g.removed && !mine.removed) { knownOnline[id] = g; changed = true; }
          else if (!g.removed && !mine.removed && (g.opened || 0) > (mine.opened || 0)) { knownOnline[id] = Object.assign({}, mine, g); changed = true; }
        }
        for (const id of Object.keys(knownOnline)) if (!remote.games[id]) push = true;
        if (changed) { S.lsSet('knownOnline', knownOnline); if (screen === 'home') fillGamesList(); }
        if (push) saveKnown();
      } else if (remote === null && Object.keys(knownOnline).length) saveKnown();
    } catch (e) { console.warn('known games load', e); }
  }

  // ───────────────────────────── helpers ─────────────────────────────
  function rollDie() {
    const a = new Uint8Array(1);
    do { crypto.getRandomValues(a); } while (a[0] >= 252);
    return (a[0] % 6) + 1;
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const colorName = c => t('color.' + c);
  const chip = (c, cls) => h('span', { class: 'chip' + (cls ? ' ' + cls : ''), style: { background: 'var(--p' + c + ')' } });

  function seatName(seat, c) {
    if (!seat) return '';
    if (seat.kind === 'bot') return t('game.computerName') + ' · ' + t('level.' + (seat.level || 'normal'));
    if (seat.kind === 'local') return seat.name || colorName(c);
    if (seat.user && seat.user === ME) return t('common.you');
    if (seat.user === 'me') return t('common.you');
    return seat.user || seat.name || t('common.you');
  }
  const isMine = seat => !!seat && seat.kind === 'human' && (seat.user === ME || (!ME && seat.user === 'me') || seat.user === 'me');

  /** Short text of the rules that differ from the standard ones, and the full list for a tooltip. */
  function rulesShort(rules) {
    const r = R.normalizeRules(rules), d = R.DEFAULT_RULES, diff = [];
    // selfKick only shows in old (0.2.0) games; protectOwn is part of "one token per square" since 0.4.0, not an option
    const keys = Object.keys(d).filter(k => (k !== 'selfKick' || r.selfKick) && ['protectOwn', 'safeBlock', 'enterGrace'].indexOf(k) < 0);
    for (const k of keys) if (r[k] !== d[k] && !(k === 'safeSquares' && r.onePerSquare && !r.safeBlock)) diff.push(t('short.' + k));
    const full = keys.map(k => {
      if (k === 'enterOn') return t('rule.enterOn') + ': ' + t('rule.enterOn.' + r.enterOn);
      if (k === 'endMode') return t('rule.endMode') + ': ' + t('rule.endMode.' + r.endMode);
      return (r[k] ? '✓ ' : '✗ ') + t('rule.' + k);
    }).join('\n');
    return { text: diff.length ? diff.join(' · ') : t('short.standard'), full };
  }

  /** How a game is set up: who plays which colour (with computer levels), your colour, speed, rules, round. */
  function summaryEl(info, opts) {
    opts = opts || {};
    const seats = info.seats || [];
    const mine = seats.findIndex(isMine);
    const wins = info.wins || [0, 0, 0, 0];
    const anyWins = wins.some(w => w > 0);
    const rs = rulesShort(info.rules);
    return h('div', { class: 'sum' + (opts.compact ? ' compact' : '') },
      h('div', { class: 'sum-players' }, seats.map((s, c) => s ? h('span', { class: 'sum-p' + (isMine(s) ? ' me' : ''), title: colorName(c) }, chip(c, 'sm'), seatName(s, c), anyWins ? h('b', { class: 'sum-w', title: t('sum.wins') }, '🏆' + wins[c]) : null) : null)),
      h('div', { class: 'sum-meta' },
        mine >= 0 ? h('span', null, t('sum.youPlay', { color: colorName(mine) })) : null,
        h('span', null, t('sum.speed', { speed: t('set.anim.' + speedId(info.speed)) })),
        h('span', { title: rs.full }, t('sum.rules', { rules: rs.text })),
        info.round > 1 ? h('span', null, t('sum.round', { n: info.round })) : null));
  }

  // ───────────────────────────── app shell ─────────────────────────────
  const bannerLog = []; // the turn banners shown (texts, whose turn) – read by the tests
  let screen = 'home';
  let notesUI = null;
  let game = null; // current session

  function header() {
    const logo = h('div', { class: 'brand', onclick: () => leaveToHome() },
      h('span', { class: 'brand-mark', html: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="8" fill="var(--bg3)"/><rect x="4" y="4" width="10" height="10" rx="3" fill="var(--p0)"/><rect x="18" y="4" width="10" height="10" rx="3" fill="var(--p1)"/><rect x="18" y="18" width="10" height="10" rx="3" fill="var(--p2)"/><rect x="4" y="18" width="10" height="10" rx="3" fill="var(--p3)"/><circle cx="16" cy="16" r="3.4" fill="var(--acc)"/></svg>' }),
      h('span', { class: 'brand-name' }, 'Ludo', h('b', null, '4'), 'Peergos'));
    const right = h('div', { class: 'top-actions' },
      h('button', { class: 'framed-btn', id: 'btn-notes', onclick: openNotes, title: t('menu.notes') + ' (Ctrl+Shift+N)' }, icon('note'), h('span', { 'data-t': 'menu.notes' }, t('menu.notes'))),
      h('button', { class: 'framed-btn', id: 'btn-settings', onclick: () => openSettings() }, icon('gear'), h('span', { 'data-t': 'menu.settings' }, t('menu.settings'))),
      h('button', { class: 'icon-btn', id: 'btn-sound', onclick: () => { set({ sound: !settings.sound }, { quiet: true }); if (settings.sound) Sound.play('click'); } }, icon(settings.sound ? 'sound' : 'mute')),
      h('button', { class: 'icon-btn', id: 'btn-help', title: t('menu.help'), onclick: openHelp }, icon('help')));
    return h('header', { class: 'topbar' }, logo, h('div', { class: 'top-title', id: 'top-title' }), right);
  }

  function refreshTexts() {
    document.querySelectorAll('[data-t]').forEach(e => { e.textContent = t(e.dataset.t); });
    const b = document.getElementById('btn-settings'); if (b) b.title = t('menu.settings');
    const n = document.getElementById('btn-notes'); if (n) n.title = t('menu.notes') + ' (Ctrl+Shift+N)';
    if (screen === 'home') renderHome();
    else if (game) game.refresh();
  }

  const main = () => document.getElementById('main');

  // ───────────────────────────── home ─────────────────────────────
  let onlineList = null, onlineState = 'idle';

  function renderHome() {
    screen = 'home';
    document.getElementById('top-title').textContent = '';
    const m = main();
    m.className = 'screen home';
    const hero = h('section', { class: 'hero' },
      h('div', { class: 'hero-tokens', 'aria-hidden': 'true' }, [0, 1, 2, 3].map(c => h('span', { class: 'hero-tok', style: { '--c': 'var(--p' + c + ')', '--d': (c * 0.15) + 's' } }))),
      h('h1', { class: 'hero-title' }, h('span', { style: { color: 'var(--p0)' } }, 'L'), h('span', { style: { color: 'var(--p1)' } }, 'u'), h('span', { style: { color: 'var(--p2)' } }, 'd'), h('span', { style: { color: 'var(--p3)' } }, 'o'), h('span', { class: 'hero-4' }, '4'), 'Peergos'),
      h('p', { class: 'hero-sub' }, t('app.tagline')));
    const card = (ic, title, sub, fn, cls, id, extra) => h('div', { class: 'action-card ' + (cls || ''), id, role: 'button', tabindex: '0', onclick: fn, onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) fn(); } },
      h('span', { class: 'ac-icon' }, icon(ic)), h('span', { class: 'ac-text' }, h('b', null, title), h('small', null, sub), extra || null));
    const q = settings.quickOpponents;
    const quickPick = h('span', { class: 'quick-pick', role: 'group', 'aria-label': t('home.opponents') },
      h('span', { class: 'qp-label' }, t('home.opponents')),
      [1, 2, 3].map(n => h('button', { class: 'qp-btn' + (q === n ? ' on' : ''), id: 'quick-' + n, title: t('home.quickN', { n }),
        onclick: e => { e.stopPropagation(); set({ quickOpponents: n }, { quiet: true }); quickGame(n); } }, String(n))));
    const actions = h('section', { class: 'actions' },
      card('play', t('home.quick'), t('home.quickSub2', { level: t('level.' + settings.level), speed: t('set.anim.' + speedId(settings.anim)) }), () => quickGame(settings.quickOpponents), 'primary', 'act-quick', quickPick),
      card('dice', t('home.new'), t('home.newSub'), () => openNewGame('local'), '', 'act-new'),
      card('users', t('home.friends'), t('home.friendsSub'), () => openNewGame('online'), Net.available ? '' : 'disabled', 'act-friends'));
    const list = h('div', { class: 'games-list', id: 'games-list' });
    const games = h('section', { class: 'games' }, h('div', { class: 'section-head' }, h('h2', null, t('home.continue')), h('button', { class: 'link-btn', onclick: openHelp }, icon('help'), t('home.howto'))), list,
      h('p', { class: 'hint' }, Net.available ? t('home.invitesHint') : t('home.onlineUnavailable')));
    m.replaceChildren(h('div', { class: 'home-inner' }, hero, actions, games));
    fillGamesList();
    if (Net.available && onlineState !== 'loading') loadOnlineList();
    if (Net.available && !homeTimer) homeTimer = setInterval(() => { if (screen === 'home' && !document.hidden && !UI.topDialog()) loadOnlineList(); }, 30000);
  }
  let homeTimer = null;

  function localInfo(g) {
    const wins = [0, 0, 0, 0];
    for (const r of g.rounds || []) if (r.over && r.winner != null) wins[r.winner]++;
    return { seats: g.setup.seats, rules: g.setup.rules, speed: g.setup.speed, round: g.round || 1, wins };
  }

  function fillGamesList() {
    const list = document.getElementById('games-list');
    if (!list) return;
    const items = [];
    for (const g of localGames) {
      let st = null;
      try { st = R.replay(g.setup, g.actions); } catch (e) { continue; }
      const mineTurn = !st.over && st.seats[st.turn] && st.seats[st.turn].kind !== 'bot';
      const status = st.over ? t('home.finished') : (mineTurn ? t('home.yourTurn') : t('home.inProgress'));
      items.push({
        when: g.updated, el: h('div', { class: 'game-card', tabindex: '0', onclick: () => openLocal(g.id), onkeydown: e => { if (e.key === 'Enter') openLocal(g.id); } },
          h('span', { class: 'gc-kind', title: t('home.local') }, icon('device')),
          h('span', { class: 'gc-main' }, h('span', { class: 'gc-title' }, h('b', null, g.title || t('home.new')), h('small', null, status + ' · ' + UI.timeAgo(new Date(g.updated)))), summaryEl(localInfo(g))),
          h('button', { class: 'icon-btn small', title: t('home.delete'), onclick: async e => { e.stopPropagation(); if (await confirm(t('home.deleteLocal'), t('home.delete'), { danger: true })) { localGames = localGames.filter(x => x.id !== g.id); saveLocalGames(); fillGamesList(); } } }, icon('trash'))),
      });
    }
    if (Net.available) {
      const merged = (onlineList || []).filter(c => !(knownOnline[c.chatId] && knownOnline[c.chatId].removed));
      const listed = new Set(merged.map(c => c.chatId));
      for (const [id, k] of Object.entries(knownOnline)) {
        if (k.removed || listed.has(id)) continue;
        merged.push({ chatId: id, title: k.title, members: [], latest: null, known: k });
      }
      for (const c of merged) {
        const info = onlineInfo[c.chatId];
        const k = knownOnline[c.chatId];
        const when = Math.max(c.latest && c.latest.creationTime ? parseLocal(c.latest.creationTime) : 0, k && k.opened || 0, k && k.added || 0);
        let others = (c.members || []).filter(u => u !== ME);
        if (!others.length && info && info.seats) others = info.seats.filter(s => s && s.kind === 'human' && s.user && s.user !== ME).map(s => s.user);
        const state = info ? (info.left ? t('home.youLeft') : info.hostLeft ? t('home.hostLeft') : info.over ? t('home.finished') : t('home.inProgress')) : '';
        items.push({
          when, el: h('div', { class: 'game-card online' + (info && (info.left || info.hostLeft) ? ' left' : ''), 'data-chat': c.chatId, tabindex: '0', onclick: () => openOnline(c.chatId, { title: c.title }), onkeydown: e => { if (e.key === 'Enter') openOnline(c.chatId, { title: c.title }); } },
            h('span', { class: 'gc-kind', title: t('home.online') }, icon('users')),
            h('span', { class: 'gc-main' }, h('span', { class: 'gc-title' }, h('b', null, c.title || 'Ludo'), h('small', null, (state ? state + ' · ' : '') + (others.join(', ') || '—') + (when ? ' · ' + UI.timeAgo(new Date(when)) : ''))),
              info ? summaryEl(info) : h('div', { class: 'sum muted small' }, t('sum.loading'))),
            h('button', { class: 'icon-btn small', title: t('home.delete'), onclick: async e => { e.stopPropagation(); if (await confirm(t('home.deleteOnline'), t('home.delete'), { danger: true })) { await Net.remove(c.chatId).catch(() => false); forgetGame(c.chatId); if (onlineList) onlineList = onlineList.filter(x => x.chatId !== c.chatId); delete onlineInfo[c.chatId]; S.lsSet('onlineInfo', onlineInfo); fillGamesList(); } } }, icon('trash'))),
        });
      }
    }
    items.sort((a, b) => b.when - a.when);
    const kids = items.map(i => i.el);
    if (onlineState === 'loading' && !onlineList) kids.push(h('div', { class: 'muted small pad' }, t('home.loadingOnline')));
    if (onlineState === 'error') kids.push(h('div', { class: 'muted small pad warn-text' }, t('home.listError')));
    if (!kids.length) kids.push(h('div', { class: 'empty' }, t('home.noGames')));
    list.replaceChildren(...kids);
  }

  function parseLocal(s) { // "2026-10-20 14:03:05" (local time, from Peergos)
    const m = /^(\d+)-(\d+)-(\d+) (\d+):(\d+):(\d+)/.exec(String(s));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : 0;
  }

  const summaryFailed = {};
  async function loadOnlineList() {
    if (onlineState === 'loading') return;
    onlineState = 'loading';
    fillGamesList();
    try {
      onlineList = await Net.listGames(); onlineState = 'ok';
      for (const c of onlineList) { const k = knownOnline[c.chatId]; if (!k) knowGame(c.chatId, c.title); else if (!k.removed && c.title && !k.title) knowGame(c.chatId, c.title); }
    } catch (e) { console.warn('online list', e); onlineState = 'error'; }
    if (screen === 'home') fillGamesList();
    // fill in the summaries of games this browser has not looked at yet (or not for 10 minutes)
    {
      const ids = new Set((onlineList || []).map(c => c.chatId));
      for (const [id, k] of Object.entries(knownOnline)) if (!k.removed) ids.add(id);
      const todo = Array.from(ids).filter(id => !(knownOnline[id] && knownOnline[id].removed)).map(id => ({ chatId: id })).filter(c => (!onlineInfo[c.chatId] || Date.now() - (onlineInfo[c.chatId].checked || 0) > 600000) && !(Date.now() - (summaryFailed[c.chatId] || 0) < 600000)).slice(0, 6);
      for (const c of todo) {
        if (screen !== 'home') break;
        try { const res = await Net.read(c.chatId, 0); rememberOnline(c.chatId, P.replay(res.entries.filter(e => e.type === 'Application'), P.chatOwner(c.chatId))); }
        catch (e) { console.warn('summary', e); summaryFailed[c.chatId] = Date.now(); }
        if (screen === 'home') fillGamesList();
      }
    }
  }

  // ───────────────────────────── new game dialog ─────────────────────────────
  function defaultSeats(mode) {
    if (mode === 'online') return [{ kind: 'me' }, { kind: 'empty' }, { kind: 'friend' }, { kind: 'empty' }];
    return [{ kind: 'me' }, { kind: 'bot', level: settings.level }, { kind: 'bot', level: settings.level }, { kind: 'bot', level: settings.level }];
  }

  /** Quick game: you against n computer players with the saved settings (level, speed, rules).
   *  The first opponent sits opposite you, then the others fill the remaining colours. */
  function quickGame(n) {
    n = [1, 2, 3].indexOf(n) >= 0 ? n : 3;
    const last = settings.lastLocal && Array.isArray(settings.lastLocal.seats) ? settings.lastLocal.seats.findIndex(s => s && s.kind === 'me') : -1;
    const meC = last >= 0 ? last : 0;
    const order = [(meC + 2) % 4, (meC + 1) % 4, (meC + 3) % 4];
    const seats = [null, null, null, null];
    seats[meC] = { kind: 'human', user: ME || 'me' };
    for (let k = 0; k < n; k++) seats[order[k]] = { kind: 'bot', level: settings.level };
    startLocal({ seats, rules: settingsRules(settings.rules), first: meC, speed: speedId(settings.anim) }, t('home.quickN', { n }));
  }

  function openNewGame(mode) {
    if (mode === 'online' && !Net.available) { toast(t('home.onlineUnavailable'), 'warn'); return; }
    const last = mode === 'online' ? settings.lastOnline : settings.lastLocal;
    const seats = (last && Array.isArray(last.seats) && last.seats.length === 4 ? last.seats : defaultSeats(mode)).map(s => Object.assign({}, s));
    // 0.5.0: rules and speed always start from Settings and changes here are saved there (before, the dialog reused the
    // rules of the previous new game, so a rule switched on in Settings did not reach games started here)
    const rules = settingsRules(settings.rules);
    let first = last && last.first != null ? last.first : 'random';
    let speed = speedId(settings.anim);
    const kinds = mode === 'online' ? ['me', 'friend', 'bot', 'empty'] : ['me', 'bot', 'local', 'empty'];
    const kindLabel = k => t(k === 'me' ? 'new.seat.me' : k === 'bot' ? 'new.seat.bot' : k === 'local' ? 'new.seat.local' : k === 'friend' ? 'new.seat.friend' : 'new.seat.empty');
    const err = h('div', { class: 'form-error', role: 'alert' });
    const rows = h('div', { class: 'seats' });

    function remember() {
      const key = mode === 'online' ? 'lastOnline' : 'lastLocal';
      set({ [key]: { seats, rules, first, speed }, rules: settingsRules(rules), anim: speed }, { quiet: true });
    }
    function validate() {
      const n = seats.filter(s => s.kind !== 'empty').length;
      const me = seats.filter(s => s.kind === 'me').length;
      const fr = seats.filter(s => s.kind === 'friend').length;
      let msg = '';
      if (n < 2) msg = t('new.needTwo');
      else if (me !== 1 && (mode === 'online' || seats.every(s => s.kind !== 'local'))) msg = t('new.needMe');
      else if (mode === 'online' && fr < 1) msg = t('new.needFriend');
      err.textContent = msg;
      startBtn.disabled = !!msg;
      return !msg;
    }
    function drawRows() {
      rows.replaceChildren(...seats.map((s, c) => {
        const seg = h('div', { class: 'seg seat-kinds', role: 'radiogroup' }, kinds.map(k => h('button', {
          class: 'seg-btn' + (s.kind === k ? ' on' : ''), role: 'radio', 'aria-checked': s.kind === k ? 'true' : 'false',
          onclick: () => {
            if (k === 'me') seats.forEach(o => { if (o.kind === 'me') o.kind = mode === 'online' ? 'friend' : 'bot'; });
            s.kind = k; if (k === 'bot' && !s.level) s.level = settings.level;
            drawRows(); remember();
          },
        }, k === 'me' ? icon('user') : k === 'bot' ? icon('cpu') : k === 'friend' ? icon('users') : k === 'local' ? icon('device') : null, h('span', null, kindLabel(k)))));
        const extra = h('div', { class: 'seat-extra' });
        if (s.kind === 'bot') extra.appendChild(h('div', { class: 'seg small' }, ['easy', 'normal', 'hard'].map(l => h('button', { class: 'seg-btn' + ((s.level || 'normal') === l ? ' on' : ''), onclick: () => { s.level = l; drawRows(); remember(); } }, t('level.' + l)))));
        if (s.kind === 'local') extra.appendChild(h('input', { class: 'text-in', type: 'text', maxlength: '24', value: s.name || '', placeholder: t('new.namePlaceholder') + ' (' + colorName(c) + ')', oninput: e => { s.name = e.target.value; remember(); } }));
        return h('div', { class: 'seat-row' + (s.kind === 'empty' ? ' empty' : '') },
          h('span', { class: 'seat-color' }, chip(c), colorName(c)), seg, extra);
      }));
      validate();
    }
    const segOf = (vals, cur, label, onPick) => {
      const box = h('div', { class: 'seg small' });
      box.append(...vals.map(v => h('button', { class: 'seg-btn' + (cur() === v ? ' on' : ''), onclick: e => { onPick(v); [...box.children].forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); remember(); } }, label(v))));
      return box;
    };
    const firstSel = segOf(['random', 0, 1, 2, 3], () => first, v => v === 'random' ? t('new.first.random') : h('span', { class: 'chip sm', style: { background: 'var(--p' + v + ')' }, title: colorName(v) }), v => { first = v; });
    const speedSel = segOf(SPEEDS, () => speed, v => t('set.anim.' + v), v => { speed = v; });

    const rulesBox = rulesEditor(rules, () => remember());
    const startBtn = h('button', { class: 'btn primary big', onclick: go }, icon(mode === 'online' ? 'users' : 'play'), mode === 'online' ? t('new.invite') : t('new.start'));
    const d = dialog({
      title: mode === 'online' ? t('new.friendsTitle') : t('new.title'), icon: mode === 'online' ? 'users' : 'dice', cls: 'dlg-new',
      body: [h('h3', null, t('new.players')), rows,
        h('div', { class: 'first-row' }, h('span', null, t('new.first')), firstSel, h('span', { class: 'gap' }), h('span', null, t('new.speed')), speedSel),
        mode === 'online' ? h('p', { class: 'hint' }, t('new.friendsHint')) : null,
        h('details', { class: 'rules-details' }, h('summary', null, t('new.rules'), h('small', { class: 'muted' }, ' – ' + rulesShort(rules).text)), rulesBox), err],
      footer: [h('button', { class: 'btn', onclick: () => d.close() }, t('common.cancel')), startBtn],
    });
    drawRows();

    async function go() {
      if (!validate()) return;
      remember();
      const f = first === 'random' ? null : first;
      if (mode === 'local') {
        const seatsOut = seats.map((s, c) => s.kind === 'empty' ? null : s.kind === 'me' ? { kind: 'human', user: ME || 'me' } : s.kind === 'bot' ? { kind: 'bot', level: s.level || 'normal' } : { kind: 'local', name: (s.name || '').trim() || colorName(c) });
        d.close();
        startLocal({ seats: seatsOut, rules: R.normalizeRules(rules), first: f == null ? randomFirst(seatsOut) : f, speed }, null);
      } else {
        startBtn.disabled = true;
        startBtn.lastChild.textContent = t('new.creating');
        try { await createOnline(seats, R.normalizeRules(rules), f, speed); d.close(); }
        catch (e) { console.error(e); toast(String(e.message || e), 'bad'); }
        finally { startBtn.disabled = false; startBtn.lastChild.textContent = t('new.invite'); }
      }
    }
  }

  function randomFirst(seats) {
    const a = seats.map((s, i) => s ? i : -1).filter(i => i >= 0);
    return a[rollDie() % a.length];
  }

  function rulesEditor(rules, onChange, readOnly) {
    let box = null;
    const row = (key, control, note) => h('div', { class: 'rule-row', 'data-rule': key }, h('span', null, t('rule.' + key), note ? h('small', { class: 'rule-note' }, note) : null), control);
    const toggle = (key, locked) => h('label', { class: 'switch' + (readOnly || locked ? ' ro' : '') }, h('input', { type: 'checkbox', id: 'rule-' + key, disabled: readOnly || locked ? true : null, checked: rules[key] ? true : null,
      onchange: e => { rules[key] = e.target.checked; onChange(); if (key === 'onePerSquare') draw(); } }), h('span', { class: 'slider' }));
    const choice = (key, vals) => {
      const seg = h('div', { class: 'seg small' + (readOnly ? ' ro' : '') }, vals.map(v => h('button', { class: 'seg-btn' + (rules[key] === v ? ' on' : ''), disabled: readOnly ? true : null, onclick: e => { rules[key] = v; [...seg.children].forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); onChange(); } }, t('rule.' + key + '.' + v))));
      return seg;
    };
    function draw() {
      const one = !!rules.onePerSquare;
      box.replaceChildren(
        row('enterOn', choice('enterOn', ['six', 'oneOrSix'])),
        row('mustEnter', toggle('mustEnter')),
        row('threeTries', toggle('threeTries')),
        row('sixBonus', toggle('sixBonus')), row('threeSixes', toggle('threeSixes')),
        row('captureBonus', toggle('captureBonus')), row('finishBonus', toggle('finishBonus')),
        row('onePerSquare', toggle('onePerSquare'), readOnly && one && !rules.protectOwn ? t('rule.onePerOld') : null),
        // since 0.5.0 safe squares also work with one token per square; games started before keep them off
        row('safeSquares', toggle('safeSquares', one && !rules.safeBlock), one ? t(rules.safeBlock ? 'rule.safeWithOne' : 'rule.safeOff') : null),
        ...(rules.selfKick ? [row('selfKick', toggle('selfKick', true))] : []),
        row('endMode', choice('endMode', ['first', 'all'])));
    }
    box = h('div', { class: 'rules' + (readOnly ? ' read-only' : '') });
    draw();
    return box;
  }

  async function createOnline(seats, rules, first, speed) {
    const friendSeats = seats.map((s, c) => s.kind === 'friend' ? c : -1).filter(c => c >= 0);
    const title = 'Ludo · ' + (ME || 'game');
    const chatId = await Net.createGame(title, friendSeats.length);
    if (!chatId) { toast(t('new.cancelled'), 'warn'); throw new Error(t('new.cancelled')); }
    let members = [];
    for (let k = 0; k < 4 && !members.length; k++) {
      try { const list = await Net.listGames(); const c = list.find(x => x.chatId === chatId); if (c) members = (c.members || []).filter(u => u !== ME); } catch (e) { /* retry */ }
      if (!members.length) await sleep(800);
    }
    const out = seats.map(s => s.kind === 'empty' ? null : s.kind === 'me' ? { kind: 'human', user: ME } : s.kind === 'bot' ? { kind: 'bot', level: s.level || 'normal' } : { kind: 'friend' });
    let fi = 0;
    for (let c = 0; c < 4; c++) {
      if (!out[c] || out[c].kind !== 'friend') continue;
      if (fi < members.length) out[c] = { kind: 'human', user: members[fi++] };
      else out[c] = null;
    }
    if (out.filter(Boolean).length < 2) throw new Error(t('new.needTwo'));
    if (members.length < friendSeats.length) toast(t('new.fewerFriends'), 'warn', 5000);
    const setup = P.msg('setup', { g: P.randomId(8), seats: out, rules, first: first == null ? randomFirst(out) : first, speed: speedId(speed), round: 1 }, VERSION);
    await Net.send(chatId, P.encode(setup));
    onlineList = null;
    await openOnline(chatId, { title, initial: [{ author: ME, text: P.encode(setup), type: 'Application' }] });
  }

  // ───────────────────────────── settings ─────────────────────────────
  function openSettings(section) {
    let sec = section || settings.settingsSection || 'look';
    const status = h('span', { class: 'save-state' });
    const showSave = s => {
      status.className = 'save-state ' + s;
      status.replaceChildren(...(s === 'saved' ? [icon('check')] : []), t(s === 'saved' ? 'set.saved' : s === 'saving' ? 'set.saving' : 'set.saveError'));
    };
    showSave(saveState);
    saveListeners.add(showSave);
    const tabs = h('nav', { class: 'set-tabs' });
    const pane = h('div', { class: 'set-pane' });
    const SECS = [['look', 'gear'], ['play', 'play'], ['sound', 'sound'], ['rules', 'flag'], ['about', 'help']];
    function draw() {
      tabs.replaceChildren(...SECS.map(([id, ic]) => h('button', { class: 'set-tab' + (sec === id ? ' on' : ''), 'data-sec': id, onclick: () => { sec = id; set({ settingsSection: id }, { quiet: true }); draw(); } }, icon(ic), h('span', null, t('set.sec.' + id)))));
      pane.replaceChildren(...sectionBody(sec, draw));
    }
    const d = dialog({ title: t('set.title'), icon: 'gear', cls: 'dlg-settings', controls: status, body: h('div', { class: 'set-layout' }, tabs, pane), onClose: () => saveListeners.delete(showSave) });
    draw();
    return d;
  }

  function sectionBody(sec, redraw) {
    const inGame = screen === 'game' && !!game;
    const field = (label, control, sub) => h('div', { class: 'field' }, h('div', { class: 'field-label' }, label, sub ? h('small', null, sub) : null), control);
    const toggle = (key, label, disabled, sub) => h('label', { class: 'toggle-row' + (disabled ? ' disabled' : '') }, h('span', null, label, sub ? h('small', null, sub) : null), h('span', { class: 'switch' }, h('input', { type: 'checkbox', disabled: disabled ? true : null, checked: settings[key] ? true : null, onchange: e => set({ [key]: e.target.checked }) }), h('span', { class: 'slider' })));
    const seg = (key, vals, label, disabled) => h('div', { class: 'seg' + (disabled ? ' ro' : '') }, vals.map(v => h('button', { class: 'seg-btn' + (settings[key] === v ? ' on' : ''), disabled: disabled ? true : null, onclick: () => { set({ [key]: v }); redraw(); } }, label(v))));
    const lockNote = () => h('p', { class: 'lock-note' }, icon('flag'), t('set.lockedInGame'));
    if (sec === 'look') {
      const cur = settings.theme;
      const themes = h('div', { class: 'theme-grid' },
        [{ id: 'auto', name: t('set.theme.auto'), sw: null }].concat(THEMES).map(th => h('button', {
          class: 'theme-card' + (cur === th.id ? ' on' : ''), 'data-theme-id': th.id, onclick: () => { set({ theme: th.id }); redraw(); },
          title: th.name,
        }, th.sw ? h('span', { class: 'theme-sw', style: { background: th.sw[0] } }, h('span', { class: 'sw-acc', style: { background: th.sw[1] } }), h('span', { class: 'sw-dots' }, th.sw.slice(2).map(c => h('i', { style: { background: c } })))) :
          h('span', { class: 'theme-sw auto' }, h('span', { class: 'half dark' }), h('span', { class: 'half light' })),
          h('span', { class: 'theme-name' }, th.name, cur === th.id ? icon('check') : null))));
      return [field(t('set.theme'), themes),
        field(t('set.tokens'), seg('tokens', ['glossy', 'flat'], v => t('set.tokens.' + v))),
        h('div', { class: 'field', id: 'field-speed' }, h('div', { class: 'field-label' }, t('set.anim')), seg('anim', SPEEDS, v => t('set.anim.' + v), inGame), inGame ? lockNote() : null),
        field(t('set.lang'), seg('lang', ['auto'].concat(Object.keys(I18n.LANGS)), v => v === 'auto' ? t('set.lang.auto') : I18n.LANGS[v].name)),
        toggle('showNotes', t('set.showNotes'))];
    }
    if (sec === 'play') {
      return [toggle('autoMove', t('set.autoMove')), toggle('autoRoll', t('set.autoRoll')), toggle('hints', t('set.hints')), toggle('confirmLeave', t('set.confirmLeave')),
        field(t('set.level'), seg('level', ['easy', 'normal', 'hard'], v => t('level.' + v)))];
    }
    if (sec === 'sound') {
      const vol = h('input', { type: 'range', min: '0', max: '100', step: '5', value: String(Math.round(settings.volume * 100)), class: 'range', oninput: e => set({ volume: e.target.value / 100 }, { quiet: true }), onchange: () => Sound.play('capture') });
      return [toggle('sound', t('set.sound')), field(t('set.volume'), h('div', { class: 'vol-row' }, vol, h('button', { class: 'btn small', onclick: () => Sound.play('win') }, icon('play'), t('set.test')), h('button', { class: 'btn small', id: 'btn-test-chat', onclick: () => Sound.play('chat') }, icon('chat'), t('set.testChat'))))];
    }
    if (sec === 'rules') {
      if (inGame && game.currentRules) {
        return [h('h4', { class: 'sub-head' }, t('set.gameRules')), rulesEditor(Object.assign({}, game.currentRules()), () => {}, true), lockNote()];
      }
      const rules = Object.assign({}, settings.rules);
      return [h('p', { class: 'hint' }, t('set.rulesHint')), rulesEditor(rules, () => set({ rules: settingsRules(rules) }, { quiet: true }))];
    }
    return [h('div', { class: 'about' },
      h('div', { class: 'about-logo' }, h('span', { class: 'brand-name big' }, 'Ludo', h('b', null, '4'), 'Peergos'), h('div', { class: 'muted' }, t('set.version', { v: VERSION }))),
      h('p', null, S.PEERGOS ? t('set.dataInfo') : t('set.dataLocal')),
      h('p', { class: 'muted small' }, 'Fonts: Inter, Fredoka (SIL Open Font License).'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!(await confirm(t('set.resetConfirm'), t('set.reset'), { danger: true }))) return;
        const keep = { lastLocal: settings.lastLocal, lastOnline: settings.lastOnline };
        settings = Object.assign({}, DEFAULTS, keep, { rules: settingsRules(R.DEFAULT_RULES) });
        set({});
        if (root.UserNotesUI && root.UserNotesUI.clearPrefs) root.UserNotesUI.clearPrefs();
        redraw();
      } }, t('set.reset')))];
  }

  /** "How to play" written from a concrete set of rules, so everyone reads the rules that really apply. */
  function rulesHelpHtml(rules) {
    const r = R.normalizeRules(rules);
    const enter = t('help.enter.' + r.enterOn);
    const li = [];
    li.push(t(r.sixBonus ? 'help.sixBonus.on' : 'help.sixBonus.off'));
    if (r.sixBonus) li.push(t(r.threeSixes ? 'help.threeSixes.on' : 'help.threeSixes.off'));
    li.push(t('help.capture') + t(r.captureBonus ? 'help.capture.bonus' : 'help.capture.noBonus'));
    if (r.onePerSquare && r.protectOwn) {
      li.push(t(r.safeBlock ? 'help.onePer.protect2' : 'help.onePer.protect') + (r.mustEnter ? ' ' + t('help.onePer.protectExcept') : ''));
      if (r.safeBlock) li.push(t(r.safeSquares ? 'help.safe.onePer' : 'help.safe.off'));
    }
    else if (r.onePerSquare) li.push(t('help.onePer.on'));
    else {
      li.push(t(r.safeSquares ? 'help.safe.on' : 'help.safe.off'));
      li.push(t(r.selfKick ? 'help.selfKick.on' : 'help.onePer.off'));
    }
    li.push(t(r.finishBonus ? 'help.finishBonus.on' : 'help.finishBonus.off') + ' ' + t('help.exact'));
    li.push(t(r.threeTries ? 'help.threeTries.on' : 'help.threeTries.off', { enter }));
    if (r.mustEnter) li.push(t('help.mustEnter.on') + (r.onePerSquare && r.enterGrace ? ' ' + t('help.mustEnter.grace') : ''));
    li.push(t(r.endMode === 'all' ? 'help.end.all' : 'help.end.first'));
    return '<p>' + t('help.intro', { enter }) + '</p><ul class="help-rules">' + li.map(x => '<li>' + x + '</li>').join('') + '</ul>';
  }

  function openHelp() {
    const inGame = screen === 'game' && game && game.currentRules && game.currentRules();
    const rules = inGame ? game.currentRules() : settings.rules;
    const head = h('div', { class: 'help-head' + (inGame ? ' game' : '') }, icon(inGame ? 'flag' : 'gear'),
      h('b', null, t(inGame ? 'help.forGame' : 'help.forNew')),
      inGame ? h('span', { class: 'muted' }, ' · ' + t('help.speedRound', { speed: t('set.anim.' + game.speedId), round: game.roundNo() })) : null);
    dialog({ title: t('help.title'), icon: 'help', cls: 'dlg-help', body: [head, h('div', { class: 'help', id: 'help-rules', html: rulesHelpHtml(rules) }), h('div', { class: 'help help-common', html: t('help.common') })] });
  }

  // ───────────────────────────── User notes ─────────────────────────────
  async function openNotes() {
    if (!root.UserNotesUI) { toast(t('notes.unavailable'), 'bad', 6000); return; }
    if (notesUI && notesUI.isOpen()) return;
    if (notesOpening) return;
    notesOpening = true;
    const slow = setTimeout(() => toast(t('notes.opening'), 'info', 2500), 400);
    try { await openNotesNow(); }
    catch (e) { console.error('notes', e); toast(t('notes.failed') + ' ' + (e && e.message ? e.message : e), 'bad', 8000); }
    finally { clearTimeout(slow); notesOpening = false; }
  }
  let notesOpening = false;
  async function openNotesNow() {
    if (!notesUI) {
      const notesDoc = S.Doc('user-notes.json', 250);
      notesUI = root.UserNotesUI.create({
        title: t('menu.notes'), fontControl: true,
        toast: (text, kind) => toast(text, kind === 'error' ? 'bad' : kind),
        api: {
          get: async () => {
            let data = S.lsGet('userNotes', null);
            // the data folder copy is the truth; if Peergos does not answer within 8 s, open with this device's copy
            if (S.PEERGOS) {
              try { const r = await S.getJSON('user-notes.json', { timeout: 8000 }); if (r) data = r; }
              catch (e) { console.warn(e); toast(t('notes.localCopy'), 'warn', 6000); }
            }
            return root.UserNotesCore.migrate(data || { notes: [] }).notes;
          },
          save: async list => { const data = { version: 2, notes: list }; S.lsSet('userNotes', data); notesDoc.set(data); },
          saveText: async (text, kind) => {
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const name = 'notes-texts/' + (kind || 'text') + '-' + stamp + '.md';
            if (S.PEERGOS) await S.putText(name, text);
            else S.lsSet('note-text-' + stamp, text);
            return { file: (S.PEERGOS ? 'Ludo4Peergos data folder: ' : 'browser storage: ') + name };
          },
          copy: async text => {
            try { await navigator.clipboard.writeText(text); }
            catch (e) { const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
          },
          openFolder: () => toast('Saved texts are in the app’s private Peergos data folder (notes-texts).', 'info', 5000),
          print: S.PEERGOS ? async (html) => {
            const fd = new FormData(); fd.append('html', html); fd.append('css', ''); fd.append('title', 'Ludo4Peergos');
            await fetch('/peergos-api/v0/print/', { method: 'POST', body: fd });
            return {};
          } : undefined,
        },
        config: () => ({
          appName: 'Ludo4Peergos', version: VERSION,
          appDescription: 'A Ludo game that runs as a sandboxed Peergos custom app: play against the computer, on one device, or online with Peergos friends through the app chat API.',
          docs: ['README.md', 'docs/DESIGN.md', 'CHANGELOG.md'],
          location: 'The source is the Ludo4Peergos git repository (plain HTML/CSS/JS, no build step). Build and test there.',
          rules: ['Keep the app self-contained: the Peergos sandbox blocks every external request.', 'Bump the version in peergos-app.json and assets/js/version.js and add a CHANGELOG entry.', 'Never break the online protocol for running games (see docs/DESIGN.md).'],
          deliver: ['Run node tests/unit.test.js and the browser tests.', 'Build the versioned release ZIP with tools/make_release.py (it never overwrites an existing version).'],
          extraShort: ['Bump the version, test and build the release ZIP as usual.'],
        }),
      });
    }
    await notesUI.open();
  }

  // ───────────────────────────── game session ─────────────────────────────
  function startLocal(setup, title) {
    const g = { id: 'L' + Date.now().toString(36) + P.randomId(4), created: Date.now(), updated: Date.now(), title: title || defaultTitle(setup), setup, actions: [], round: 1, rounds: [] };
    localGames.unshift(g);
    saveLocalGames();
    openLocal(g.id);
  }
  function defaultTitle(setup) {
    const n = setup.seats.filter(Boolean).length;
    const bots = setup.seats.filter(s => s && s.kind === 'bot').length;
    return bots === n - 1 ? t('home.quickSub') : t('home.new') + ' · ' + n;
  }

  function openLocal(id) {
    const rec = localGames.find(g => g.id === id);
    if (!rec) return;
    // games saved by 0.1.0 have no speed: fix it now, so it cannot change while the game runs
    if (!rec.setup.speed) { rec.setup.speed = speedId(settings.anim); saveLocalGames(); }
    let state;
    try { state = R.replay(rec.setup, rec.actions); } catch (e) { toast(t('err.load'), 'bad'); return; }
    startSession({ mode: 'local', rec, setup: rec.setup, state });
  }

  async function openOnline(chatId, opts) {
    const host = P.chatOwner(chatId);
    const k = knownOnline[chatId];
    if (k && k.removed) delete knownOnline[chatId]; // opened again on purpose (e.g. from the News feed)
    knowGame(chatId, (opts && opts.title) || (k && k.title) || '');
    startSession({ mode: 'online', chatId, host, title: (opts && opts.title) || (k && k.title) || '', entries: (opts && opts.initial) || [], next: 0, setup: null, state: null });
  }

  function leaveToHome() {
    if (game && game.state && !game.state.over && settings.confirmLeave && game.mode === 'local' && game.phase !== 'loading') {
      confirm(t('game.leave'), t('game.backHome')).then(ok => { if (ok) { game.stop(); game = null; renderHome(); } });
      return;
    }
    if (game) { game.stop(); game = null; }
    renderHome();
  }

  function startSession(sess) {
    if (game) game.stop();
    game = createGameView(sess);
  }

  function createGameView(sess) {
    screen = 'game';
    const online = sess.mode === 'online';
    const m = main();
    m.className = 'screen game';
    const boardBox = h('div', { class: 'board' });
    const banner = h('div', { class: 'turn-banner', 'aria-live': 'polite' });
    const players = h('div', { class: 'players' });
    const dieEl = buildDie();
    const status = h('div', { class: 'status' });
    const hint = h('div', { class: 'status-hint' });
    const netState = h('div', { class: 'net-state' });
    const diceArea = h('div', { class: 'dice-area' }, h('button', { class: 'die-btn', id: 'die', 'aria-label': t('game.roll'), onclick: () => userRoll() }, dieEl.wrap), h('div', { class: 'status-box' }, status, hint, netState));
    const restartBox = h('div', { class: 'restart-box', hidden: true });
    const infoBox = h('div', { class: 'info-box' });
    const log = h('ol', { class: 'log', id: 'log' });
    const logBox = h('div', { class: 'log-box' }, h('div', { class: 'panel-head' }, icon('dice'), h('span', null, t('game.log'))), log);
    const actionsEl = h('div', { class: 'game-actions' });
    const left = h('aside', { class: 'side side-left' }, diceArea, players, restartBox, infoBox, logBox, actionsEl);
    let chatList = null, chatIn = null, right = null;
    if (online) {
      chatList = h('div', { class: 'chat-list' });
      chatIn = h('input', { class: 'text-in', type: 'text', maxlength: '200', placeholder: t('game.say'), onkeydown: e => { if (e.key === 'Enter') sendSay(); } });
      right = h('aside', { class: 'side side-right' }, h('div', { class: 'chat' }, h('div', { class: 'panel-head' }, icon('chat'), h('span', null, t('game.chat'))), chatList,
        h('div', { class: 'chat-input' }, chatIn, h('button', { class: 'icon-btn', title: t('game.send'), onclick: sendSay }, icon('send')))));
    }
    m.replaceChildren(h('div', { class: 'game-layout' + (online ? '' : ' no-chat') }, left, h('div', { class: 'board-wrap' }, boardBox, banner), right));

    const board = Board.create(boardBox, { onToken: (c, i) => userPick(c, i) });
    const self = {
      mode: sess.mode, sess, phase: 'loading', state: null, shownN: -1, roll: null, legal: [],
      busy: false, stopped: false, pollTimer: null, outbox: null, joined: new Set(), invited: new Set(),
      winnerShown: false, lastChange: 0, unknown: 0, prevTurn: null, seq: 0, sentRoundFor: new Set(),
      speedId: speedId(online ? settings.anim : sess.rec.setup.speed),
      stop, refresh,
    };
    const sp = () => SPEED[self.speedId] || SPEED.normal;
    self.roundNo = () => roundNo();
    self.currentRules = () => (online ? (self.replay && self.replay.setup ? R.normalizeRules(self.replay.setup.rules) : null) : R.normalizeRules(sess.rec.setup.rules));

    function stop() {
      self.stopped = true;
      clearTimeout(self.pollTimer);
      clearTimeout(nextTimer);
      document.removeEventListener('visibilitychange', onVis);
    }
    function onVis() { if (!document.hidden && online) schedulePoll(50); }
    document.addEventListener('visibilitychange', onVis);

    // ── who controls a seat on this device
    function controlOf(state, c) {
      const seat = state.seats[c];
      if (!seat) return 'none';
      if (!online) return seat.kind === 'bot' ? 'bot' : 'me';
      const ctrl = self.replay.controller(c, state.n);
      if (ctrl !== ME) return 'remote';
      return seat.kind === 'bot' || (self.replay.resignedAt[c] != null && state.n >= self.replay.resignedAt[c]) ? 'bot' : 'me';
    }
    function nameOf(c) {
      const seat = self.state.seats[c];
      if (online && seat && seat.kind === 'human' && self.replay && self.replay.resignedAt && self.replay.resignedAt[c] != null) return seatName(seat, c) + ' (' + t('game.computer') + ')';
      return seatName(seat, c);
    }
    function currentSetup() { return online ? (self.replay && self.replay.setup) : sess.rec.setup; }
    function iLeft() { return !!(online && self.replay && self.replay.left && self.replay.left.indexOf(ME) >= 0); }
    function hostGone() { return !!(online && self.replay && self.replay.hostLeft); }
    function roundNo() { return online ? (self.replay && self.replay.rounds.length ? self.replay.rounds[self.replay.rounds.length - 1].round : 1) : (sess.rec.round || 1); }
    function winsTally() {
      const wins = [0, 0, 0, 0];
      const list = online ? (self.replay ? self.replay.rounds.slice(0, -1) : []) : (sess.rec.rounds || []);
      for (const r of list) if (r.over && r.winner != null) wins[r.winner]++;
      return wins;
    }

    // ── panel
    function drawPlayers() {
      const st = self.state;
      if (!st) { players.replaceChildren(); return; }
      const wins = winsTally();
      const showWins = roundNo() > 1;
      players.replaceChildren(...[0, 1, 2, 3].filter(c => st.seats[c]).map(c => {
        const seat = st.seats[c];
        const place = st.finished.indexOf(c);
        const badges = [];
        if (online) {
          if (seat.kind === 'human' && seat.user === self.sess.host) badges.push(h('span', { class: 'badge' }, t('game.host')));
          if (seat.kind === 'human' && seat.user !== ME && seat.user !== self.sess.host && !self.joined.has(seat.user)) badges.push(h('span', { class: 'badge warn', title: t('game.notJoined', { name: seat.user }) }, t('game.invited')));
        }
        if (seat.kind === 'bot') badges.push(h('span', { class: 'badge' }, icon('cpu')));
        const pct = Math.round(R.progress(st, c) * 100);
        const active = st.turn === c && !st.over && !hostGone();
        return h('div', { class: 'player' + (active ? ' active' : '') + (place >= 0 ? ' done' : ''), style: { '--c': 'var(--p' + c + ')' } },
          h('span', { class: 'pl-token' }),
          h('span', { class: 'pl-main' }, h('span', { class: 'pl-name' }, nameOf(c), ...badges), h('span', { class: 'pl-bar' }, h('i', { style: { width: pct + '%' } }))),
          h('span', { class: 'pl-side' }, showWins ? h('span', { class: 'pl-wins', title: t('sum.wins') }, '🏆' + wins[c]) : null,
            place >= 0 ? h('span', { class: 'medal m' + (place + 1) }, String(place + 1)) : h('span', { class: 'pl-home', title: 'home' }, st.tokens[c].filter(p => p === R.FINISH).length + '/4')),
          active ? h('span', { class: 'pl-turn' }, '▶') : null);
      }));
    }
    function drawInfo() {
      const setup = currentSetup();
      if (!setup) { infoBox.replaceChildren(); return; }
      infoBox.replaceChildren(h('div', { class: 'panel-head' }, icon('flag'), h('span', null, t('game.info')), h('span', { class: 'round-tag' }, t('game.roundN', { n: roundNo() })),
        h('button', { class: 'link-btn small', id: 'btn-game-rules', onclick: openHelp, title: t('help.forGame') }, icon('help'), t('new.rules'))),
        summaryEl({ seats: setup.seats, rules: setup.rules, speed: self.speedId, round: 1, wins: [0, 0, 0, 0] }, { compact: true }));
    }
    function drawActions() {
      const btns = [];
      const st = self.state;
      if (online && st && self.replay && self.replay.setup) {
        const mine = st.seats.findIndex(s => s && s.kind === 'human' && s.user === ME);
        const ended = iLeft() || self.replay.hostLeft;
        if (mine >= 0 && !ended) btns.push(h('button', { class: 'btn small', id: 'btn-new-round', onclick: () => askRound(true) }, icon('play'), t('game.askRound')));
        if (mine >= 0 && !ended) btns.push(h('button', { class: 'btn small ghost danger-text', id: 'btn-leave', onclick: leaveGame }, icon('exit'), t('game.leaveGame')));
      } else if (!online && st) {
        btns.push(h('button', { class: 'btn small', id: 'btn-new-round', onclick: () => newRoundLocal(true) }, icon('play'), t('game.newRound')));
      }
      if (st && st.over) btns.push(h('button', { class: 'btn small', onclick: () => showWinner(false) }, icon('trophy'), t('game.over')));
      btns.push(h('button', { class: 'btn small ghost', onclick: () => leaveToHome() }, icon('home'), t('game.backHome')));
      actionsEl.replaceChildren(...btns);
    }
    function logRound(n) { log.appendChild(h('li', { class: 'round-sep' }, t('game.roundN', { n }))); }
    function addLog(text, color) {
      log.appendChild(h('li', { style: color != null ? { '--c': 'var(--p' + color + ')' } : null }, text));
      while (log.children.length > 300) log.firstChild.remove();
      log.scrollTop = log.scrollHeight;
    }
    function drawChat() {
      if (!online) return;
      const tl = (self.replay && self.replay.timeline) || [];
      chatList.replaceChildren(...tl.slice(-150).map(s => {
        if (s.kind === 'round') return h('div', { class: 'chat-round' }, h('span', null, t('game.roundN', { n: s.round })));
        if (s.kind === 'left') return h('div', { class: 'chat-sys' }, icon('exit'), h('span', null, t(s.host ? 'game.hostLeftLine' : 'game.leftLine', { name: s.author === ME ? t('common.you') : s.author })));
        const c = self.state ? self.state.seats.findIndex(x => x && x.user === s.author) : -1;
        return h('div', { class: 'say' + (s.author === ME ? ' me' : ''), style: c >= 0 ? { '--c': 'var(--p' + c + ')' } : null }, h('b', null, s.author === ME ? t('common.you') : s.author), h('span', null, s.text));
      }));
      chatList.scrollTop = chatList.scrollHeight;
    }
    function drawRestart() {
      const rs = online && self.replay ? self.replay.restart : null;
      if (!rs) { restartBox.hidden = true; return; }
      restartBox.hidden = false;
      // a question that needs my answer must not hide behind the results dialog
      if (!rs.declinedBy && !rs.complete && rs.needed.indexOf(ME) >= 0 && rs.votes[ME] === undefined && self.askedSeen !== rs.id) {
        self.askedSeen = rs.id;
        if (self.winnerDlg) self.winnerDlg.close();
        Sound.play('turn');
        toast(t('game.roundAsked', { name: rs.author }), 'info', 3500);
      }
      const who = rs.author === ME ? t('game.youAsked') : t('game.roundAsked', { name: rs.author });
      const kids = [h('div', { class: 'rb-title' }, icon('play'), who)];
      if (rs.declinedBy) kids.push(h('div', { class: 'rb-line bad' }, t('game.roundDeclined', { name: rs.declinedBy === ME ? t('common.you') : rs.declinedBy })));
      else if (rs.complete) kids.push(h('div', { class: 'rb-line ok' }, t('game.roundStarting', { host: self.sess.host === ME ? t('common.you') : self.sess.host })));
      else {
        if (rs.needed.indexOf(ME) >= 0 && rs.votes[ME] === undefined) {
          kids.push(h('div', { class: 'rb-buttons' },
            h('button', { class: 'btn small primary', id: 'btn-agree', onclick: () => vote(true) }, icon('check'), t('game.agree')),
            h('button', { class: 'btn small', id: 'btn-decline', onclick: () => vote(false) }, t('game.decline'))));
        }
        const waiting = rs.needed.filter(u => rs.votes[u] !== true);
        if (waiting.length) kids.push(h('div', { class: 'rb-line muted' }, t('game.roundWaiting', { names: waiting.map(u => u === ME ? t('common.you') : u).join(', ') })));
      }
      restartBox.replaceChildren(...kids);
    }
    function refresh() {
      drawPlayers(); drawActions(); drawInfo(); drawChat(); drawRestart(); updateStatus();
      document.getElementById('top-title').textContent = online ? (self.sess.title || 'Online') : (self.sess.rec ? self.sess.rec.title : '');
      diceArea.querySelector('.die-btn').setAttribute('aria-label', t('game.roll'));
      if (chatIn) chatIn.placeholder = t('game.say');
    }

    function updateStatus() {
      const st = self.state;
      hint.textContent = '';
      dieEl.wrap.classList.toggle('ready', self.phase === 'roll');
      diceArea.classList.toggle('my-turn', self.phase === 'roll' || self.phase === 'pick');
      if (!st) { status.textContent = '…'; board.setActive(-1); return; }
      const c = st.turn;
      board.setActive(st.over ? -1 : c);
      diceArea.style.setProperty('--c', 'var(--p' + c + ')');
      if (st.over) { status.textContent = st.winner == null ? t('game.over') : isMine(st.seats[st.winner]) ? t('game.youWin') : t('game.wins', { name: nameOf(st.winner) }); return; }
      if (hostGone()) { status.textContent = t('game.hostLeftStatus', { name: self.sess.host === ME ? t('common.you') : self.sess.host }); hint.textContent = t('game.endedHint'); board.setActive(-1); return; }
      if (iLeft()) hint.textContent = t('game.youLeftHint');
      const ctl = controlOf(st, c);
      if (self.phase === 'roll') {
        status.textContent = st.seats[c].kind === 'local' ? t('game.turnOf', { name: nameOf(c) }) : t('game.yourTurn');
        hint.textContent = t('game.rollHint');
      } else if (self.phase === 'pick') {
        status.textContent = t('game.pick'); hint.textContent = t('game.pickHint');
      } else if (ctl === 'remote') {
        const seat = st.seats[c];
        const ctrl = self.replay.controller(c, st.n);
        if (seat.kind === 'bot' || ctrl !== seat.user) status.textContent = t('game.waitingHost', { name: ctrl });
        else status.textContent = t('game.waitingFor', { name: nameOf(c) });
        if (seat.kind === 'human' && seat.user !== self.sess.host && !self.joined.has(seat.user)) hint.textContent = t('game.notJoined', { name: seat.user });
      } else if (self.phase === 'banner' && ctl === 'me') {
        status.textContent = st.seats[c].kind === 'local' ? t('game.turnOf', { name: nameOf(c) }) : t('game.yourTurn');
      } else if (self.phase === 'bot' || self.phase === 'banner') {
        status.textContent = t('game.rolling', { name: nameOf(c) });
      } else {
        status.textContent = ctl === 'me' && isMine(st.seats[c]) ? t('game.yourTurn') : t('game.turnOf', { name: nameOf(c) });
      }
    }

    // ── turn banner: who plays now, shown on the board before the turn starts
    async function showBanner(c, text, ms) {
      bannerLog.push({ c, text, mine: isMine(self.state && self.state.seats[c]) && controlOf(self.state, c) === 'me' });
      if (bannerLog.length > 400) bannerLog.shift();
      if (!ms) return;
      banner.style.setProperty('--c', 'var(--p' + c + ')');
      banner.replaceChildren(h('span', { class: 'tb-token' }), h('span', { class: 'tb-text' }, text));
      banner.classList.remove('show'); void banner.offsetWidth; banner.classList.add('show');
      await sleep(ms);
      banner.classList.remove('show');
    }
    function bannerText(c, changed) {
      if (!changed) {
        // "Roll again" speaks to you – when the computer or another player goes on, say who it is
        const mineNow = isMine(self.state.seats[c]) && controlOf(self.state, c) === 'me';
        return mineNow ? t('game.again') : t('game.againOther', { name: nameOf(c) });
      }
      const seat = self.state.seats[c];
      if (isMine(seat) && controlOf(self.state, c) === 'me') return t('game.yourTurnBanner');
      return t('game.turnBanner', { name: nameOf(c) });
    }

    // ── state changes
    function eventsToLog(action, events, by) {
      for (const ev of events) {
        if (ev.type === 'move') addLog(t('game.rolled', { name: nameOf(by), roll: action.r }) + ' → ' + (ev.from < 0 ? '⬆' : '') + ' #' + (ev.token + 1), by);
        else if (ev.type === 'pass') addLog(t('game.rolled', { name: nameOf(by), roll: action.r }) + ' – ' + t('game.noMove').toLowerCase(), by);
        else if (ev.type === 'threeSixes') addLog(t('game.threeSixes'), by);
        else if (ev.type === 'capture') addLog(t('game.captured', { a: nameOf(ev.color), b: nameOf(ev.victim) }), ev.color);
        else if (ev.type === 'selfCapture') addLog(t('game.selfCaptured', { name: nameOf(ev.color) }), ev.color);
        else if (ev.type === 'finished') addLog(t('game.finished', { name: nameOf(ev.color), place: ev.place }), ev.color);
      }
    }

    async function showAction(action, res, by) {
      dieEl.show(action.r, by);
      eventsToLog(action, res.events, by);
      const hooks = {
        step: () => Sound.play('step'),
        capture: ev => { Sound.play('capture'); toast(ev.type === 'selfCapture' ? t('game.selfCaptured', { name: nameOf(ev.color) }) : t('game.captured', { a: nameOf(ev.color), b: nameOf(ev.victim) }), 'info', 2200); },
        home: () => Sound.play('home'),
      };
      if (res.events.some(e => e.type === 'move' && e.from === -1)) Sound.play('enter');
      await board.animate(res.state, res.events, sp().step, hooks);
      for (const ev of res.events) {
        if (ev.type === 'pass' || ev.type === 'threeSixes') Sound.play('nomove');
        if (ev.type === 'finished') toast(t('game.finished', { name: nameOf(ev.color), place: ev.place }), 'ok');
      }
      drawPlayers();
    }

    /** Commits an action for the player to move on this device. */
    async function commit(action) {
      const prev = self.state;
      const by = prev.turn;
      let res;
      try { res = R.apply(prev, action); } catch (e) { console.error('illegal', e); return; }
      self.busy = true;
      board.setMovable(-1, []);
      self.phase = 'anim';
      if (!online) {
        sess.rec.actions.push(action);
        sess.rec.updated = Date.now();
        saveLocalGames();
        self.state = res.state;
      } else {
        const msg = P.msg('move', { g: self.replay.setup.g, n: prev.n, c: by, r: action.r, t: action.t }, VERSION);
        pushOwn(msg);
        self.state = self.replay.state;
      }
      self.shownN = res.state.n;
      await showAction(action, res, by);
      self.busy = false;
      afterChange();
    }

    /** Sends one of our own messages: into the local log at once (replayed), and out through the outbox. */
    function pushOwn(msg) {
      const text = P.encode(msg);
      sess.entries.push({ author: ME, text, type: 'Application', local: true });
      self.outbox.push(text);
      self.replay = P.replay(sess.entries, sess.host);
      if (online) rememberOnline(sess.chatId, self.replay);
    }

    function afterChange() {
      if (self.stopped) return;
      self.lastChange = Date.now();
      drawPlayers(); drawActions(); drawChat(); drawRestart();
      if (online) maybeStartRound();
      next();
    }

    // 0.6.0: a chat read can hand over an equal state as a new object (e.g. the echo of our own move); compare the
    // position (game and move number), not the object – in 0.5.0 that echo, landing during a turn banner, stopped the
    // turn for good (the host's computer player never moved, or the die did not react).
    function samePosition(a, b) {
      return !!a && !!b && (a === b || (a.n === b.n && a.turn === b.turn && a.over === b.over && a.sixes === b.sixes &&
        JSON.stringify(a.tokens) === JSON.stringify(b.tokens)));
    }

    let nextTimer = null;
    async function next() {
      clearTimeout(nextTimer);
      const st = self.state;
      if (!st || self.busy) return;
      const mySeq = ++self.seq;
      if (st.over) {
        self.phase = 'over';
        updateStatus(); drawActions();
        if (!self.winnerShown) { self.winnerShown = true; setTimeout(() => showWinner(true), 600); }
        return;
      }
      if (hostGone()) { self.phase = 'ended'; board.setMovable(-1, []); updateStatus(); drawActions(); return; }
      const ctl = controlOf(st, st.turn);
      // announce the turn: who plays now (and "roll again" when the same colour goes on)
      const changed = self.prevTurn !== st.turn;
      if (self.bannerKey !== st.n + ':' + (online && self.replay.setup ? self.replay.setup.g : sess.rec.round)) {
        self.bannerKey = st.n + ':' + (online && self.replay.setup ? self.replay.setup.g : sess.rec.round);
        self.prevTurn = st.turn;
        self.phase = ctl === 'remote' ? 'wait' : 'banner';
        updateStatus();
        if (changed && ctl === 'me' && isMine(st.seats[st.turn])) Sound.play('turn');
        await showBanner(st.turn, bannerText(st.turn, changed), changed ? sp().banner : Math.round(sp().banner * 0.6));
        if (mySeq !== self.seq || self.stopped || !samePosition(self.state, st)) return;
      }
      if (ctl === 'me') {
        self.phase = 'roll';
        updateStatus();
        if (settings.autoRoll) nextTimer = setTimeout(() => userRoll(), sp().think);
      } else if (ctl === 'bot') {
        self.phase = 'bot';
        updateStatus();
        nextTimer = setTimeout(botTurn, sp().think);
      } else {
        self.phase = 'wait';
        updateStatus();
      }
    }

    async function botTurn() {
      if (self.stopped || self.busy || !self.state || self.state.over) return;
      if (controlOf(self.state, self.state.turn) !== 'bot') return next();
      const st = self.state;
      const r = rollDie();
      self.busy = true;
      await dieEl.roll(r, st.turn, sp().dice);
      self.busy = false;
      if (self.stopped || !samePosition(self.state, st)) return;
      const tk = AI.choose(st, r, st.seats[st.turn].level || 'normal');
      if (tk === -1) await sleep(Math.round(sp().pause * 0.6));
      await commit({ r, t: tk });
    }

    async function userRoll() {
      if (self.phase !== 'roll' || self.busy || hostGone()) return;
      Sound.unlock();
      const st = self.state;
      const r = rollDie();
      self.busy = true;
      self.phase = 'rolling';
      updateStatus();
      await dieEl.roll(r, st.turn, sp().dice);
      self.busy = false;
      if (self.stopped || !samePosition(self.state, st)) return;
      const legal = R.legalMoves(st, r);
      self.roll = r; self.legal = legal;
      // make the rule visible when it decides the move
      if (st.rules.mustEnter && r === 6 && legal.length && legal.every(i => st.tokens[st.turn][i] === -1) &&
          st.tokens[st.turn].some(p => p >= 0 && p < R.FINISH)) {
        toast(t('game.mustEnterNow'), 'info', 3000);
        hint.textContent = t('game.mustEnterNow');
      } else if (st.rules.mustEnter && r === 6 && R.justEnteredGrace(st) && st.tokens[st.turn].some(p => p === -1)) {
        toast(t('game.graceNow'), 'info', 3500);
      }
      if (!legal.length) {
        status.textContent = R.isThirdSix(st, r) ? t('game.threeSixes') : t('game.noMove');
        hint.textContent = '';
        await sleep(sp().pause);
        return commit({ r, t: -1 });
      }
      const distinct = new Set(legal.map(i => st.tokens[st.turn][i]));
      if (settings.autoMove && (legal.length === 1 || distinct.size === 1)) {
        await sleep(Math.min(400, sp().pause));
        return commit({ r, t: legal[0] });
      }
      self.phase = 'pick';
      board.setMovable(st.turn, legal, settings.hints);
      updateStatus();
    }

    function userPick(c, i) {
      if (self.phase !== 'pick' || self.busy) return;
      if (c !== self.state.turn) return;
      if (self.legal.indexOf(i) < 0) {
        const p = self.state.tokens[c][i];
        const alt = self.legal.find(j => self.state.tokens[c][j] === p);
        if (alt == null) return;
        i = alt;
      }
      commit({ r: self.roll, t: i });
    }

    self.onSettings = patch => {
      if (patch.autoRoll && self.phase === 'roll' && !self.busy) { clearTimeout(nextTimer); nextTimer = setTimeout(() => userRoll(), sp().think); }
      if ('hints' in patch && self.phase === 'pick') board.setMovable(self.state.turn, self.legal, settings.hints);
    };

    // keyboard
    self.key = e => {
      if (self.stopped) return;
      if (e.key === ' ' || e.key === 'Enter') { if (self.phase === 'roll') { e.preventDefault(); userRoll(); } }
      else if (/^[1-4]$/.test(e.key) && self.phase === 'pick') { const i = +e.key - 1; if (self.legal.indexOf(i) >= 0) commit({ r: self.roll, t: i }); }
    };

    // ── new round
    async function newRoundLocal(ask) {
      const st = self.state, rec = sess.rec;
      if (ask && !st.over && !(await confirm(t('game.newRoundConfirm'), t('game.newRound')))) return;
      rec.rounds = rec.rounds || [];
      rec.rounds.push({ round: rec.round || 1, over: st.over, winner: st.over ? st.winner : null, finished: st.finished.slice(), n: st.n });
      rec.round = (rec.round || 1) + 1;
      rec.setup = Object.assign({}, rec.setup, { first: randomFirst(rec.setup.seats) });
      rec.actions = [];
      rec.updated = Date.now();
      saveLocalGames();
      if (self.winnerDlg) self.winnerDlg.close();
      openLocal(rec.id);
    }
    async function askRound(confirmFirst) {
      if (!self.replay || !self.replay.setup) return;
      if (confirmFirst && !(await confirm(t('game.askRoundConfirm'), t('game.askRound')))) return;
      pushOwn(P.msg('restartAsk', { g: self.replay.setup.g }, VERSION));
      afterChange();
    }
    function vote(yes) {
      const rs = self.replay && self.replay.restart;
      if (!rs) return;
      pushOwn(P.msg('restartVote', { g: self.replay.setup.g, ask: rs.id, yes: !!yes }, VERSION));
      afterChange();
    }
    /** The host's app starts the new round once everyone agreed (same players, rules and speed; same chat). */
    function maybeStartRound() {
      const rep = self.replay;
      if (!rep || !rep.restart || !rep.restart.complete || sess.host !== ME || rep.hostLeft) return;
      const id = rep.restart.id;
      if (self.sentRoundFor.has(id) || rep.setups.some(s => s.ask === id)) return;
      self.sentRoundFor.add(id);
      const s = rep.setup;
      // players who left the game are replaced by computer players (the host's app runs them)
      const seats = s.seats.map(seat => seat && seat.kind === 'human' && (rep.left || []).indexOf(seat.user) >= 0 ? { kind: 'bot', level: settings.level } : seat);
      pushOwn(P.msg('setup', { g: P.randomId(8), seats, rules: s.rules, speed: s.speed || self.speedId, first: randomFirst(s.seats), round: roundNo() + 1, ask: id }, VERSION));
      self.replay = null;
      integrate();
    }

    // ── online sync
    async function poll() {
      if (self.stopped) return;
      if (document.hidden) { schedulePoll(4000); return; }
      // 0.6.0: one poll at a time – coming back to the window used to start a second read while a slow one ran
      if (self.polling) { self.pollAgain = true; return; }
      self.polling = true;
      let res = null;
      const slow = setTimeout(() => { if (self.polling && !netState.classList.contains('bad')) { netState.textContent = t('game.slow'); netState.className = 'net-state slow'; } }, 8000);
      try {
        res = await Net.read(sess.chatId, sess.next);
      } catch (e) {
        console.warn('poll', e);
        netState.textContent = t('game.offline');
        netState.className = 'net-state bad';
      } finally { clearTimeout(slow); }
      if (res) try {
        sess.next = res.next;
        let fresh = 0;
        for (const e of res.entries) {
          if (e.type === 'Join' && e.joinUsername) self.joined.add(e.joinUsername);
          if (e.type === 'Invite' && e.inviteUsername) self.invited.add(e.inviteUsername);
          if (e.type === 'Application' && e.text) { sess.entries.push(e); fresh++; }
        }
        netState.textContent = self.outbox && self.outbox.size ? t('game.sending') : '';
        netState.className = 'net-state';
        if (fresh || !self.replay) await integrate();
        else { drawPlayers(); if (self.phase === 'wait') updateStatus(); }
      } catch (e) {
        console.warn('integrate', e); // not a network problem – never shown as "Not connected"
        self.busy = false;
      }
      self.polling = false;
      if (self.pollAgain) { self.pollAgain = false; schedulePoll(50); return; }
      schedulePoll(POLL_MS || settings.pollMs || (self.phase === 'wait' || (self.replay && self.replay.restart) ? (Date.now() - self.lastChange < 60000 ? 1500 : 3000) : 5000));
    }
    function schedulePoll(ms) { clearTimeout(self.pollTimer); if (!self.stopped) self.pollTimer = setTimeout(poll, ms); }

    async function integrate() {
      const rep = P.replay(sess.entries, sess.host);
      if (!rep.setup) {
        self.replay = rep;
        self.phase = 'loading';
        status.textContent = t('game.waitingFor', { name: sess.host });
        return;
      }
      if (rep.unknown && !self.unknown) { self.unknown = rep.unknown; toast(t('game.newProtocol'), 'warn', 8000); }
      rememberOnline(sess.chatId, rep);
      noticeNews(rep);
      const newGame = !self.replay || !self.replay.setup || self.replay.setup.g !== rep.setup.g;
      const prevShown = self.shownN;
      if (newGame) {
        if (self.winnerDlg) self.winnerDlg.close();
        clearTimeout(nextTimer);
        self.seq++;
        self.replay = rep;
        self.speedId = speedId(rep.setup.speed || self.speedId);
        self.state = rep.state;
        self.shownN = rep.state.n;
        self.winnerShown = rep.state.over;
        self.prevTurn = null; self.bannerKey = null;
        self.busy = false;
        board.setMovable(-1, []);
        log.replaceChildren();
        logRound(roundNo());
        for (const item of rep.history.slice(-60)) eventsToLog(item.action, item.events, item.c);
        board.render(rep.state);
        board.showTrail(0, []);
        if (rep.state.last && rep.state.last.roll) dieEl.show(rep.state.last.roll, rep.state.last.color);
        drawInfo();
        afterChange();
        return;
      }
      self.replay = rep;
      if (self.busy) { drawChat(); drawRestart(); drawActions(); return; } // the running animation picks it up in afterChange
      const pending = rep.history.filter(x => x.n >= prevShown);
      if (!pending.length) {
        if (!(self.state && self.state.n === rep.state.n)) { self.state = rep.state; self.shownN = rep.state.n; }
        drawChat(); drawPlayers(); drawRestart(); drawActions(); maybeStartRound();
        if (hostGone() && self.phase !== 'ended') { self.seq++; clearTimeout(nextTimer); next(); }
        // a player left while it was their turn: this app (the host's) may have to play that colour now
        else if (self.phase === 'wait' && self.state && !self.state.over && controlOf(self.state, self.state.turn) !== 'remote') { self.seq++; clearTimeout(nextTimer); next(); }
        return;
      }
      if (pending.length > 6) { // too many to animate: jump
        self.state = rep.state; self.shownN = rep.state.n;
        for (const item of pending) eventsToLog(item.action, item.events, item.c);
        board.render(rep.state);
        afterChange();
        return;
      }
      self.busy = true;
      clearTimeout(nextTimer);
      self.seq++;
      board.setMovable(-1, []);
      let st = self.state;
      try {
      for (const item of pending) {
        if (self.stopped) return;
        const res = R.apply(st, item.action);
        const by = st.turn;
        if (by !== self.prevTurn) {
          self.prevTurn = by;
          self.state = st;
          updateStatus();
          await showBanner(by, bannerText(by, true), sp().banner);
        } else {
          await sleep(Math.round(sp().think / 2));
        }
        self.state = res.state;
        self.shownN = res.state.n;
        await dieEl.roll(item.action.r, by, sp().dice);
        await showAction(item.action, res, by);
        st = res.state;
      }
      } catch (e) {
        // the shown board and the chat disagree (should not happen): show the chat's position instead of getting stuck
        console.warn('resync', e);
        self.state = self.replay.state; self.shownN = self.state.n;
        board.render(self.state);
      } finally {
        self.busy = false;
      }
      self.bannerKey = null;
      // moves that arrived while these were animated: show them too (0.5.0 jumped to them but kept the old move counter,
      // so the next update re-applied moves that were already on the board)
      if (!self.stopped && self.replay.setup && self.replay.state.n > self.shownN) { await integrate(); return; }
      self.state = self.replay.state; self.shownN = self.state.n;
      afterChange();
    }

    /** Sound and toasts for what other players did outside the board: chat lines, leaving the game. */
    function noticeNews(rep) {
      const says = (rep.timeline || []).filter(x => x.kind === 'say' && x.author !== ME).length;
      const left = (rep.left || []).filter(u => u !== ME);
      if (!self.newsInit) { self.newsInit = true; self.saysSeen = says; self.leftSeen = new Set(left); return; }
      if (says > self.saysSeen) {
        Sound.play('chat');
        if (chatList) { const box = chatList.closest('.chat'); box.classList.remove('ping'); void box.offsetWidth; box.classList.add('ping'); }
      }
      self.saysSeen = says;
      for (const u of left) {
        if (self.leftSeen.has(u)) continue;
        self.leftSeen.add(u);
        Sound.play('leave');
        toast(t(u === sess.host ? 'game.hostLeftToast' : 'game.leftToast', { name: u }), 'warn', 7000);
      }
    }

    function sendSay() {
      const text = chatIn.value.trim();
      if (!text || !online || !self.replay || !self.replay.setup) return;
      chatIn.value = '';
      pushOwn(P.msg('say', { g: self.replay.setup.g, text }, VERSION));
      drawChat();
    }

    /** Leaves the game for good: the others are told (chat line + toast), the computer plays my colour from now on.
     *  When the host leaves, the game ends for everybody (only the host's app runs the computer players). */
    async function leaveGame() {
      if (!self.replay || !self.replay.setup || iLeft()) return;
      const host = sess.host === ME;
      if (!(await confirm(t(host ? 'game.leaveConfirmHost' : 'game.leaveConfirm'), t('game.leaveGame'), { danger: true }))) return;
      const mine = self.state.seats.findIndex(s => s && s.kind === 'human' && s.user === ME);
      pushOwn(P.msg('leave', { g: self.replay.setup.g, c: mine, after: self.state.n }, VERSION));
      clearTimeout(nextTimer);
      board.setMovable(-1, []);
      self.phase = 'wait';
      if (self.winnerDlg) self.winnerDlg.close();
      drawActions(); drawChat(); updateStatus();
      // make sure the message is out before going back (the outbox keeps trying in the background anyway)
      const t0 = Date.now();
      toast(t('game.leaving'), 'info', 2500);
      while (self.outbox.size && Date.now() - t0 < 10000) await sleep(150);
      toast(self.outbox.size ? t('game.leftPending') : t('game.leftDone'), self.outbox.size ? 'warn' : 'ok', 4000);
      if (game === self) { stop(); game = null; renderHome(); }
    }

    // ── winner
    function showWinner(auto) {
      const st = self.state;
      if (!st || !st.over) return;
      const rs = online && self.replay ? self.replay.restart : null;
      if (auto === true && rs && !rs.declinedBy && !rs.complete) return; // a new-round question is already open – answer that first
      Sound.play('win');
      const order = st.finished.concat([0, 1, 2, 3].filter(c => st.seats[c] && st.finished.indexOf(c) < 0).sort((a, b) => R.progress(st, b) - R.progress(st, a)));
      const iWon = isMine(st.seats[st.winner]);
      const isPlayer = online ? st.seats.some(s => s && s.kind === 'human' && s.user === ME) && !iLeft() && !hostGone() : true;
      if (self.winnerDlg) self.winnerDlg.close();
      const d = self.winnerDlg = dialog({
        title: t('game.over'), icon: 'trophy', cls: 'dlg-winner', onClose: () => { if (self.winnerDlg === d) self.winnerDlg = null; },
        body: [h('div', { class: 'winner-hero', style: { '--c': 'var(--p' + st.winner + ')' } }, h('div', { class: 'winner-token' }), h('h2', null, iWon ? t('game.youWin') : t('game.wins', { name: nameOf(st.winner) }))),
          h('ol', { class: 'ranking' }, order.map((c, k) => h('li', { style: { '--c': 'var(--p' + c + ')' } }, h('span', { class: 'medal m' + (k + 1) }, String(k + 1)), chip(c), nameOf(c))))],
        footer: [h('button', { class: 'btn', onclick: () => { d.close(); leaveToHome(); } }, icon('home'), t('game.backHome')),
          isPlayer ? h('button', { class: 'btn primary', id: 'btn-rematch', onclick: () => { d.close(); if (online) askRound(false); else newRoundLocal(false); } }, icon('play'), online ? t('game.askRound') : t('game.rematch')) : null],
      });
      if (iWon) confetti();
    }

    // ── start
    drawActions();
    if (!online) {
      self.state = sess.state;
      self.shownN = sess.state.n;
      self.winnerShown = sess.state.over;
      board.render(sess.state);
      logRound(sess.rec.round || 1);
      try {
        let s = R.newGame(sess.setup);
        const acts = sess.rec.actions;
        acts.forEach((a, k) => { const res = R.apply(s, a); if (k >= acts.length - 60) eventsToLog(a, res.events, s.turn); s = res.state; });
      } catch (e) { console.warn(e); }
      if (sess.state.last && sess.state.last.roll) dieEl.show(sess.state.last.roll, sess.state.last.color);
      refresh();
      afterChange();
    } else {
      self.outbox = Net.Outbox(sess.chatId, st => { netState.textContent = st === 'sending' ? t('game.sending') : st === 'offline' ? t('game.offline') : ''; netState.className = 'net-state' + (st === 'offline' ? ' bad' : ''); });
      status.textContent = '…';
      refresh();
      (async () => {
        try {
          const list = onlineList || await Net.listGames().catch(() => []);
          const c = (list || []).find(x => x.chatId === sess.chatId);
          if (c) { sess.title = c.title; if (screen === 'game' && game === self) document.getElementById('top-title').textContent = c.title; (c.members || []).forEach(u => self.invited.add(u)); if (c.title) knowGame(sess.chatId, c.title); }
        } catch (e) { /* title is optional */ }
      })();
      (async () => {
        try {
          const res = await Net.read(sess.chatId, 0);
          sess.next = res.next;
          const local = sess.entries.slice();
          sess.entries = [];
          for (const e of res.entries) {
            if (e.type === 'Join' && e.joinUsername) self.joined.add(e.joinUsername);
            if (e.type === 'Application' && e.text) sess.entries.push(e);
          }
          for (const e of local) sess.entries.push(e);
          await integrate();
        } catch (e) { console.error(e); toast(t('err.load'), 'bad'); }
        schedulePoll(2500);
      })();
    }
    return self;
  }

  // ───────────────────────────── die ─────────────────────────────
  function buildDie() {
    const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
    const faces = [1, 2, 3, 4, 5, 6].map(n => h('div', { class: 'face f' + n }, PIPS[n].map(p => h('span', { class: 'pip', style: { gridRow: String(Math.ceil(p / 3)), gridColumn: String(((p - 1) % 3) + 1) } }))));
    const cube = h('div', { class: 'cube' }, faces);
    const wrap = h('div', { class: 'die' }, cube);
    const ROT = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
    let spins = 0;
    function pose(n, extra) { const [x, y] = ROT[n]; cube.style.transform = 'rotateX(' + (x + extra * 360) + 'deg) rotateY(' + (y + extra * 360) + 'deg)'; }
    pose(1, 0);
    return {
      wrap,
      async roll(n, color, ms) {
        wrap.style.setProperty('--c', 'var(--p' + color + ')');
        if (!ms) { pose(n, spins); return; }
        Sound.play('roll');
        spins += 2;
        cube.style.transition = 'transform ' + ms + 'ms cubic-bezier(.15,.75,.25,1)';
        wrap.classList.add('rolling');
        pose(n, spins);
        await sleep(ms);
        wrap.classList.remove('rolling');
        Sound.play('land');
      },
      show(n, color) { wrap.style.setProperty('--c', 'var(--p' + color + ')'); cube.style.transition = 'none'; pose(n, spins); },
    };
  }

  // ───────────────────────────── confetti ─────────────────────────────
  function confetti() {
    if (game && game.speedId === 'instant') return;
    const cv = h('canvas', { class: 'confetti' });
    document.body.appendChild(cv);
    const W = cv.width = innerWidth, H = cv.height = innerHeight, ctx = cv.getContext('2d');
    const cs = getComputedStyle(document.documentElement);
    const cols = [0, 1, 2, 3].map(c => cs.getPropertyValue('--p' + c).trim() || '#fff').concat([cs.getPropertyValue('--acc').trim()]);
    const ps = Array.from({ length: 160 }, () => ({ x: Math.random() * W, y: -20 - Math.random() * H * 0.5, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 3, r: 4 + Math.random() * 5, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3, c: cols[Math.floor(Math.random() * cols.length)] }));
    const t0 = performance.now();
    (function frame(now) {
      ctx.clearRect(0, 0, W, H);
      for (const p of ps) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.03; p.a += p.va;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore();
      }
      if (now - t0 < 3800) requestAnimationFrame(frame); else cv.remove();
    })(t0);
  }

  // ───────────────────────────── boot ─────────────────────────────
  function onKey(e) {
    const tag = (e.target && e.target.tagName) || '';
    if (notesUI && notesUI.isOpen()) return;
    if (e.ctrlKey && e.shiftKey && (e.key === 'N' || e.key === 'n')) { e.preventDefault(); if (settings.showNotes) openNotes(); return; }
    if (e.key === 'Escape') { const d = UI.topDialog(); if (d) { e.preventDefault(); d.close(); } return; }
    if (UI.topDialog() || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.target && e.target.closest && e.target.closest('button') && (e.key === ' ' || e.key === 'Enter') && !e.target.closest('.die-btn')) return;
    if (game && game.key) game.key(e);
  }

  function boot() {
    applySettings();
    const app = document.getElementById('app');
    app.replaceChildren(header(), h('main', { id: 'main', class: 'screen' }));
    applySettings();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', () => Sound.unlock(), { once: true });
    const chatId = url.searchParams.get('chatId');
    if (chatId && Net.available) openOnline(chatId);
    else renderHome();
    if (S.PEERGOS) { loadRemoteSettings(); loadRemoteGames(); loadRemoteKnown(); }
    root.addEventListener('beforeunload', () => { settingsDoc.flushNow(); gamesDoc.flushNow(); knownDoc.flushNow(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && screen === 'home' && Net.available) loadOnlineList(); });
  }

  L.App = { boot, settings: () => settings, set, THEMES, SPEED, get game() { return game; }, openSettings, openNotes, renderHome, quickGame, bannerLog };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
