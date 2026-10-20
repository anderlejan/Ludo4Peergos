/* Unit tests for the pure modules: node tests/unit.test.js */
'use strict';
const assert = require('assert');
const path = require('path');
const R = require(path.join(__dirname, '../assets/js/rules.js'));
const AI = require(path.join(__dirname, '../assets/js/ai.js'));
const P = require(path.join(__dirname, '../assets/js/protocol.js'));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error('FAIL ' + name + '\n', e); process.exitCode = 1; }
}
function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const bot = (level) => ({ kind: 'bot', level, name: level });
const four = () => ({ seats: [bot('hard'), bot('normal'), bot('easy'), bot('normal')] });

test('geometry: 52 distinct track cells, neighbours adjacent', () => {
  assert.strictEqual(R.TRACK.length, 52);
  assert.strictEqual(new Set(R.TRACK.map(x => x.join(','))).size, 52);
  for (let i = 0; i < 52; i++) {
    const [a, b] = R.TRACK[i], [c, d] = R.TRACK[(i + 1) % 52];
    const dist = Math.abs(a - c) + Math.abs(b - d);
    assert.ok(dist === 1 || (dist === 2 && Math.abs(a - c) === 1), 'step ' + i + ' ' + R.TRACK[i] + '→' + R.TRACK[(i + 1) % 52]);
  }
  for (let c = 0; c < 4; c++) {
    // the last track square of each colour is next to the first square of its home column
    const [x, y] = R.TRACK[R.trackIndex(c, R.LAST_TRACK)], [hx, hy] = R.HOME_COL[c][0];
    assert.strictEqual(Math.abs(x - hx) + Math.abs(y - hy), 1, 'home entry colour ' + c);
    // home column ends next to the centre
    const [ex, ey] = R.HOME_COL[c][4];
    assert.ok(ex >= 5 && ex <= 9 && ey >= 5 && ey <= 9);
  }
  // no track cell inside a yard or the centre
  for (const [x, y] of R.TRACK) assert.ok(!(x >= 6 && x <= 8 && y >= 6 && y <= 8));
});

test('entering needs a 6 (or 1 with the option)', () => {
  const s = R.newGame(four());
  assert.deepStrictEqual(R.legalMoves(s, 3), []);
  assert.deepStrictEqual(R.legalMoves(s, 6), [0, 1, 2, 3]);
  const s2 = R.newGame(Object.assign(four(), { rules: { enterOn: 'oneOrSix' } }));
  assert.deepStrictEqual(R.legalMoves(s2, 1), [0, 1, 2, 3]);
});

test('three tries while no token is out, then the turn passes', () => {
  let s = R.newGame(four());
  s = R.apply(s, { r: 2, t: -1 }).state; assert.strictEqual(s.turn, 0);
  s = R.apply(s, { r: 2, t: -1 }).state; assert.strictEqual(s.turn, 0);
  s = R.apply(s, { r: 2, t: -1 }).state; assert.strictEqual(s.turn, 1);
  const s2 = R.apply(R.newGame(Object.assign(four(), { rules: { threeTries: false } })), { r: 2, t: -1 }).state;
  assert.strictEqual(s2.turn, 1);
});

test('six gives another roll, third six forfeits', () => {
  let s = R.newGame(four());
  s = R.apply(s, { r: 6, t: 0 }).state; assert.strictEqual(s.turn, 0); assert.strictEqual(s.tokens[0][0], 0);
  s = R.apply(s, { r: 6, t: 0 }).state; assert.strictEqual(s.turn, 0); assert.strictEqual(s.tokens[0][0], 6);
  assert.deepStrictEqual(R.legalMoves(s, 6), []);
  const res = R.apply(s, { r: 6, t: -1 });
  assert.ok(res.events.some(e => e.type === 'threeSixes'));
  assert.strictEqual(res.state.turn, 1); assert.strictEqual(res.state.tokens[0][0], 6);
  assert.throws(() => R.apply(s, { r: 6, t: 0 }));
});

test('capture sends home and gives a bonus roll; safe squares protect', () => {
  let s = R.newGame(four());
  // Green token at relative 0 = track 13 (its start, safe). Put a green token at track 10 (relative 49).
  s.tokens[1][0] = 49; // track (13+49)%52 = 10
  s.tokens[0][0] = 7;  // red at track 7
  const res = R.apply(s, { r: 3, t: 0 });
  assert.strictEqual(res.state.tokens[1][0], -1);
  assert.ok(res.events.some(e => e.type === 'capture'));
  assert.strictEqual(res.state.turn, 0, 'capture bonus');
  // On a star (track 8) nothing is captured
  let s2 = R.newGame(four());
  s2.tokens[1][0] = 47; // (13+47)%52 = 8 = star
  s2.tokens[0][0] = 5;
  const r2 = R.apply(s2, { r: 3, t: 0 });
  assert.strictEqual(r2.state.tokens[1][0], 47);
  assert.strictEqual(r2.state.turn, 1);
});

