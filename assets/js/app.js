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
    { id: 'midnight', name: 'Midnight', dark: true, sw: ['#0f1530', '#f5c451', '#ef4f5f', '#3ccf7d', '#f7c948', '#4c8dff'] },
    { id: 'obsidian', name: 'Obsidian', dark: true, sw: ['#0b0c0f', '#38e1ff', '#ff4d6d', '#2ee59d', '#ffd23f', '#4d7cff'] },
    { id: 'aurora', name: 'Aurora', dark: true, sw: ['#0d1f2a', '#6ff2c4', '#ff6b8b', '#57e39b', '#ffd36e', '#6aa8ff'] },
    { id: 'ember', name: 'Ember', dark: true, sw: ['#1a1310', '#ff9a3c', '#e8473c', '#7fbf4d', '#f2c14e', '#4f8fd6'] },
    { id: 'forest', name: 'Forest', dark: true, sw: ['#0f1a14', '#c6e86b', '#e5544b', '#4fc77a', '#f0cf55', '#4c9ad8'] },
    { id: 'ocean', name: 'Ocean', dark: true, sw: ['#071a2b', '#4fd1e8', '#ff6670', '#36d3a0', '#ffd166', '#3d8bff'] },
    { id: 'velvet', name: 'Velvet', dark: true, sw: ['#1a0f22', '#ff7ac6', '#ff5470', '#4fd18b', '#ffcf5c', '#7b8cff'] },
    { id: 'nord', name: 'Nord', dark: true, sw: ['#2e3440', '#88c0d0', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1'] },
    { id: 'graphite', name: 'Graphite', dark: true, sw: ['#18191b', '#8ab4ff', '#e05a5a', '#55b878', '#e3b94f', '#5a8ee0'] },
    { id: 'neon', name: 'Neon', dark: true, sw: ['#0a0614', '#ff2bd6', '#ff3864', '#00f5a0', '#fff700', '#00c2ff'] },
    { id: 'classic', name: 'Classic', dark: false, sw: ['#f3ead8', '#b5282f', '#d62f3a', '#1e9b4f', '#f2c12e', '#1f6fd1'] },
    { id: 'sand', name: 'Sand', dark: false, sw: ['#efe6d6', '#8a5a2b', '#c8473f', '#4f9a5f', '#d9a93a', '#3f78b5'] },
  ];
  const DEFAULTS = {
    theme: 'auto', lang: 'auto', sound: true, volume: 0.6, anim: 'normal', tokens: 'glossy',
    autoMove: true, autoRoll: false, hints: true, confirmLeave: true, showNotes: true,
    level: 'normal', rules: Object.assign({}, R.DEFAULT_RULES),
    lastLocal: null, lastOnline: null, settingsSection: 'look', savedAt: 0,
  };
  const SPEED = {
    slow: { step: 260, think: 950, dice: 760, pause: 900 },
    normal: { step: 170, think: 620, dice: 560, pause: 650 },
    fast: { step: 90, think: 300, dice: 340, pause: 380 },
    instant: { step: 0, think: 60, dice: 0, pause: 120 },
  };
  let settings = Object.assign({}, DEFAULTS, S.lsGet('settings', {}));
  settings.rules = R.normalizeRules(settings.rules);
  let saveState = 'saved';
  const saveListeners = new Set();
  const settingsDoc = S.Doc('settings.json', 250, s => { saveState = s; saveListeners.forEach(f => f(s)); });

  function speed() { return SPEED[settings.anim] || SPEED.normal; }

  function applySettings() {
    let theme = settings.theme;
    if (theme === 'auto' || !THEMES.some(x => x.id === theme)) theme = PEERGOS_THEME === 'dark-mode' ? 'midnight' : (PEERGOS_THEME === '' && url.searchParams.has('theme') ? 'classic' : 'midnight');
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.tokens = settings.tokens;
    document.documentElement.dataset.anim = settings.anim;
    I18n.setLang(I18n.resolve(settings.lang, PEERGOS_LANG));
    Sound.configure(settings.sound, settings.volume);
    const nb = document.getElementById('btn-notes');
    if (nb) nb.hidden = !settings.showNotes;
    const sb = document.getElementById('btn-sound');
    if (sb) { sb.replaceChildren(icon(settings.sound ? 'sound' : 'mute')); sb.title = t('menu.sound'); }
  }

  /** Changes settings and saves at once (no Save button anywhere). */
  function set(patch, opts) {
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
          settings.rules = R.normalizeRules(settings.rules);
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

  // ───────────────────────────── helpers ─────────────────────────────
  function rollDie() {
    const a = new Uint8Array(1);
    do { crypto.getRandomValues(a); } while (a[0] >= 252);
    return (a[0] % 6) + 1;
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const colorName = c => t('color.' + c);

  function seatName(seat, c) {
    if (!seat) return '';
    if (seat.kind === 'bot') return t('game.computerName') + ' · ' + t('level.' + (seat.level || 'normal'));
    if (seat.kind === 'local') return seat.name || colorName(c);
    if (seat.user && seat.user === ME) return t('common.you');
    return seat.user || seat.name || t('common.you');
  }

  // ───────────────────────────── app shell ─────────────────────────────
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
      h('button', { class: 'icon-btn', id: 'btn-sound', onclick: () => { set({ sound: !settings.sound }); if (settings.sound) Sound.play('click'); } }, icon(settings.sound ? 'sound' : 'mute')),
      h('button', { class: 'icon-btn', id: 'btn-full', title: t('menu.fullscreen'), onclick: toggleFullscreen }, icon('full')),
      h('button', { class: 'icon-btn', id: 'btn-help', title: t('menu.help'), onclick: openHelp }, icon('help')));
    return h('header', { class: 'topbar' }, logo, h('div', { class: 'top-title', id: 'top-title' }), right);
  }

  function toggleFullscreen() {
    const d = document;
    if (d.fullscreenElement) d.exitFullscreen().catch(() => {});
    else (d.documentElement.requestFullscreen ? d.documentElement.requestFullscreen() : Promise.reject()).catch(() => toast(t('menu.fullscreen') + ' – not allowed here', 'warn'));
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
    const card = (ic, title, sub, fn, cls, id) => h('button', { class: 'action-card ' + (cls || ''), onclick: fn, id }, h('span', { class: 'ac-icon' }, icon(ic)), h('span', { class: 'ac-text' }, h('b', null, title), h('small', null, sub)));
    const actions = h('section', { class: 'actions' },
      card('play', t('home.quick'), t('home.quickSub'), quickGame, 'primary', 'act-quick'),
      card('dice', t('home.new'), t('home.newSub'), () => openNewGame('local'), '', 'act-new'),
      card('users', t('home.friends'), t('home.friendsSub'), () => openNewGame('online'), Net.available ? '' : 'disabled', 'act-friends'));
    const list = h('div', { class: 'games-list', id: 'games-list' });
    const games = h('section', { class: 'games' }, h('div', { class: 'section-head' }, h('h2', null, t('home.continue')), h('button', { class: 'link-btn', onclick: openHelp }, icon('help'), t('home.howto'))), list,
      h('p', { class: 'hint' }, Net.available ? t('home.invitesHint') : t('home.onlineUnavailable')));
    m.replaceChildren(h('div', { class: 'home-inner' }, hero, actions, games));
    fillGamesList();
    if (Net.available && onlineState !== 'loading') loadOnlineList();
  }

  function playerDots(seats) {
    return h('span', { class: 'dots' }, seats.map((s, c) => s ? h('span', { class: 'dot', style: { background: 'var(--p' + c + ')' }, title: colorName(c) + ': ' + seatName(s, c) }) : null));
  }

  function fillGamesList() {
    const list = document.getElementById('games-list');
    if (!list) return;
    const items = [];
    for (const g of localGames) {
      let st = null;
      try { st = R.replay(g.setup, g.actions); } catch (e) { continue; }
      const mineTurn = !st.over && st.seats[st.turn] && st.seats[st.turn].kind !== 'bot';
      items.push({
        when: g.updated, el: h('div', { class: 'game-card', tabindex: '0', onclick: () => openLocal(g.id), onkeydown: e => { if (e.key === 'Enter') openLocal(g.id); } },
          h('span', { class: 'gc-kind', title: t('home.local') }, icon('device')),
          h('span', { class: 'gc-main' }, h('b', null, g.title || t('home.new')), h('small', null, playerDots(st.seats), ' ', st.over ? t('home.finished') : (mineTurn ? t('home.yourTurn') : t('home.inProgress')), ' · ', UI.timeAgo(new Date(g.updated)))),
          h('button', { class: 'icon-btn small', title: t('home.delete'), onclick: async e => { e.stopPropagation(); if (await confirm(t('home.deleteLocal'), t('home.delete'), { danger: true })) { localGames = localGames.filter(x => x.id !== g.id); saveLocalGames(); fillGamesList(); } } }, icon('trash'))),
      });
    }
    if (onlineList) {
      for (const c of onlineList) {
        const when = c.latest && c.latest.creationTime ? parseLocal(c.latest.creationTime) : 0;
        const others = (c.members || []).filter(u => u !== ME);
        items.push({
          when, el: h('div', { class: 'game-card online', tabindex: '0', onclick: () => openOnline(c.chatId), onkeydown: e => { if (e.key === 'Enter') openOnline(c.chatId); } },
            h('span', { class: 'gc-kind', title: t('home.online') }, icon('users')),
            h('span', { class: 'gc-main' }, h('b', null, c.title || 'Ludo'), h('small', null, others.join(', ') || '—', when ? ' · ' + UI.timeAgo(new Date(when)) : '')),
            h('button', { class: 'icon-btn small', title: t('home.delete'), onclick: async e => { e.stopPropagation(); if (await confirm(t('home.deleteOnline'), t('home.delete'), { danger: true })) { await Net.remove(c.chatId).catch(() => false); onlineList = onlineList.filter(x => x.chatId !== c.chatId); fillGamesList(); } } }, icon('trash'))),
        });
      }
    }
    items.sort((a, b) => b.when - a.when);
    const kids = items.map(i => i.el);
    if (onlineState === 'loading') kids.push(h('div', { class: 'muted small pad' }, t('home.loadingOnline')));
    if (!kids.length) kids.push(h('div', { class: 'empty' }, t('home.noGames')));
    list.replaceChildren(...kids);
  }

  function parseLocal(s) { // "2026-10-20 14:03:05" (local time, from Peergos)
    const m = /^(\d+)-(\d+)-(\d+) (\d+):(\d+):(\d+)/.exec(String(s));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : 0;
  }

  async function loadOnlineList() {
    onlineState = 'loading';
    fillGamesList();
    try { onlineList = await Net.listGames(); onlineState = 'ok'; }
    catch (e) { console.warn('online list', e); onlineState = 'error'; }
    if (screen === 'home') fillGamesList();
  }

  // ───────────────────────────── new game dialog ─────────────────────────────
  function defaultSeats(mode) {
    if (mode === 'online') return [{ kind: 'me' }, { kind: 'empty' }, { kind: 'friend' }, { kind: 'empty' }];
    return [{ kind: 'me' }, { kind: 'bot', level: settings.level }, { kind: 'bot', level: settings.level }, { kind: 'bot', level: settings.level }];
  }

  function quickGame() {
    const seats = [{ kind: 'human', user: ME || 'me' }, { kind: 'bot', level: settings.level }, { kind: 'bot', level: settings.level }, { kind: 'bot', level: settings.level }];
    startLocal({ seats, rules: settings.rules, first: 0 }, t('home.quick'));
  }

  function openNewGame(mode) {
    if (mode === 'online' && !Net.available) { toast(t('home.onlineUnavailable'), 'warn'); return; }
    const last = mode === 'online' ? settings.lastOnline : settings.lastLocal;
    const seats = (last && Array.isArray(last.seats) && last.seats.length === 4 ? last.seats : defaultSeats(mode)).map(s => Object.assign({}, s));
    const rules = R.normalizeRules(last && last.rules ? last.rules : settings.rules);
    let first = last && last.first != null ? last.first : 'random';
    const kinds = mode === 'online' ? ['me', 'friend', 'bot', 'empty'] : ['me', 'bot', 'local', 'empty'];
    const kindLabel = k => t(k === 'me' ? 'new.seat.me' : k === 'bot' ? 'new.seat.bot' : k === 'local' ? 'new.seat.local' : k === 'friend' ? 'new.seat.friend' : 'new.seat.empty');
    const err = h('div', { class: 'form-error', role: 'alert' });
    const rows = h('div', { class: 'seats' });

    function remember() {
      const key = mode === 'online' ? 'lastOnline' : 'lastLocal';
      set({ [key]: { seats, rules, first } }, { quiet: true });
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
          h('span', { class: 'seat-color' }, h('span', { class: 'chip', style: { background: 'var(--p' + c + ')' } }), colorName(c)), seg, extra);
      }));
      validate();
    }
    const firstSel = h('div', { class: 'seg small' }, ['random', 0, 1, 2, 3].map(v => h('button', {
      class: 'seg-btn' + (first === v ? ' on' : ''), onclick: e => { first = v; [...firstSel.children].forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); remember(); },
    }, v === 'random' ? t('new.first.random') : h('span', { class: 'chip sm', style: { background: 'var(--p' + v + ')' }, title: colorName(v) }))));

    const rulesBox = rulesEditor(rules, () => remember());
    const startBtn = h('button', { class: 'btn primary big', onclick: go }, icon(mode === 'online' ? 'users' : 'play'), mode === 'online' ? t('new.invite') : t('new.start'));
    const d = dialog({
      title: mode === 'online' ? t('new.friendsTitle') : t('new.title'), icon: mode === 'online' ? 'users' : 'dice', cls: 'dlg-new',
      body: [h('h3', null, t('new.players')), rows, h('div', { class: 'first-row' }, h('span', null, t('new.first')), firstSel),
        mode === 'online' ? h('p', { class: 'hint' }, t('new.friendsHint')) : null,
        h('details', { class: 'rules-details' }, h('summary', null, t('new.rules')), rulesBox), err],
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
        startLocal({ seats: seatsOut, rules, first: f == null ? randomFirst(seatsOut) : f }, null);
      } else {
        startBtn.disabled = true;
        startBtn.lastChild.textContent = t('new.creating');
        try { await createOnline(seats, rules, f); d.close(); }
        catch (e) { console.error(e); toast(String(e.message || e), 'bad'); }
        finally { startBtn.disabled = false; startBtn.lastChild.textContent = t('new.invite'); }
      }
    }
  }

  function randomFirst(seats) {
    const a = seats.map((s, i) => s ? i : -1).filter(i => i >= 0);
    return a[rollDie() % a.length];
  }

  function rulesEditor(rules, onChange) {
    const row = (key, control) => h('div', { class: 'rule-row' }, h('span', null, t('rule.' + key)), control);
    const toggle = key => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: rules[key] ? true : null, onchange: e => { rules[key] = e.target.checked; onChange(); } }), h('span', { class: 'slider' }));
    const choice = (key, vals) => {
      const seg = h('div', { class: 'seg small' }, vals.map(v => h('button', { class: 'seg-btn' + (rules[key] === v ? ' on' : ''), onclick: e => { rules[key] = v; [...seg.children].forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); onChange(); } }, t('rule.' + key + '.' + v))));
      return seg;
    };
    return h('div', { class: 'rules' },
      row('enterOn', choice('enterOn', ['six', 'oneOrSix'])),
      row('sixBonus', toggle('sixBonus')), row('threeSixes', toggle('threeSixes')),
      row('captureBonus', toggle('captureBonus')), row('finishBonus', toggle('finishBonus')),
      row('safeSquares', toggle('safeSquares')), row('threeTries', toggle('threeTries')),
      row('endMode', choice('endMode', ['first', 'all'])));
  }

  async function createOnline(seats, rules, first) {
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
    const setup = P.msg('setup', { g: P.randomId(8), seats: out, rules, first: first == null ? randomFirst(out) : first }, VERSION);
    await Net.send(chatId, P.encode(setup));
    onlineList = null;
    await openOnline(chatId, { initial: [{ author: ME, text: P.encode(setup), type: 'Application' }] });
  }

  // ───────────────────────────── settings ─────────────────────────────
  function openSettings(section) {
    let sec = section || settings.settingsSection || 'look';
    const status = h('span', { class: 'save-state' });
    const showSave = s => {
      status.className = 'save-state ' + s;
      status.replaceChildren(s === 'saved' ? icon('check') : null, t(s === 'saved' ? 'set.saved' : s === 'saving' ? 'set.saving' : 'set.saveError'));
    };
    showSave(saveState);
    saveListeners.add(showSave);
    const tabs = h('nav', { class: 'set-tabs' });
    const pane = h('div', { class: 'set-pane' });
    const SECS = [['look', 'gear'], ['play', 'play'], ['sound', 'sound'], ['rules', 'flag'], ['about', 'help']];
    function draw() {
      tabs.replaceChildren(...SECS.map(([id, ic]) => h('button', { class: 'set-tab' + (sec === id ? ' on' : ''), onclick: () => { sec = id; set({ settingsSection: id }, { quiet: true }); draw(); } }, icon(ic), h('span', null, t('set.sec.' + id)))));
      pane.replaceChildren(...sectionBody(sec, draw));
    }
    const d = dialog({ title: t('set.title'), icon: 'gear', cls: 'dlg-settings', controls: status, body: h('div', { class: 'set-layout' }, tabs, pane), onClose: () => saveListeners.delete(showSave) });
    draw();
    return d;
  }

  function sectionBody(sec, redraw) {
    const field = (label, control, sub) => h('div', { class: 'field' }, h('div', { class: 'field-label' }, label, sub ? h('small', null, sub) : null), control);
    const toggle = (key, label) => h('label', { class: 'toggle-row' }, h('span', null, label), h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: settings[key] ? true : null, onchange: e => set({ [key]: e.target.checked }) }), h('span', { class: 'slider' })));
    const seg = (key, vals, label) => h('div', { class: 'seg' }, vals.map(v => h('button', { class: 'seg-btn' + (settings[key] === v ? ' on' : ''), onclick: () => { set({ [key]: v }); redraw(); } }, label(v))));
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
        field(t('set.anim'), seg('anim', ['slow', 'normal', 'fast', 'instant'], v => t('set.anim.' + v))),
        field(t('set.lang'), seg('lang', ['auto'].concat(Object.keys(I18n.LANGS)), v => v === 'auto' ? t('set.lang.auto') : I18n.LANGS[v].name)),
        toggle('showNotes', t('set.showNotes'))];
    }
    if (sec === 'play') {
      return [toggle('autoMove', t('set.autoMove')), toggle('autoRoll', t('set.autoRoll')), toggle('hints', t('set.hints')), toggle('confirmLeave', t('set.confirmLeave')),
        field(t('set.level'), seg('level', ['easy', 'normal', 'hard'], v => t('level.' + v)))];
    }
    if (sec === 'sound') {
      const vol = h('input', { type: 'range', min: '0', max: '100', step: '5', value: String(Math.round(settings.volume * 100)), class: 'range', oninput: e => set({ volume: e.target.value / 100 }, { quiet: true }), onchange: () => Sound.play('capture') });
      return [toggle('sound', t('set.sound')), field(t('set.volume'), h('div', { class: 'vol-row' }, vol, h('button', { class: 'btn small', onclick: () => Sound.play('win') }, icon('play'), t('set.test'))))];
    }
    if (sec === 'rules') {
      const rules = Object.assign({}, settings.rules);
      return [h('p', { class: 'hint' }, t('set.rulesHint')), rulesEditor(rules, () => set({ rules: R.normalizeRules(rules) }, { quiet: true }))];
    }
    return [h('div', { class: 'about' },
      h('div', { class: 'about-logo' }, h('span', { class: 'brand-name big' }, 'Ludo', h('b', null, '4'), 'Peergos'), h('div', { class: 'muted' }, t('set.version', { v: VERSION }))),
      h('p', null, S.PEERGOS ? t('set.dataInfo') : t('set.dataLocal')),
      h('p', { class: 'muted small' }, 'Fonts: Inter, Fredoka (SIL Open Font License).'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!(await confirm(t('set.resetConfirm'), t('set.reset'), { danger: true }))) return;
        const keep = { lastLocal: settings.lastLocal, lastOnline: settings.lastOnline };
        settings = Object.assign({}, DEFAULTS, keep, { rules: Object.assign({}, R.DEFAULT_RULES) });
        set({});
        if (root.UserNotesUI && root.UserNotesUI.clearPrefs) root.UserNotesUI.clearPrefs();
        redraw();
      } }, t('set.reset')))];
  }

  function openHelp() {
    dialog({ title: t('help.title'), icon: 'help', cls: 'dlg-help', body: h('div', { class: 'help', html: t('help.body') }) });
  }

  // ───────────────────────────── User notes ─────────────────────────────
  function openNotes() {
    if (!root.UserNotesUI) return;
    if (!notesUI) {
      const notesDoc = S.Doc('user-notes.json', 250);
      notesUI = root.UserNotesUI.create({
        title: t('menu.notes'), fontControl: true,
        toast: (text, kind) => toast(text, kind === 'error' ? 'bad' : kind),
        api: {
          get: async () => {
            let data = S.lsGet('userNotes', null);
            if (S.PEERGOS) { try { const r = await S.getJSON('user-notes.json'); if (r) data = r; } catch (e) { console.warn(e); } }
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
    notesUI.open();
  }

  // ───────────────────────────── game session ─────────────────────────────
  function startLocal(setup, title) {
    const g = { id: 'L' + Date.now().toString(36) + P.randomId(4), created: Date.now(), updated: Date.now(), title: title || defaultTitle(setup), setup, actions: [] };
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
    let state;
    try { state = R.replay(rec.setup, rec.actions); } catch (e) { toast(t('err.load'), 'bad'); return; }
    startSession({ mode: 'local', rec, setup: rec.setup, state });
  }

  async function openOnline(chatId, opts) {
    const host = P.chatOwner(chatId);
    startSession({ mode: 'online', chatId, host, entries: (opts && opts.initial) || [], next: 0, setup: null, state: null });
  }

  function leaveToHome() {
    if (game && !game.state.over && settings.confirmLeave && game.mode === 'local' && game.phase !== 'loading') {
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
    const m = main();
    m.className = 'screen game';
    const boardBox = h('div', { class: 'board' });
    const players = h('div', { class: 'players' });
    const dieEl = buildDie();
    const status = h('div', { class: 'status' });
    const hint = h('div', { class: 'status-hint' });
    const netState = h('div', { class: 'net-state' });
    const diceArea = h('div', { class: 'dice-area' }, h('button', { class: 'die-btn', id: 'die', 'aria-label': t('game.roll'), onclick: () => userRoll() }, dieEl.wrap), h('div', { class: 'status-box' }, status, hint, netState));
    const log = h('ol', { class: 'log', id: 'log' });
    const chatList = h('div', { class: 'chat-list' });
    const chatIn = h('input', { class: 'text-in', type: 'text', maxlength: '200', placeholder: t('game.say'), onkeydown: e => { if (e.key === 'Enter') sendSay(); } });
    const chatBox = h('div', { class: 'chat' }, chatList, h('div', { class: 'chat-input' }, chatIn, h('button', { class: 'icon-btn', title: t('game.send'), onclick: sendSay }, icon('send'))));
    let tab = sess.mode === 'online' ? 'chat' : 'log';
    const tabsEl = h('div', { class: 'side-tabs' });
    const tabBody = h('div', { class: 'side-tab-body' });
    const actionsEl = h('div', { class: 'game-actions' });
    const side = h('aside', { class: 'side' }, players, diceArea, tabsEl, tabBody, actionsEl);
    m.replaceChildren(h('div', { class: 'game-layout' }, h('div', { class: 'board-wrap' }, boardBox), side));

    const board = Board.create(boardBox, { onToken: (c, i) => userPick(c, i) });
    const self = {
      mode: sess.mode, sess, phase: 'loading', state: null, shownN: -1, roll: null, legal: [],
      busy: false, stopped: false, pollTimer: null, outbox: null, joined: new Set(), invited: new Set(),
      logItems: [], winnerShown: false, lastSync: 0, unknown: 0,
      stop, refresh,
    };
    Object.defineProperty(self, 'state', { get: () => self._state, set: v => { self._state = v; } });

    function stop() {
      self.stopped = true;
      clearTimeout(self.pollTimer);
      document.removeEventListener('visibilitychange', onVis);
    }
    function onVis() { if (!document.hidden && self.mode === 'online') schedulePoll(50); }
    document.addEventListener('visibilitychange', onVis);

    // ── who controls a seat on this device
    function controlOf(state, c) {
      const seat = state.seats[c];
      if (!seat) return 'none';
      if (self.mode === 'local') return seat.kind === 'bot' ? 'bot' : 'me';
      const ctrl = self.replay.controller(c, state.n);
      if (ctrl !== ME) return 'remote';
      return seat.kind === 'bot' || (self.replay.resignedAt[c] != null && state.n >= self.replay.resignedAt[c]) ? 'bot' : 'me';
    }
    function nameOf(c) {
      const seat = self.state.seats[c];
      if (self.mode === 'online' && seat && seat.kind === 'human' && self.replay && self.replay.resignedAt[c] != null) return seatName(seat, c) + ' (' + t('game.computer') + ')';
      return seatName(seat, c);
    }

    // ── panel
    function drawPlayers() {
      const st = self.state;
      if (!st) { players.replaceChildren(); return; }
      players.replaceChildren(...[0, 1, 2, 3].filter(c => st.seats[c]).map(c => {
        const seat = st.seats[c];
        const place = st.finished.indexOf(c);
        const badges = [];
        if (self.mode === 'online') {
          if (seat.kind === 'human' && seat.user === self.sess.host) badges.push(h('span', { class: 'badge' }, t('game.host')));
          if (seat.kind === 'human' && seat.user !== ME && seat.user !== self.sess.host && !self.joined.has(seat.user)) badges.push(h('span', { class: 'badge warn', title: t('game.notJoined', { name: seat.user }) }, t('game.invited')));
        }
        if (seat.kind === 'bot') badges.push(h('span', { class: 'badge' }, icon('cpu')));
        const pct = Math.round(R.progress(st, c) * 100);
        return h('div', { class: 'player' + (st.turn === c && !st.over ? ' active' : '') + (place >= 0 ? ' done' : ''), style: { '--c': 'var(--p' + c + ')' } },
          h('span', { class: 'pl-token' }),
          h('span', { class: 'pl-main' }, h('span', { class: 'pl-name' }, nameOf(c), ...badges), h('span', { class: 'pl-bar' }, h('i', { style: { width: pct + '%' } }))),
          h('span', { class: 'pl-side' }, place >= 0 ? h('span', { class: 'medal m' + (place + 1) }, String(place + 1)) : h('span', { class: 'pl-home', title: 'home' }, st.tokens[c].filter(p => p === R.FINISH).length + '/4')));
      }));
    }
    function drawTabs() {
      const tabsList = [['log', t('game.log')]];
      if (self.mode === 'online') tabsList.unshift(['chat', t('game.chat')]);
      tabsEl.replaceChildren(...tabsList.map(([id, label]) => h('button', { class: 'side-tab' + (tab === id ? ' on' : ''), onclick: () => { tab = id; drawTabs(); } }, label)));
      tabBody.replaceChildren(tab === 'chat' ? chatBox : log);
      if (tab === 'log') log.scrollTop = log.scrollHeight;
    }
    function drawActions() {
      const btns = [];
      if (self.mode === 'online' && self.state && !self.state.over) {
        const mine = self.state.seats.findIndex(s => s && s.kind === 'human' && s.user === ME);
        if (mine >= 0 && self.replay.resignedAt[mine] == null) btns.push(h('button', { class: 'btn small ghost', onclick: resign }, icon('flag'), t('game.resign')));
      }
      if (self.state && self.state.over) btns.push(h('button', { class: 'btn small', onclick: showWinner }, icon('trophy'), t('game.over')));
      btns.push(h('button', { class: 'btn small ghost', onclick: () => leaveToHome() }, icon('home'), t('game.backHome')));
      actionsEl.replaceChildren(...btns);
    }
    function addLog(text, color) {
      self.logItems.push({ text, color });
      if (self.logItems.length > 300) self.logItems.shift();
      log.appendChild(h('li', { style: color != null ? { '--c': 'var(--p' + color + ')' } : null }, text));
      while (log.children.length > 300) log.firstChild.remove();
      log.scrollTop = log.scrollHeight;
    }
    function drawChat() {
      const says = (self.replay && self.replay.says) || [];
      chatList.replaceChildren(...says.slice(-100).map(s => {
        const c = self.state ? self.state.seats.findIndex(x => x && x.user === s.author) : -1;
        return h('div', { class: 'say' + (s.author === ME ? ' me' : ''), style: c >= 0 ? { '--c': 'var(--p' + c + ')' } : null }, h('b', null, s.author === ME ? t('common.you') : s.author), h('span', null, s.text));
      }));
      chatList.scrollTop = chatList.scrollHeight;
    }
    function refresh() {
      drawPlayers(); drawTabs(); drawActions(); updateStatus();
      document.getElementById('top-title').textContent = self.mode === 'online' ? (self.sess.title || 'Online') : (self.sess.rec ? self.sess.rec.title : '');
      diceArea.querySelector('.die-btn').setAttribute('aria-label', t('game.roll'));
      chatIn.placeholder = t('game.say');
    }

    function updateStatus() {
      const st = self.state;
      hint.textContent = '';
      dieEl.wrap.classList.toggle('ready', self.phase === 'roll');
      diceArea.classList.toggle('my-turn', self.phase === 'roll' || self.phase === 'pick');
      if (!st) { status.textContent = '…'; return; }
      const c = st.turn;
      diceArea.style.setProperty('--c', 'var(--p' + c + ')');
      if (st.over) { status.textContent = st.winner != null ? (st.seats[st.winner].user === ME && self.mode !== 'local' || (self.mode === 'local' && st.seats[st.winner].kind === 'human') ? t('game.youWin') : t('game.wins', { name: nameOf(st.winner) })) : t('game.over'); return; }
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
      } else {
        status.textContent = t('game.turnOf', { name: nameOf(c) });
      }
    }

    // ── state changes
    function eventsToLog(action, events, by) {
      const c = by;
      for (const ev of events) {
        if (ev.type === 'move') addLog(t('game.rolled', { name: nameOf(c), roll: action.r }) + ' → ' + (ev.from < 0 ? '⬆' : '') + ' #' + (ev.token + 1), c);
        else if (ev.type === 'pass') addLog(t('game.rolled', { name: nameOf(c), roll: action.r }) + ' – ' + t('game.noMove').toLowerCase(), c);
        else if (ev.type === 'threeSixes') addLog(t('game.threeSixes'), c);
        else if (ev.type === 'capture') addLog(t('game.captured', { a: nameOf(ev.color), b: nameOf(ev.victim) }), ev.color);
        else if (ev.type === 'finished') addLog(t('game.finished', { name: nameOf(ev.color), place: ev.place }), ev.color);
      }
    }

    async function showAction(prev, action, res, by) {
      const sp = speed();
      dieEl.show(action.r, by);
      eventsToLog(action, res.events, by);
      const hooks = {
        step: () => Sound.play('step'),
        capture: ev => { Sound.play('capture'); toast(t('game.captured', { a: nameOf(ev.color), b: nameOf(ev.victim) }), 'info', 1800); },
        home: () => Sound.play('home'),
      };
      if (res.events.some(e => e.type === 'move' && e.from === -1)) Sound.play('enter');
      await board.animate(res.state, res.events, sp.step, hooks);
      for (const ev of res.events) {
        if (ev.type === 'pass' || ev.type === 'threeSixes') Sound.play('nomove');
        if (ev.type === 'finished') toast(t('game.finished', { name: nameOf(ev.color), place: ev.place }), 'ok');
      }
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
      if (self.mode === 'local') {
        self.sess.rec.actions.push(action);
        self.sess.rec.updated = Date.now();
        saveLocalGames();
        self.state = res.state;
      } else {
        const msg = P.msg('move', { g: self.replay.setup.g, n: prev.n, c: by, r: action.r, t: action.t }, VERSION);
        const text = P.encode(msg);
        self.sess.entries.push({ author: ME, text, type: 'Application', local: true });
        self.outbox.push(text);
        self.replay = P.replay(self.sess.entries, self.sess.host);
        self.state = self.replay.state;
      }
      self.shownN = res.state.n;
      await showAction(prev, action, res, by);
      self.busy = false;
      afterChange();
    }

    function afterChange() {
      if (self.stopped) return;
      self.lastChange = Date.now();
      drawPlayers(); drawActions(); drawChat();
      next();
    }

    let nextTimer = null;
    function next() {
      clearTimeout(nextTimer);
      const st = self.state;
      if (!st || self.busy) return;
      if (st.over) {
        self.phase = 'over';
        updateStatus(); drawActions();
        if (!self.winnerShown) { self.winnerShown = true; setTimeout(showWinner, 500); }
        return;
      }
      const ctl = controlOf(st, st.turn);
      if (ctl === 'me') {
        if (self.phase !== 'roll') { self.phase = 'roll'; Sound.play('turn'); }
        updateStatus();
        if (settings.autoRoll) nextTimer = setTimeout(() => userRoll(), speed().think);
      } else if (ctl === 'bot') {
        self.phase = 'bot';
        updateStatus();
        nextTimer = setTimeout(botTurn, speed().think);
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
      await dieEl.roll(r, st.turn, speed().dice);
      self.busy = false;
      if (self.stopped || self.state !== st) return;
      const tk = AI.choose(st, r, st.seats[st.turn].level || 'normal');
      await commit({ r, t: tk });
    }

    async function userRoll() {
      if (self.phase !== 'roll' || self.busy) return;
      Sound.unlock();
      const st = self.state;
      const r = rollDie();
      self.busy = true;
      self.phase = 'rolling';
      updateStatus();
      await dieEl.roll(r, st.turn, speed().dice);
      self.busy = false;
      if (self.stopped || self.state !== st) return;
      const legal = R.legalMoves(st, r);
      self.roll = r; self.legal = legal;
      if (!legal.length) {
        status.textContent = R.isThirdSix(st, r) ? t('game.threeSixes') : t('game.noMove');
        hint.textContent = '';
        await sleep(speed().pause);
        return commit({ r, t: -1 });
      }
      const distinct = new Set(legal.map(i => st.tokens[st.turn][i]));
      if (settings.autoMove && (legal.length === 1 || distinct.size === 1)) {
        await sleep(Math.min(250, speed().pause));
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
        // clicking a token stacked with a movable one: pick the movable one on the same square
        const p = self.state.tokens[c][i];
        const alt = self.legal.find(j => self.state.tokens[c][j] === p);
        if (alt == null) return;
        i = alt;
      }
      commit({ r: self.roll, t: i });
    }

    self.onSettings = patch => {
      if (patch.autoRoll && self.phase === 'roll' && !self.busy) { clearTimeout(nextTimer); nextTimer = setTimeout(() => userRoll(), speed().think); }
      if ('hints' in patch && self.phase === 'pick') board.setMovable(self.state.turn, self.legal, settings.hints);
    };

    // keyboard
    self.key = e => {
      if (self.stopped) return;
      if (e.key === ' ' || e.key === 'Enter') { if (self.phase === 'roll') { e.preventDefault(); userRoll(); } }
      else if (/^[1-4]$/.test(e.key) && self.phase === 'pick') { const i = +e.key - 1; if (self.legal.indexOf(i) >= 0) commit({ r: self.roll, t: i }); }
    };

    // ── online sync
    async function poll() {
      if (self.stopped) return;
      if (document.hidden) { schedulePoll(4000); return; }
      try {
        const res = await Net.read(self.sess.chatId, self.sess.next);
        self.sess.next = res.next;
        let fresh = 0;
        for (const e of res.entries) {
          if (e.type === 'Join' && e.joinUsername) self.joined.add(e.joinUsername);
          if (e.type === 'Invite' && e.inviteUsername) self.invited.add(e.inviteUsername);
          if (e.type === 'Application' && e.text) { self.sess.entries.push(e); fresh++; }
        }
        netState.textContent = self.outbox && self.outbox.size ? t('game.sending') : '';
        netState.className = 'net-state';
        if (fresh || !self.replay) await integrate();
        else { drawPlayers(); if (self.phase === 'wait') updateStatus(); }
      } catch (e) {
        console.warn('poll', e);
        netState.textContent = t('game.offline');
        netState.className = 'net-state bad';
      }
      schedulePoll(POLL_MS || settings.pollMs || (self.phase === 'wait' ? (Date.now() - self.lastChange < 60000 ? 1500 : 3000) : 5000));
    }
    function schedulePoll(ms) { clearTimeout(self.pollTimer); if (!self.stopped) self.pollTimer = setTimeout(poll, ms); }

    async function integrate() {
      const rep = P.replay(self.sess.entries, self.sess.host);
      if (!rep.setup) {
        self.replay = rep;
        self.phase = 'loading';
        status.textContent = t('game.waitingFor', { name: self.sess.host });
        return;
      }
      if (rep.unknown && !self.unknown) { self.unknown = rep.unknown; toast(t('game.newProtocol'), 'warn', 8000); }
      const newGame = !self.replay || !self.replay.setup || self.replay.setup.g !== rep.setup.g;
      const prevShown = self.shownN;
      self.replay = rep;
      if (newGame) {
        if (self.winnerDlg) self.winnerDlg.close();
        self.state = rep.state;
        self.shownN = rep.state.n;
        self.winnerShown = rep.state.over;
        log.replaceChildren(); self.logItems = [];
        for (const item of rep.history.slice(-60)) eventsToLog(item.action, item.events, item.c);
        board.render(rep.state);
        if (rep.state.last) board.showTrail(rep.state.last.color, []);
        if (rep.state.last && rep.state.last.roll) dieEl.show(rep.state.last.roll, rep.state.last.color);
        afterChange();
        return;
      }
      if (self.busy) return; // the running animation picks it up in afterChange
      const pending = rep.history.filter(x => x.n >= prevShown);
      if (!pending.length) { self.state = rep.state; drawChat(); drawPlayers(); return; }
      if (pending.length > 6) { // too many to animate: jump
        self.state = rep.state; self.shownN = rep.state.n;
        for (const item of pending) eventsToLog(item.action, item.events, item.c);
        board.render(rep.state);
        afterChange();
        return;
      }
      self.busy = true;
      board.setMovable(-1, []);
      let st = self.state;
      for (const item of pending) {
        if (self.stopped) return;
        const res = R.apply(st, item.action);
        const by = st.turn;
        self.state = res.state;
        self.shownN = res.state.n;
        await sleep(item === pending[0] ? 0 : speed().think / 2);
        await dieEl.roll(item.action.r, by, speed().dice);
        await showAction(st, item.action, res, by);
        st = res.state;
      }
      self.state = rep.state;
      self.busy = false;
      afterChange();
    }

    function sendSay() {
      const text = chatIn.value.trim();
      if (!text || self.mode !== 'online' || !self.replay || !self.replay.setup) return;
      chatIn.value = '';
      const msgText = P.encode(P.msg('say', { g: self.replay.setup.g, text }, VERSION));
      self.sess.entries.push({ author: ME, text: msgText, type: 'Application', local: true });
      self.outbox.push(msgText);
      self.replay = P.replay(self.sess.entries, self.sess.host);
      drawChat();
    }

    async function resign() {
      if (!(await confirm(t('game.resignConfirm'), t('game.resign')))) return;
      const mine = self.state.seats.findIndex(s => s && s.kind === 'human' && s.user === ME);
      const text = P.encode(P.msg('resign', { g: self.replay.setup.g, c: mine, after: self.state.n }, VERSION));
      self.sess.entries.push({ author: ME, text, type: 'Application', local: true });
      self.outbox.push(text);
      self.replay = P.replay(self.sess.entries, self.sess.host);
      board.setMovable(-1, []);
      self.phase = 'wait';
      afterChange();
    }

    // ── winner
    function showWinner() {
      const st = self.state;
      if (!st || !st.over) return;
      Sound.play('win');
      const order = st.finished.concat([0, 1, 2, 3].filter(c => st.seats[c] && st.finished.indexOf(c) < 0).sort((a, b) => R.progress(st, b) - R.progress(st, a)));
      const iWon = self.mode === 'online' ? st.seats[st.winner].user === ME : st.seats[st.winner].kind !== 'bot';
      const canRematch = self.mode === 'local' || self.sess.host === ME;
      if (self.winnerDlg) self.winnerDlg.close();
      const d = self.winnerDlg = dialog({
        title: t('game.over'), icon: 'trophy', cls: 'dlg-winner', onClose: () => { if (self.winnerDlg === d) self.winnerDlg = null; },
        body: [h('div', { class: 'winner-hero', style: { '--c': 'var(--p' + st.winner + ')' } }, h('div', { class: 'winner-token' }), h('h2', null, iWon && st.seats[st.winner].kind !== 'local' ? t('game.youWin') : t('game.wins', { name: nameOf(st.winner) }))),
          h('ol', { class: 'ranking' }, order.map((c, k) => h('li', { style: { '--c': 'var(--p' + c + ')' } }, h('span', { class: 'medal m' + (k + 1) }, String(k + 1)), h('span', { class: 'chip', style: { background: 'var(--p' + c + ')' } }), nameOf(c)))),
          canRematch ? null : h('p', { class: 'hint center' }, t('game.rematchHost', { name: self.sess.host }))],
        footer: [h('button', { class: 'btn', onclick: () => { d.close(); leaveToHome(); } }, icon('home'), t('game.backHome')),
          canRematch ? h('button', { class: 'btn primary', onclick: () => { d.close(); rematch(); } }, icon('play'), t('game.rematch')) : null],
      });
      if (iWon) confetti();
    }
    async function rematch() {
      if (self.mode === 'local') {
        const s = self.sess.rec.setup;
        startLocal({ seats: s.seats, rules: s.rules, first: randomFirst(s.seats) }, self.sess.rec.title);
      } else {
        const s = self.replay.setup;
        const setup = P.msg('setup', { g: P.randomId(8), seats: s.seats, rules: s.rules, first: randomFirst(s.seats) }, VERSION);
        const text = P.encode(setup);
        self.sess.entries.push({ author: ME, text, type: 'Application', local: true });
        self.outbox.push(text);
        self.replay = null;
        await integrate();
      }
    }

    // ── start
    drawTabs(); drawActions();
    if (sess.mode === 'local') {
      self.state = sess.state;
      self.shownN = sess.state.n;
      self.winnerShown = sess.state.over;
      board.render(sess.state);
      // rebuild the move list of a resumed game (the last 60 actions)
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
          if (c) { sess.title = c.title; document.getElementById('top-title').textContent = c.title; (c.members || []).forEach(u => self.invited.add(u)); }
        } catch (e) { /* title is optional */ }
      })();
      // initial load: read everything, then keep polling
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
    if (settings.anim === 'instant') return;
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
    if (S.PEERGOS) { loadRemoteSettings(); loadRemoteGames(); }
    root.addEventListener('beforeunload', () => { settingsDoc.flushNow(); gamesDoc.flushNow(); });
  }

  L.App = { boot, settings: () => settings, set, THEMES, get game() { return game; }, openSettings, openNotes, renderHome };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
