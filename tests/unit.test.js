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
// 0.7.0: the hard computer looks ahead (~1 ms a move), so long bulk runs use it in every 5th game only
const hardSome = k => bot(k % 5 ? 'normal' : 'hard');

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

test('300 full bot games finish with consistent states (all levels)', () => {
  const rnd = rng(12345);
  let total = 0;
  const wins = { easy: 0, normal: 0, hard: 0 };
  for (let g = 0; g < 300; g++) {
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
  console.log('  avg actions per game: ' + (total / 300).toFixed(0) + ', wins by level: ' + JSON.stringify(wins));
});

test('hard beats easy clearly in head-to-head games', () => {
  const rnd = rng(777);
  let hard = 0;
  const N = 300;
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

test('rule selfKick: landing on your own token sends it to the yard (also entering on your start)', () => {
  let s = R.newGame(Object.assign(four(), { rules: { selfKick: true } }));
  s.tokens[0] = [0, -1, -1, 3];
  let res = R.apply(s, { r: 6, t: 1 });             // enter on start where token 0 stands
  assert.deepStrictEqual(res.state.tokens[0], [-1, 0, -1, 3]);
  assert.ok(res.events.some(e => e.type === 'selfCapture' && e.token === 0));
  s.tokens[0] = [5, 8, -1, -1];
  res = R.apply(s, { r: 3, t: 0 });                 // 5 + 3 lands on 8
  assert.deepStrictEqual(res.state.tokens[0], [8, -1, -1, -1]);
  // without the rule tokens share the square
  const s2 = R.newGame(four());
  s2.tokens[0] = [5, 8, -1, -1];
  assert.deepStrictEqual(R.apply(s2, { r: 3, t: 0 }).state.tokens[0], [8, 8, -1, -1]);
  // the move stays compulsory when it is the only one ("the one that is free to go must go")
  const s3 = R.newGame(Object.assign(four(), { rules: { selfKick: true } }));
  s3.tokens[0] = [5, 8, 56, 56];
  assert.deepStrictEqual(R.legalMoves(s3, 3), [0, 1]);
  s3.tokens[0] = [5, 56, 56, 56];
  assert.deepStrictEqual(R.legalMoves(s3, 3), [0]);
});

test('AI avoids sending its own token home when it has another move', () => {
  const s = R.newGame(Object.assign(four(), { rules: { selfKick: true } }));
  s.tokens[0] = [5, 8, 20, -1];
  // token 0 + 3 would land on token 1; token 2 is free to move
  for (const lv of ['normal', 'hard']) assert.notStrictEqual(AI.choose(s, 3, lv, rng(3)), 0, lv);
});

test('selfKick games still finish (500 bot games)', () => {
  const rnd = rng(4242);
  for (let g = 0; g < 500; g++) {
    let s = R.newGame({ seats: [hardSome(g), bot('easy'), bot('normal'), bot('normal')], rules: { selfKick: true } });
    let steps = 0;
    while (!s.over) { const r = 1 + Math.floor(rnd() * 6); s = R.apply(s, { r, t: AI.choose(s, r, s.seats[s.turn].level, rnd) }).state; if (++steps > 6000) throw new Error('no end'); }
  }
});

test('normalizeRules keeps the new option and ignores junk', () => {
  assert.strictEqual(R.normalizeRules({ onePerSquare: 1 }).onePerSquare, true);
  assert.strictEqual(R.normalizeRules({}).onePerSquare, false);
  assert.strictEqual(R.normalizeRules({ selfKick: 1 }).selfKick, true);
  assert.strictEqual(R.normalizeRules({}).selfKick, false);
  assert.ok(!('evil' in R.normalizeRules({ evil: true })));
});

function enc(author, kind, fields) { return { author, text: P.encode(P.msg(kind, fields, 'test')) }; }

test('protocol: new round needs every active human to agree; the host then starts it', () => {
  const seats = [{ kind: 'human', user: 'alice' }, { kind: 'human', user: 'bob' }, { kind: 'bot', level: 'easy' }, null];
  const e = [enc('alice', 'setup', { g: 'G1', seats, first: 0, round: 1 })];
  e.push(enc('alice', 'move', { g: 'G1', n: 0, c: 0, r: 2, t: -1 }));
  e.push(enc('bob', 'restartAsk', { g: 'G1', id: 'ask1' }));
  // P.msg makes its own id: fix the ask id so votes can refer to it
  const askMsg = P.decode(e[2].text); askMsg.id = 'ask1'; e[2].text = P.encode(askMsg);
  let rep = P.replay(e, 'alice');
  assert.ok(rep.restart && !rep.restart.complete && rep.restart.author === 'bob');
  assert.deepStrictEqual(rep.restart.needed.sort(), ['alice', 'bob']);
  e.push(enc('alice', 'restartVote', { g: 'G1', ask: 'ask1', yes: true }));
  rep = P.replay(e, 'alice');
  assert.ok(rep.restart.complete);
  // a "no" closes the question
  const declined = e.slice(0, 3).concat([enc('alice', 'restartVote', { g: 'G1', ask: 'ask1', yes: false })]);
  const rd = P.replay(declined, 'alice');
  assert.ok(!rd.restart.complete && rd.restart.declinedBy === 'alice');
  // someone outside the game cannot vote or ask
  const outsider = e.slice(0, 3).concat([enc('eve', 'restartVote', { g: 'G1', ask: 'ask1', yes: true })]);
  assert.ok(!P.replay(outsider, 'alice').restart.complete);
  // the host starts round 2 in the same chat; round 1 stays in the results, chat lines stay
  e.push(enc('bob', 'say', { g: 'G1', text: 'gg' }));
  e.push(enc('alice', 'setup', { g: 'G2', seats, first: 1, round: 2, ask: 'ask1' }));
  rep = P.replay(e, 'alice');
  assert.strictEqual(rep.setup.g, 'G2'); assert.strictEqual(rep.state.n, 0); assert.strictEqual(rep.state.turn, 1);
  assert.strictEqual(rep.rounds.length, 2); assert.strictEqual(rep.rounds[1].round, 2);
  assert.strictEqual(rep.restart, null);
  assert.strictEqual(rep.says.length, 1);
});

test('protocol: a player who handed over to the computer is not asked', () => {
  const seats = [{ kind: 'human', user: 'alice' }, { kind: 'human', user: 'bob' }, null, null];
  const e = [enc('alice', 'setup', { g: 'G', seats, first: 0 }), enc('bob', 'resign', { g: 'G', c: 1, after: 0 }), enc('alice', 'restartAsk', { g: 'G' })];
  const rep = P.replay(e, 'alice');
  assert.deepStrictEqual(rep.restart.needed, ['alice']);
  assert.ok(rep.restart.complete);
});

test('protocol: results of every round are kept', () => {
  const { entries } = onlineGame(11);
  const s2 = P.msg('setup', { g: 'G2', seats: [{ kind: 'human', user: 'alice' }, null, { kind: 'human', user: 'bob' }, null], first: 0, round: 2 });
  const rep = P.replay(entries.concat([{ author: 'alice', text: P.encode(s2) }]), 'alice');
  assert.strictEqual(rep.rounds.length, 2);
  assert.ok(rep.rounds[0].over && rep.rounds[0].winner != null);
  assert.ok(!rep.rounds[1].over);
});

test('protocol: messages of a newer protocol are counted, not applied', () => {
  const m = P.msg('setup', { g: 'X', seats: [{ kind: 'human', user: 'a' }, { kind: 'bot' }, null, null] });
  m.v = P.PROTOCOL + 1;
  const rep = P.replay([{ author: 'a', text: P.encode(m) }], 'a');
  assert.strictEqual(rep.unknown, 1); assert.strictEqual(rep.setup, null);
});

test('rule onePerSquare: landing on ANY token sends it to its yard, safe squares do not protect', () => {
  const s = R.newGame(Object.assign(four(), { rules: { onePerSquare: true } }));
  // green token on red's start square (green rel 39 = track cell 0) – red enters with a 6
  s.tokens[1] = [39, -1, -1, -1];
  s.tokens[0] = [0 + 0, -1, -1, -1].map((x, i) => (i === 0 ? 0 : -1));
  let res = R.apply(s, { r: 6, t: 1 });
  assert.deepStrictEqual(res.state.tokens[0], [-1, 0, -1, -1], 'own token on start kicked');
  assert.deepStrictEqual(res.state.tokens[1], [-1, -1, -1, -1], 'opponent on start kicked');
  assert.ok(res.events.some(e => e.type === 'selfCapture') && res.events.some(e => e.type === 'capture'));
  // a star (track cell 8) does not protect either
  const s2 = R.newGame(Object.assign(four(), { rules: { onePerSquare: true } }));
  s2.tokens[0] = [5, -1, -1, -1];
  s2.tokens[2] = [(8 - 26 + 52) % 52, -1, -1, -1]; // yellow on cell 8
  res = R.apply(s2, { r: 3, t: 0 });
  assert.strictEqual(res.state.tokens[2][0], -1);
  // without the rule the star protects and the start square protects
  const s3 = R.newGame(four());
  s3.tokens[0] = [5, -1, -1, -1]; s3.tokens[2] = [34, -1, -1, -1];
  assert.strictEqual(R.apply(s3, { r: 3, t: 0 }).state.tokens[2][0], 34);
  // safeSquares off on its own still only hits opponents
  const s4 = R.newGame(Object.assign(four(), { rules: { safeSquares: false } }));
  s4.tokens[0] = [5, 8, -1, -1];
  assert.deepStrictEqual(R.apply(s4, { r: 3, t: 0 }).state.tokens[0], [8, 8, -1, -1]);
  // home column tokens of others are never hit; own token in the home column is kicked
  const s5 = R.newGame(Object.assign(four(), { rules: { onePerSquare: true } }));
  s5.tokens[0] = [50, 53, -1, -1];
  assert.deepStrictEqual(R.apply(s5, { r: 3, t: 0 }).state.tokens[0], [53, -1, -1, -1]);
  // capture bonus counts for an opponent, not for an own token
  const s6 = R.newGame(Object.assign(four(), { rules: { onePerSquare: true } }));
  s6.tokens[0] = [5, 8, -1, -1];
  assert.strictEqual(R.apply(s6, { r: 3, t: 0 }).state.turn, 1);
  assert.strictEqual(R.protects(R.normalizeRules({ onePerSquare: true }), 8), false);
  assert.strictEqual(R.protects(R.normalizeRules({}), 8), true);
});

test('onePerSquare games still finish (500 bot games), AI does not walk onto a start square for safety', () => {
  const rnd = rng(777);
  for (let g = 0; g < 500; g++) {
    let s = R.newGame({ seats: [hardSome(g), bot('easy'), bot('normal'), hardSome(g + 2)], rules: { onePerSquare: true } });
    let steps = 0;
    while (!s.over) { const r = 1 + Math.floor(rnd() * 6); s = R.apply(s, { r, t: AI.choose(s, r, s.seats[s.turn].level, rnd) }).state; if (++steps > 6000) throw new Error('no end'); }
    for (let c = 0; c < 4; c++) { // never two tokens on one track square
      const cells = [];
      for (let c2 = 0; c2 < 4; c2++) for (const q of s.tokens[c2]) if (q >= 0 && q <= R.LAST_TRACK) cells.push(R.trackIndex(c2, q));
      assert.strictEqual(new Set(cells).size, cells.length);
    }
  }
});

test('protocol: leave hands the seat to the host computer, also in later rounds; host leaving ends the game', () => {
  const seats = [{ kind: 'human', user: 'alice' }, { kind: 'human', user: 'bob' }, null, null];
  const e = [enc('alice', 'setup', { g: 'G', seats, first: 0, round: 1, rules: { threeTries: false } })];
  e.push(enc('alice', 'move', { g: 'G', n: 0, c: 0, r: 2, t: -1 }));
  e.push(enc('bob', 'say', { g: 'G', text: 'bye' }));
  e.push(enc('bob', 'leave', { g: 'G', c: 1, after: 1 }));
  e.push(enc('alice', 'move', { g: 'G', n: 1, c: 1, r: 2, t: -1 })); // the host plays bob's colour now
  let rep = P.replay(e, 'alice');
  assert.strictEqual(rep.state.n, 2);
  assert.deepStrictEqual(rep.left, ['bob']);
  assert.strictEqual(rep.hostLeft, false);
  assert.ok(rep.timeline.some(x => x.kind === 'left' && x.author === 'bob' && !x.host));
  // bob is not asked about a new round any more
  e.push(enc('alice', 'restartAsk', { g: 'G' }));
  rep = P.replay(e, 'alice');
  assert.deepStrictEqual(rep.restart.needed, ['alice']); assert.ok(rep.restart.complete);
  // a new round that still lists bob as human (sent before the host saw the leave): the host plays him from move 0
  const e2 = e.concat([enc('alice', 'setup', { g: 'G2', seats, first: 1, round: 2, rules: { threeTries: false } }), enc('alice', 'move', { g: 'G2', n: 0, c: 1, r: 2, t: -1 })]);
  rep = P.replay(e2, 'alice');
  assert.strictEqual(rep.setup.g, 'G2'); assert.strictEqual(rep.state.n, 1);
  // a leave in a later round does not touch an earlier one: order independence
  const shuffled = [0, 1, 4, 5, 6, 7, 2, 3].map(i => e2[i]); // bob's messages merged last
  assert.strictEqual(P.replay(shuffled, 'alice').state.n, 1);
  // the host leaves: the game is marked as ended, no new-round question stays open
  const e3 = e.concat([enc('alice', 'leave', { g: 'G', c: 0, after: 2 })]);
  rep = P.replay(e3, 'alice');
  assert.strictEqual(rep.hostLeft, true); assert.strictEqual(rep.restart, null);
  assert.ok(rep.timeline.some(x => x.kind === 'left' && x.author === 'alice' && x.host));
  // someone who is not a player leaving changes nothing in the game
  rep = P.replay(e.slice(0, 2).concat([enc('eve', 'leave', { g: 'G', c: 1, after: 0 }), enc('alice', 'move', { g: 'G', n: 1, c: 1, r: 2, t: -1 })]), 'alice');
  assert.strictEqual(rep.state.n, 1);
});

test('protocol: messages carry the lowest protocol that understands them', () => {
  assert.strictEqual(P.msg('move', {}).v, 2); assert.strictEqual(P.msg('say', {}).v, 2);
  assert.strictEqual(P.msg('setup', {}).v, 3); assert.strictEqual(P.msg('leave', {}).v, 3);
  assert.ok(P.PROTOCOL >= 3);
});

test('rule mustEnter: a 6 must bring a token out while one is in the yard', () => {
  const s = R.newGame(Object.assign(four(), { rules: { mustEnter: true } }));
  s.tokens[0] = [10, 20, -1, -1];
  assert.deepStrictEqual(R.legalMoves(s, 6), [2, 3], 'only the yard tokens');
  assert.deepStrictEqual(R.legalMoves(s, 3), [0, 1], 'other rolls as usual');
  s.tokens[0] = [10, 20, 30, 56];
  assert.deepStrictEqual(R.legalMoves(s, 6), [0, 1, 2], 'nobody in the yard: any move');
  // without the rule a 6 may move any token
  const s2 = R.newGame(four()); s2.tokens[0] = [10, 20, -1, -1];
  assert.deepStrictEqual(R.legalMoves(s2, 6), [0, 1, 2, 3]);
  // the third six still forfeits
  const s3 = R.newGame(Object.assign(four(), { rules: { mustEnter: true } })); s3.tokens[0] = [10, -1, -1, -1]; s3.sixes = 2;
  assert.deepStrictEqual(R.legalMoves(s3, 6), []);
});

test('rule protectOwn (with onePerSquare): own tokens cannot be landed on, except a forced entry with mustEnter', () => {
  const rules = { onePerSquare: true, protectOwn: true };
  const s = R.newGame(Object.assign(four(), { rules }));
  s.tokens[0] = [5, 8, 20, -1];
  assert.deepStrictEqual(R.legalMoves(s, 3), [1, 2], 'token 0 would land on token 1 – not allowed');
  s.tokens[0] = [0, 30, -1, -1];
  assert.deepStrictEqual(R.legalMoves(s, 6), [0, 1], 'entering onto the own token on the start square is not allowed');
  s.tokens[0] = [5, 8, 56, 56];
  assert.deepStrictEqual(R.legalMoves(s, 3), [1], 'the only other move');
  s.tokens[0] = [5, 8, 56, 56]; s.tokens[0][1] = 8;
  const blocked = R.newGame(Object.assign(four(), { rules })); blocked.tokens[0] = [50, 53, 56, 56];
  assert.deepStrictEqual(R.legalMoves(blocked, 3), [1], 'home column too');
  // opponents are still captured, also on a star
  const c = R.newGame(Object.assign(four(), { rules })); c.tokens[0] = [5, -1, -1, -1]; c.tokens[2] = [34, -1, -1, -1];
  assert.strictEqual(R.apply(c, { r: 3, t: 0 }).state.tokens[2][0], -1);
  // forced entry with mustEnter sends the own token on the start square back (the user's special case)
  const f = R.newGame(Object.assign(four(), { rules: { onePerSquare: true, protectOwn: true, mustEnter: true } }));
  f.tokens[0] = [0, 30, -1, 56];
  assert.deepStrictEqual(R.legalMoves(f, 6), [2], 'must enter');
  const res = R.apply(f, { r: 6, t: 2 });
  assert.deepStrictEqual(res.state.tokens[0], [-1, 30, 0, 56]);
  assert.ok(res.events.some(e => e.type === 'selfCapture' && e.token === 0));
  // games of 0.3.0 (no protectOwn) keep their rule: own tokens are kicked
  const old = R.newGame(Object.assign(four(), { rules: { onePerSquare: true } })); old.tokens[0] = [5, 8, -1, -1];
  assert.deepStrictEqual(R.legalMoves(old, 3), [0, 1]);
  assert.deepStrictEqual(R.apply(old, { r: 3, t: 0 }).state.tokens[0], [8, -1, -1, -1]);
});

test('new rules: 500 bot games each finish, own tokens never share or get kicked', () => {
  const rnd = rng(9090);
  for (const rules of [{ mustEnter: true }, { onePerSquare: true, protectOwn: true }, { onePerSquare: true, protectOwn: true, mustEnter: true }]) {
    for (let g = 0; g < 500; g++) {
      let s = R.newGame({ seats: [hardSome(g), bot('easy'), bot('normal'), hardSome(g + 2)], rules });
      let steps = 0;
      while (!s.over) {
        const r = 1 + Math.floor(rnd() * 6), t = AI.choose(s, r, s.seats[s.turn].level, rnd);
        const res = R.apply(s, { r, t });
        if (rules.protectOwn && !(rules.mustEnter && r === 6)) assert.ok(!res.events.some(e => e.type === 'selfCapture'), 'own token kicked');
        s = res.state;
        if (++steps > 8000) throw new Error('no end ' + JSON.stringify(rules));
      }
    }
  }
});

test('protocol: setups that use the 0.4.0 rules need protocol 4, others stay at 3', () => {
  assert.strictEqual(P.msg('setup', { rules: { mustEnter: true } }).v, 4);
  assert.strictEqual(P.msg('setup', { rules: { onePerSquare: true, protectOwn: true } }).v, 4);
  assert.strictEqual(P.msg('setup', { rules: { protectOwn: true } }).v, 3, 'protectOwn alone changes nothing');
  assert.strictEqual(P.msg('setup', { rules: {} }).v, 3);
  assert.ok(P.PROTOCOL >= 4);
  // a 0.3.0 app (protocol 3) would count a protocol-4 setup as unknown instead of replaying it wrongly
  const m = P.msg('setup', { g: 'X', seats: [{ kind: 'human', user: 'a' }, { kind: 'bot' }, null, null], rules: { mustEnter: true } });
  assert.ok(m.v > 3);
});

test('rule safeBlock (0.5.0): safe squares together with one token per square', () => {
  const rules = { onePerSquare: true, protectOwn: true, safeSquares: true, safeBlock: true };
  // yellow (colour 2) on star cell 8 = yellow rel 34; red at rel 5 rolls 3 → would land on it: not allowed
  const s = R.newGame(Object.assign(four(), { rules }));
  s.tokens[0] = [5, 20, -1, -1]; s.tokens[2] = [34, -1, -1, -1];
  assert.deepStrictEqual(R.legalMoves(s, 3), [1], 'the safe square with an opponent is blocked');
  assert.deepStrictEqual(R.capturesAt(s, 0, 8), [], 'and nobody is captured there');
  // an empty safe square can be used, a normal square captures as before
  s.tokens[2] = [-1, -1, -1, -1]; s.tokens[1] = [6, -1, -1, -1]; // green rel 6 = cell 19
  assert.deepStrictEqual(R.legalMoves(s, 3), [0, 1]);
  const s2 = R.newGame(Object.assign(four(), { rules })); s2.tokens[0] = [5, -1, -1, -1]; s2.tokens[1] = [45, -1, -1, -1]; // green rel 45 = cell 6
  assert.strictEqual(R.apply(s2, { r: 1, t: 0 }).state.tokens[1][0], -1, 'capture on a normal square');
  // entering on the own start square captures an opponent standing there
  const s3 = R.newGame(Object.assign(four(), { rules })); s3.tokens[0] = [-1, -1, -1, -1]; s3.tokens[1] = [39, -1, -1, -1]; // green rel 39 = cell 0
  assert.deepStrictEqual(R.legalMoves(s3, 6), [0, 1, 2, 3]);
  const r3 = R.apply(s3, { r: 6, t: 0 });
  assert.strictEqual(r3.state.tokens[1][0], -1); assert.strictEqual(r3.state.tokens[0][0], 0);
  // safe squares switched off: one token per square captures everywhere (as in 0.3.0/0.4.0)
  const s4 = R.newGame(Object.assign(four(), { rules: Object.assign({}, rules, { safeSquares: false }) }));
  s4.tokens[0] = [5, -1, -1, -1]; s4.tokens[2] = [34, -1, -1, -1];
  assert.strictEqual(R.apply(s4, { r: 3, t: 0 }).state.tokens[2][0], -1);
  // games before 0.5.0 (no safeBlock): safe squares are ignored with one token per square, as before
  const old = R.newGame(Object.assign(four(), { rules: { onePerSquare: true, protectOwn: true, safeSquares: true } }));
  old.tokens[0] = [5, -1, -1, -1]; old.tokens[2] = [34, -1, -1, -1];
  assert.strictEqual(R.apply(old, { r: 3, t: 0 }).state.tokens[2][0], -1);
  assert.strictEqual(P.msg('setup', { rules }).v, 5);
  assert.strictEqual(P.msg('setup', { rules: Object.assign({}, rules, { safeSquares: false }) }).v, 4);
  // 500 bot games finish and never put two tokens on one square
  const rnd = rng(5150);
  for (let g = 0; g < 500; g++) {
    let st = R.newGame({ seats: [hardSome(g), bot('easy'), bot('normal'), hardSome(g + 2)], rules: Object.assign({ mustEnter: g % 2 === 0 }, rules) });
    let steps = 0;
    while (!st.over) {
      const r = 1 + Math.floor(rnd() * 6); st = R.apply(st, { r, t: AI.choose(st, r, st.seats[st.turn].level, rnd) }).state;
      const cells = [];
      for (let c = 0; c < 4; c++) for (const q of st.tokens[c]) if (q >= 0 && q <= R.LAST_TRACK) cells.push(R.trackIndex(c, q));
      assert.strictEqual(new Set(cells).size, cells.length, 'two tokens on one square');
      if (++steps > 8000) throw new Error('no end');
    }
  }
});

test('rule enterGrace (0.6.0): a 6 right after bringing a token out moves on instead of kicking it', () => {
  const rules = { mustEnter: true, onePerSquare: true, protectOwn: true, safeBlock: true, enterGrace: true, threeSixes: false };
  const g = () => { const s = R.newGame(Object.assign(four(), { rules })); s.turn = 0; return s; };
  // first 6: must bring a token out
  let s = g(); s.tokens[0] = [-1, -1, -1, -1];
  assert.deepStrictEqual(R.legalMoves(s, 6), [0, 1, 2, 3]);
  s = R.apply(s, { r: 6, t: 0 }).state;
  assert.deepStrictEqual(s.tokens[0], [0, -1, -1, -1]); assert.strictEqual(s.turn, 0, 'a 6 rolls again');
  // second 6 straight after: no entering on top of it – the new token moves on by six
  assert.deepStrictEqual(R.legalMoves(s, 6), [0]);
  const s2 = R.apply(s, { r: 6, t: 0 }).state;
  assert.deepStrictEqual(s2.tokens[0], [6, -1, -1, -1]);
  // third 6: the start square is empty again, so a 6 must bring the next token out (no kick)
  assert.deepStrictEqual(R.legalMoves(s2, 6), [1, 2, 3]);
  const s3 = R.apply(s2, { r: 6, t: 1 }).state;
  assert.deepStrictEqual(s3.tokens[0], [6, 0, -1, -1]);
  // fourth 6: the grace again – move a token on the board, no kick (the new one would land on the own token at 6,
  // which is protected, so only the token at 6 can move)
  assert.deepStrictEqual(R.legalMoves(s3, 6), [0]);
  // with another token already on the board the second 6 may move either one
  let t = g(); t.tokens[0] = [-1, -1, 20, -1];
  t = R.apply(t, { r: 6, t: 0 }).state;
  assert.deepStrictEqual(R.legalMoves(t, 6), [0, 2]);
  // the player leaves the new token on the start square (moves the other) – a later 6 brings out another and kicks it
  t = R.apply(t, { r: 6, t: 2 }).state;
  assert.deepStrictEqual(t.tokens[0], [0, -1, 26, -1]);
  assert.deepStrictEqual(R.legalMoves(t, 6), [1, 3], 'no grace any more: must enter');
  const tk = R.apply(t, { r: 6, t: 1 });
  assert.deepStrictEqual(tk.state.tokens[0], [-1, 0, 26, -1]);
  assert.ok(tk.events.some(e => e.type === 'selfCapture' && e.token === 0));
  // an entry that sent an own token home (start was not empty) gives no grace for the next 6
  assert.deepStrictEqual(R.legalMoves(tk.state, 6), [0, 3], 'must enter again (and kick the token that just came out)');
  // the grace only follows a 6 that brought a token out in this turn: on a new turn a token waiting on start is kicked
  let n = g(); n.tokens[0] = [0, -1, -1, -1]; n.last = null; n.sixes = 0;
  assert.deepStrictEqual(R.legalMoves(n, 6), [1, 2, 3]);
  // no move at all after the grace (the new token is blocked by an own token at 6): the turn passes, nothing is kicked
  let b = g(); b.tokens[0] = [-1, -1, -1, -1];
  b = R.apply(b, { r: 6, t: 0 }).state; b.tokens[0][3] = 6; // own token six squares ahead (set up directly)
  assert.deepStrictEqual(R.legalMoves(b, 6), [3], 'only the other token can move');
  b.tokens[0][3] = 56; b.tokens[0][2] = 6; b.tokens[0][1] = 56; // both others home except one blocking at 6
  assert.deepStrictEqual(R.legalMoves(b, 6), [2]);
  // games before 0.6.0 (no enterGrace): the second 6 kicks the new token as before
  let o = R.newGame(Object.assign(four(), { rules: Object.assign({}, rules, { enterGrace: false }) })); o.turn = 0;
  o = R.apply(o, { r: 6, t: 0 }).state;
  assert.deepStrictEqual(R.legalMoves(o, 6), [1, 2, 3]);
  // protocol: such games need protocol 6; a 0.5.0 app would replay them differently
  assert.strictEqual(P.msg('setup', { rules }).v, 6);
  assert.strictEqual(P.msg('setup', { rules: Object.assign({}, rules, { mustEnter: false, safeSquares: true }) }).v, 5);
  // 500 bot games with the rule finish and never put two tokens on one square
  const rnd = rng(6060);
  for (let k = 0; k < 500; k++) {
    let st = R.newGame({ seats: [hardSome(k), bot('easy'), bot('normal'), hardSome(k + 2)], rules: Object.assign({}, rules, { threeSixes: k % 2 === 0 }) });
    let steps = 0;
    while (!st.over) {
      const r = 1 + Math.floor(rnd() * 6); st = R.apply(st, { r, t: AI.choose(st, r, st.seats[st.turn].level, rnd) }).state;
      const cells = [];
      for (let c = 0; c < 4; c++) for (const q of st.tokens[c]) if (q >= 0 && q <= R.LAST_TRACK) cells.push(R.trackIndex(c, q));
      assert.strictEqual(new Set(cells).size, cells.length);
      if (++steps > 8000) throw new Error('no end');
    }
  }
});

// ───────────────────────── 0.7.0 ─────────────────────────
const CZECH = { enterOn: 'six', mustEnter: false, threeTries: true, sixBonus: true, threeSixes: false, captureBonus: false, finishBonus: false,
  onePerSquare: true, safeSquares: false, endMode: 'first', protectOwn: true, safeBlock: true, enterGrace: true };

test('rules have fixed numbers; changed rules are named by number (as they play)', () => {
  assert.deepStrictEqual(R.RULE_ORDER.slice(0, 10), ['enterOn', 'mustEnter', 'threeTries', 'sixBonus', 'threeSixes', 'captureBonus', 'finishBonus', 'onePerSquare', 'safeSquares', 'endMode']);
  assert.strictEqual(R.ruleNo('enterOn'), 1);
  assert.strictEqual(R.ruleNo('endMode'), 10);
  assert.strictEqual(R.ruleNo('selfKick'), 11);
  assert.strictEqual(R.ruleNo('protectOwn'), null);
  assert.deepStrictEqual(R.changedRules({}, { mustEnter: true, onePerSquare: true, safeSquares: false, safeBlock: true }), [2, 8, 9]);
  // a game before 0.5.0 (no safeBlock): safe squares did nothing together with one token per square
  assert.deepStrictEqual(R.changedRules({ onePerSquare: true, safeSquares: true }, { onePerSquare: true, safeSquares: false }), []);
  assert.deepStrictEqual(R.changedRules({}, {}), []);
});

test('protocol: the host changes the rules before the first roll (a setup that replaces the last one)', () => {
  const seats = [{ kind: 'human', user: 'alice' }, null, { kind: 'human', user: 'bob' }, { kind: 'bot', level: 'hard' }];
  const s1 = P.msg('setup', { g: 'G1', seats, rules: {}, first: 3, round: 1, agree: true });
  const no = P.msg('say', { g: 'G1', text: 'no', rulesOk: false });
  const offer = P.msg('say', { g: 'G1', text: 'try this', offer: { rules: { onePerSquare: true, safeSquares: false, evil: 1 }, rulesName: '  Bob’s   rules ' } });
  const s2 = P.msg('setup', { g: 'G2', seats, rules: Object.assign({}, CZECH, { captureBonus: true, finishBonus: true, threeSixes: true }), first: 3, round: 1, replaces: 'G1', agree: true, rulesName: 'Bob’s rules' });
  const yes = P.msg('say', { g: 'G2', text: 'ok', rulesOk: true });
  const e = [[s1, 'alice'], [no, 'bob'], [offer, 'bob'], [s2, 'alice'], [yes, 'bob']].map(([m, a]) => ({ author: a, text: P.encode(m) }));
  const rep = P.replay(e, 'alice');
  assert.strictEqual(rep.setup.g, 'G2');
  assert.strictEqual(rep.state.rules.onePerSquare, true);
  assert.strictEqual(rep.rounds.length, 1, 'the replaced setup is no round of its own');
  assert.strictEqual(rep.rounds[0].g, 'G2');
  const lines = rep.timeline.filter(x => x.kind === 'rules');
  assert.strictEqual(lines.length, 1);
  assert.deepStrictEqual(lines[0].changed, [8, 9]);
  assert.strictEqual(rep.timeline.filter(x => x.kind === 'round').length, 1);
  assert.deepStrictEqual(rep.votes, { bob: true }, 'answers count for the current rules only');
  const o = rep.timeline.find(x => x.offer);
  assert.deepStrictEqual(o.offer, { rules: { onePerSquare: true, safeSquares: false }, rulesName: 'Bob’s rules' }, 'suggestions are cleaned');
  // a player who handed over before the change stays handed over
  const res = P.msg('resign', { g: 'G1', c: 2, after: 0 });
  assert.strictEqual(P.replay(e.concat([{ author: 'bob', text: P.encode(res) }]), 'alice').resignedAt[2], 0);
  // a "replacement" from somebody else than the host is ignored
  const fake = P.msg('setup', { g: 'G3', seats, rules: {}, first: 0, round: 1, replaces: 'G2' });
  assert.strictEqual(P.replay(e.concat([{ author: 'bob', text: P.encode(fake) }]), 'alice').setup.g, 'G2');
  // no new protocol: an app of 0.6.0 plays the replacing setup (the last one) the same way
  assert.ok(s2.v <= 6 && P.PROTOCOL === 6);
});

test('protocol: Peergos\' RemoveMember (a member deleted their copy of the chat) counts as leaving', () => {
  const g = onlineGame(9090, { limit: 40 });
  const bobMoves = g.entries.map(e => P.decode(e.text)).filter(m => m && m.k === 'move' && m.c === 2).map(m => m.n);
  const entries = g.entries.concat([{ type: 'RemoveMember', author: 'alice', removeUsername: 'bob', timestamp: '2026-10-22 10:50:07' }]);
  const rep = P.replay(entries, 'alice');
  assert.deepStrictEqual(rep.left, ['bob']);
  assert.strictEqual(rep.resignedAt[2], Math.max(...bobMoves) + 1, 'handed over after bob\'s last move');
  assert.strictEqual(rep.state.n, g.final.n, 'bob\'s earlier moves still count');
  assert.ok(rep.timeline.some(x => x.kind === 'left' && x.author === 'bob'));
  // the host's app plays on for bob
  const st = rep.state;
  if (st.turn === 2 && !st.over) assert.strictEqual(rep.controller(2, st.n), 'alice');
  // a second RemoveMember of the same member changes nothing
  assert.deepStrictEqual(P.replay(entries.concat([entries[entries.length - 1]]), 'alice').left, ['bob']);
});

// Positions where the hard computer must not make a dumb move (each checked with 1500 Monte Carlo games per move).
const relOf = (c, cell) => (cell - R.START[c] + 52) % 52;
const SCENARIOS = [
  { id: 'capture the last token of a player about to win', rules: {}, seats: [1, 0, 1, 0], roll: 3,
    tokens: [[relOf(0, 15), 40, 53, 56], null, [56, 56, 56, 44], null], want: 0 },
  { id: 'no capture: move the chaser closer behind that token (not the token in the home column)', rules: {}, seats: [1, 0, 1, 0], roll: 2,
    tokens: [[relOf(0, 14), 40, 53, 56], null, [56, 56, 56, 44], null], want: 0 },
  { id: 'Czech rules: get off the start square of a player waiting with all tokens in the yard', rules: CZECH, seats: [1, 0, 1, 0], roll: 4,
    tokens: [[relOf(0, 26), relOf(0, 5), -1, -1], null, [-1, -1, -1, 56], null], want: 0 },
  { id: 'escape onto a safe square from a token two squares behind', rules: {}, seats: [1, 0, 1, 0], roll: 3,
    tokens: [[relOf(0, 36), relOf(0, 20), -1, -1], null, [relOf(2, 34), -1, -1, -1], null], want: 0 },
  { id: 'two captures: hit the leader, not the more advanced token of a player far behind', rules: {}, seats: [1, 1, 0, 1], roll: 4,
    tokens: [[relOf(0, 29), relOf(0, 31), -1, -1], [56, 56, 56, relOf(1, 33)], null, [relOf(3, 35), -1, -1, -1]], want: 0 },
];
test('hard: no dumb moves in known positions', () => {
  for (const sc of SCENARIOS) {
    const s = R.newGame({ seats: sc.seats.map(x => (x ? bot('hard') : null)), rules: sc.rules, first: 0 });
    sc.tokens.forEach((tk, c) => { if (tk) s.tokens[c] = tk.slice(); });
    for (const seed of [1, 2, 3]) assert.strictEqual(AI.choose(s, sc.roll, 'hard', rng(seed)), sc.want, sc.id);
  }
  // the position of the user's example: normal moves its home-column token, hard chases
  const sc = SCENARIOS[1];
  const s = R.newGame({ seats: sc.seats.map(x => (x ? bot('normal') : null)), rules: sc.rules, first: 0 });
  sc.tokens.forEach((tk, c) => { if (tk) s.tokens[c] = tk.slice(); });
  assert.notStrictEqual(AI.choose(s, sc.roll, 'normal', rng(1)), sc.want, 'normal does not see it (this is why hard exists)');
});

test('levels: hard beats normal, a child-like player beats easy (fixed dice, 2 players, standard and Czech rules)', () => {
  const child = (s, r, rnd) => { // captures when it sees one, likes to bring tokens out, otherwise moves a front token or anything
    const l = R.legalMoves(s, r); if (!l.length) return -1; if (l.length === 1) return l[0];
    const cap = l.filter(t => R.capturesAt(s, s.turn, R.target(s, t, r).to).length);
    if (cap.length && rnd() < 0.7) return cap[0];
    const ent = l.filter(t => s.tokens[s.turn][t] === -1);
    if (ent.length && rnd() < 0.6) return ent[0];
    if (rnd() < 0.5) return l.reduce((a, b) => (s.tokens[s.turn][b] > s.tokens[s.turn][a] ? b : a));
    return l[Math.floor(rnd() * l.length)];
  };
  const duel = (A, B, rules, N, seed) => {
    let wa = 0;
    for (let g = 0; g < N; g++) {
      const rnd = rng(seed + g), dice = rng(seed * 7 + g);
      const pA = g % 2 ? 0 : 2;
      let s = R.newGame({ seats: [bot('normal'), null, bot('normal'), null], rules, first: g % 4 < 2 ? 0 : 2 });
      while (!s.over) { const r = 1 + Math.floor(dice() * 6); const f = s.turn === pA ? A : B; s = R.apply(s, { r, t: f(s, r, rnd) }).state; }
      if (s.winner === pA) wa++;
    }
    return wa / N;
  };
  const lv = l => (s, r, rnd) => AI.choose(s, r, l, rnd);
  const hs = duel(lv('hard'), lv('normal'), {}, 240, 100), hc = duel(lv('hard'), lv('normal'), CZECH, 240, 300);
  const ec = duel(lv('easy'), child, {}, 240, 500);
  console.log('  hard vs normal: ' + (100 * hs).toFixed(0) + '% (standard), ' + (100 * hc).toFixed(0) + '% (Czech); easy vs a child-like player: ' + (100 * ec).toFixed(0) + '%');
  assert.ok(hs > 0.52 && hc > 0.52, 'hard should beat normal');
  assert.ok(ec < 0.45, 'a child should beat easy');
});

test('hard: thinking stays quick (every rule set, 4 players)', () => {
  let max = 0, sum = 0, n = 0;
  for (const rules of [{}, CZECH, { mustEnter: true, onePerSquare: true, protectOwn: true, safeBlock: true, enterGrace: true }, { endMode: 'all', enterOn: 'oneOrSix' }]) {
    const rnd = rng(42);
    let s = R.newGame({ seats: [bot('hard'), bot('hard'), bot('hard'), bot('hard')], rules });
    let steps = 0;
    while (!s.over && steps < 1500) {
      const r = 1 + Math.floor(rnd() * 6);
      const t0 = process.hrtime.bigint();
      const t = AI.choose(s, r, 'hard', rnd);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      if (R.legalMoves(s, r).length > 1) { max = Math.max(max, ms); sum += ms; n++; }
      s = R.apply(s, { r, t }).state; steps++;
    }
  }
  console.log('  hard: ' + n + ' choices, avg ' + (sum / n).toFixed(1) + ' ms, max ' + max.toFixed(1) + ' ms');
  assert.ok(max < 80, 'a hard move took ' + max.toFixed(1) + ' ms');
});

console.log((process.exitCode ? 'FAILED' : 'OK') + ' – ' + passed + ' tests passed');