test('exact roll needed for home; finishing and winning', () => {
  let s = R.newGame({ seats: [bot('normal'), null, bot('normal'), null] });
  s.tokens[0] = [56, 56, 56, 53];
  assert.deepStrictEqual(R.legalMoves(s, 4), []);
  const res = R.apply(s, { r: 3, t: 3 });
  assert.ok(res.state.over); assert.strictEqual(res.state.winner, 0);
  assert.ok(res.events.some(e => e.type === 'over'));
  assert.throws(() => R.apply(res.state, { r: 1, t: -1 }));
});

test('endMode all plays on for places', () => {
  let s = R.newGame({ seats: [bot('normal'), bot('normal'), bot('normal'), null], rules: { endMode: 'all' } });
  s.tokens[0] = [56, 56, 56, 55];
  s = R.apply(s, { r: 1, t: 3 }).state;
  assert.ok(!s.over); assert.deepStrictEqual(s.finished, [0]); assert.strictEqual(s.turn, 1);
  s.tokens[1] = [56, 56, 56, 55];
  s = R.apply(s, { r: 1, t: 3 }).state;
  assert.ok(s.over); assert.deepStrictEqual(s.finished, [0, 1, 2]);
});

test('skips empty seats and finished colours', () => {
  const s = R.newGame({ seats: [bot('easy'), null, bot('easy'), null] });
  const r = R.apply(s, { r: 2, t: -1 }); // tries
  assert.strictEqual(R.nextColor(s, 0), 2);
  assert.strictEqual(R.nextColor(s, 2), 0);
});

test('a game needs two players', () => {
  assert.throws(() => R.newGame({ seats: [bot('easy'), null, null, null] }));
});

test('1000 full bot games finish with consistent states (all levels)', () => {
  const rnd = rng(12345);
  let total = 0;
  const wins = { easy: 0, normal: 0, hard: 0 };
  for (let g = 0; g < 1000; g++) {
    const levels = ['easy', 'normal', 'hard', 'normal'];
    const seats = g % 3 === 0 ? [bot(levels[0]), null, bot(levels[2]), null] : levels.map(bot);
    if (g % 3 === 1) seats[3] = null;
    let s = R.newGame({ seats, rules: { endMode: g % 2 ? 'all' : 'first' }, first: g % 4 });
    let steps = 0;
    while (!s.over) {
      const r = 1 + Math.floor(rnd() * 6);
      const t = AI.choose(s, r, s.seats[s.turn].level, rnd);
      const res = R.apply(s, { r, t });
      s = res.state;
      // invariants
      for (let c = 0; c < 4; c++) for (const p of s.tokens[c]) assert.ok(p >= -1 && p <= 56);
      if (++steps > 5000) throw new Error('game did not finish');
    }
    total += steps;
    wins[s.seats[s.winner].level]++;
  }
  console.log('  avg actions per game: ' + (total / 1000).toFixed(0) + ', wins by level: ' + JSON.stringify(wins));
});

test('hard beats easy clearly in head-to-head games', () => {
  const rnd = rng(777);
  let hard = 0;
  const N = 600;
  for (let g = 0; g < N; g++) {
    const seats = g % 2 ? [bot('hard'), null, bot('easy'), null] : [bot('easy'), null, bot('hard'), null];
    let s = R.newGame({ seats, first: g % 4 < 2 ? 0 : 2 });
    while (!s.over) { const r = 1 + Math.floor(rnd() * 6); s = R.apply(s, { r, t: AI.choose(s, r, s.seats[s.turn].level, rnd) }).state; }
    if (s.seats[s.winner].level === 'hard') hard++;
  }
  console.log('  hard vs easy: hard won ' + hard + '/' + N);
  assert.ok(hard / N > 0.6, 'hard should win clearly more often');
});

test('AI always captures when it can and safely', () => {
  const s = R.newGame(four());
  s.tokens[0] = [7, -1, -1, -1];
  s.tokens[1][0] = 49; // track 10
  assert.strictEqual(AI.choose(s, 3, 'normal', rng(1)), 0);
});

test('protocol: encode/decode round trip with unicode', () => {
  const m = P.msg('say', { text: 'Ahoj 👋 žluťoučký kůň' }, '0.1.0');
  const text = P.encode(m);
  assert.ok(text.startsWith('L4P1 '));
  assert.deepStrictEqual(P.decode(text), m);
  assert.strictEqual(P.decode('hello'), null);
  assert.strictEqual(P.decode('L4P1 !!!'), null);
  assert.strictEqual(P.chatOwner('chat-ludo4peergos$alice$1234-ab'), 'alice');
});

function onlineGame(seed, opts) {
  // alice hosts, bob is a friend, seat 2 is a bot run by alice
  const rnd = rng(seed);
  const setup = P.msg('setup', { g: 'G1', seats: [{ kind: 'human', user: 'alice' }, null, { kind: 'human', user: 'bob' }, { kind: 'bot', level: 'normal' }], rules: {}, first: 0 });
  const entries = [{ author: 'alice', text: P.encode(setup) }];
  let s = R.newGame(setup);
  const ctrl = c => s.seats[c].kind === 'bot' ? 'alice' : s.seats[c].user;
  while (!s.over && s.n < (opts && opts.limit || 1e9)) {
    const r = 1 + Math.floor(rnd() * 6);
    const t = AI.choose(s, r, 'normal', rnd);
    const m = P.msg('move', { g: 'G1', n: s.n, c: s.turn, r, t });
    entries.push({ author: ctrl(s.turn), text: P.encode(m) });
    s = R.apply(s, { r, t }).state;
  }
  return { entries, final: s, setup };
}

test('protocol: replay reproduces the game; order between authors does not matter', () => {
  const { entries, final } = onlineGame(99);
  const rep = P.replay(entries, 'alice');
  assert.deepStrictEqual(rep.state.tokens, final.tokens);
  assert.strictEqual(rep.state.over, true);
  // Shuffle across authors but keep each author's own order (that is what Peergos guarantees)
  const rnd = rng(5);
  const byAuthor = { alice: entries.filter(e => e.author === 'alice'), bob: entries.filter(e => e.author === 'bob') };
  for (let k = 0; k < 20; k++) {
    const qa = byAuthor.alice.slice(), qb = byAuthor.bob.slice(), mixed = [];
    while (qa.length || qb.length) {
      if (!qb.length || (qa.length && rnd() < 0.5)) mixed.push(qa.shift()); else mixed.push(qb.shift());
    }
    const r2 = P.replay(mixed, 'alice');
    assert.deepStrictEqual(r2.state.tokens, final.tokens);
    assert.strictEqual(r2.state.n, final.n);
  }
});

test('protocol: forged and duplicate moves are ignored', () => {
  const { entries, final } = onlineGame(7, { limit: 40 });
  const forged = entries.slice();
  // bob tries to move for alice at the current move number, eve posts garbage, a duplicate is re-sent
  forged.splice(3, 0, { author: 'bob', text: P.encode(P.msg('move', { g: 'G1', n: 1, c: 0, r: 6, t: 0 })) });
  forged.push({ author: 'eve', text: 'not a game message' });
  forged.push(entries[5]);
  const rep = P.replay(forged, 'alice');
  assert.deepStrictEqual(rep.state.tokens, final.tokens);
  assert.strictEqual(rep.state.n, final.n);
  // a setup from someone other than the host is ignored
  const hijack = entries.concat([{ author: 'bob', text: P.encode(P.msg('setup', { g: 'G2', seats: [{ kind: 'human', user: 'bob' }, { kind: 'human', user: 'alice' }, null, null] })) }]);
  assert.strictEqual(P.replay(hijack, 'alice').setup.g, 'G1');
});

test('protocol: resign hands the seat to the host computer from the given move', () => {
  const setup = P.msg('setup', { g: 'G', seats: [{ kind: 'human', user: 'alice' }, { kind: 'human', user: 'bob' }, null, null], first: 0 });
  const e = [{ author: 'alice', text: P.encode(setup) }];
  e.push({ author: 'alice', text: P.encode(P.msg('move', { g: 'G', n: 0, c: 0, r: 2, t: -1 })) });
  e.push({ author: 'alice', text: P.encode(P.msg('move', { g: 'G', n: 1, c: 0, r: 2, t: -1 })) });
  e.push({ author: 'alice', text: P.encode(P.msg('move', { g: 'G', n: 2, c: 0, r: 2, t: -1 })) });
  e.push({ author: 'bob', text: P.encode(P.msg('resign', { g: 'G', c: 1, after: 3 })) });
  // the host plays bob's seat from move 3 on
  e.push({ author: 'alice', text: P.encode(P.msg('move', { g: 'G', n: 3, c: 1, r: 1, t: -1 })) });
  const rep = P.replay(e, 'alice');
  assert.strictEqual(rep.state.n, 4);
  // without the resign the host's move for bob is not accepted
  const rep2 = P.replay(e.filter((x, i) => i !== 4), 'alice');
  assert.strictEqual(rep2.state.n, 3);
});

test('protocol: a newer setup from the host starts a new game (rematch)', () => {
  const { entries } = onlineGame(3, { limit: 10 });
  const s2 = P.msg('setup', { g: 'G2', seats: [{ kind: 'human', user: 'alice' }, null, { kind: 'human', user: 'bob' }, null], first: 2 });
  const rep = P.replay(entries.concat([{ author: 'alice', text: P.encode(s2) }]), 'alice');
  assert.strictEqual(rep.setup.g, 'G2'); assert.strictEqual(rep.state.n, 0); assert.strictEqual(rep.state.turn, 2);
});

console.log((process.exitCode ? 'FAILED' : 'OK') + ' – ' + passed + ' tests passed');
