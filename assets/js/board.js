/* Ludo4Peergos – the SVG board: squares, yards, tokens, highlights and move animations. */
(function (root) {
  'use strict';
  const R = root.L4P.Rules;
  const NS = 'http://www.w3.org/2000/svg';
  const U = 10; // user units per grid cell

  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    if (attrs) for (const k of Object.keys(attrs)) {
      if (k === 'style' && typeof attrs[k] === 'object') { for (const sk of Object.keys(attrs[k])) { if (sk.startsWith('--')) e.style.setProperty(sk, attrs[k][sk]); else e.style[sk] = attrs[k][sk]; } }
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(e);
    return e;
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pv = c => 'var(--p' + c + ')';

  function starPath(cx, cy, ro, ri) {
    let d = '';
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? ri : ro;
      d += (k ? 'L' : 'M') + (cx + r * Math.cos(a)).toFixed(2) + ' ' + (cy + r * Math.sin(a)).toFixed(2);
    }
    return d + 'Z';
  }

  function create(container, opts) {
    opts = opts || {};
    const svg = el('svg', { viewBox: '-3 -3 156 156', class: 'board-svg', role: 'img', 'aria-label': 'Ludo board' });
    container.appendChild(svg);
    const defs = el('defs', null, svg);
    // gradients per colour
    for (let c = 0; c < 4; c++) {
      const g = el('radialGradient', { id: 'tok' + c, cx: '35%', cy: '30%', r: '75%' }, defs);
      el('stop', { offset: '0%', style: { stopColor: 'var(--p' + c + '-hi)' } }, g);
      el('stop', { offset: '55%', style: { stopColor: pv(c) } }, g);
      el('stop', { offset: '100%', style: { stopColor: 'var(--p' + c + '-lo)' } }, g);
      const y = el('linearGradient', { id: 'yard' + c, x1: '0', y1: '0', x2: '1', y2: '1' }, defs);
      el('stop', { offset: '0%', style: { stopColor: 'var(--p' + c + '-hi)' } }, y);
      el('stop', { offset: '100%', style: { stopColor: 'var(--p' + c + '-lo)' } }, y);
    }
    const sh = el('filter', { id: 'soft', x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs);
    el('feDropShadow', { dx: '0', dy: '1.2', stdDeviation: '1.4', 'flood-color': '#000', 'flood-opacity': '0.35' }, sh);

    // board base
    el('rect', { x: -2, y: -2, width: 154, height: 154, rx: 7, class: 'b-frame' }, svg);
    el('rect', { x: 0, y: 0, width: 150, height: 150, rx: 5, class: 'b-base' }, svg);

    // yards
    for (let c = 0; c < 4; c++) {
      const [x, y] = R.YARD[c];
      el('rect', { x: x * U + 1.2, y: y * U + 1.2, width: 57.6, height: 57.6, rx: 6, fill: 'url(#yard' + c + ')', class: 'b-yard' }, svg);
      el('rect', { x: x * U + 9, y: y * U + 9, width: 42, height: 42, rx: 5, class: 'b-yard-inner' }, svg);
      for (const [sx, sy] of R.YARD_SPOTS[c]) {
        el('circle', { cx: sx * U, cy: sy * U, r: 5.4, class: 'b-hole', style: { stroke: pv(c) } }, svg);
      }
    }
    // track
    const cells = [];
    R.TRACK.forEach(([x, y], i) => {
      const startOf = R.START.indexOf(i);
      const r = el('rect', { x: x * U + 0.55, y: y * U + 0.55, width: U - 1.1, height: U - 1.1, rx: 1.8, class: 'b-cell' + (startOf >= 0 ? ' b-start' : '') }, svg);
      if (startOf >= 0) r.style.fill = pv(startOf);
      cells.push(r);
      if (R.STARS.indexOf(i) >= 0) el('path', { d: starPath(x * U + 5, y * U + 5, 3.4, 1.45), class: 'b-star' }, svg);
    });
    // start arrows (direction of travel)
    const arrows = [[1, 6, 0], [8, 1, 90], [13, 8, 180], [6, 13, 270]];
    arrows.forEach(([x, y, rot]) => {
      el('path', { d: 'M-2.2 -2.2 L2 0 L-2.2 2.2 Z', class: 'b-arrow', transform: 'translate(' + (x * U + 5) + ' ' + (y * U + 5) + ') rotate(' + rot + ')' }, svg);
    });
    // home columns
    for (let c = 0; c < 4; c++) {
      R.HOME_COL[c].forEach(([x, y]) => {
        const r = el('rect', { x: x * U + 0.55, y: y * U + 0.55, width: U - 1.1, height: U - 1.1, rx: 1.8, class: 'b-homecol' }, svg);
        r.style.fill = pv(c);
      });
    }
    // centre
    const tri = [
      [[60, 60], [75, 75], [60, 90]], [[60, 60], [90, 60], [75, 75]],
      [[90, 60], [90, 90], [75, 75]], [[60, 90], [90, 90], [75, 75]],
    ];
    tri.forEach((pts, c) => el('polygon', { points: pts.map(p => p.join(',')).join(' '), class: 'b-center', style: { fill: pv(c) } }, svg));
    el('circle', { cx: 75, cy: 75, r: 5.2, class: 'b-center-dot' }, svg);
    el('path', { d: starPath(75, 75, 3.6, 1.5), class: 'b-center-star' }, svg);

    const trail = el('g', { class: 'b-trail' }, svg);
    const tokLayer = el('g', { class: 'b-tokens' }, svg);
    const fxLayer = el('g', { class: 'b-fx' }, svg);

    // tokens
    const toks = [];
    for (let c = 0; c < 4; c++) {
      toks[c] = [];
      for (let i = 0; i < 4; i++) {
        const g = el('g', { class: 'tok', 'data-c': c, 'data-i': i, tabindex: '-1' }, tokLayer);
        const inner = el('g', { class: 'tok-inner' }, g);
        el('circle', { r: 6, class: 'tok-ring' }, inner);
        el('ellipse', { cx: 0, cy: 2.8, rx: 3.6, ry: 1.5, class: 'tok-shadow' }, inner);
        el('circle', { r: 3.9, class: 'tok-base', fill: 'url(#tok' + c + ')', style: { stroke: 'var(--p' + c + '-lo)' } }, inner);
        el('circle', { r: 2.2, class: 'tok-cap', style: { fill: 'var(--p' + c + '-hi)' } }, inner);
        el('ellipse', { cx: -1.2, cy: -1.5, rx: 1.4, ry: 0.9, class: 'tok-shine' }, inner);
        el('text', { class: 'tok-num', y: 1.25 }, inner).textContent = String(i + 1);
        g.addEventListener('click', ev => { ev.stopPropagation(); opts.onToken && opts.onToken(c, i); });
        g.style.display = 'none';
        toks[c][i] = g;
      }
    }

    let shown = null; // state currently drawn
    let movable = { color: -1, list: [] };

    function place(g, x, y, scale) {
      g.style.transform = 'translate(' + (x * U).toFixed(2) + 'px,' + (y * U).toFixed(2) + 'px) scale(' + (scale || 1) + ')';
    }

    /** Draws a state without animation. */
    function render(state) {
      shown = state;
      // group tokens that share a square
      const groups = new Map();
      for (let c = 0; c < 4; c++) {
        for (let i = 0; i < 4; i++) {
          const g = toks[c][i];
          if (!state.seats[c]) { g.style.display = 'none'; continue; }
          g.style.display = '';
          const p = state.tokens[c][i];
          if (p < 0 || p === R.FINISH) { const [x, y] = R.cellOf(c, p, i); place(g, x, y, p === R.FINISH ? 0.5 : 1); continue; }
          const key = p <= R.LAST_TRACK ? 't' + R.trackIndex(c, p) : 'h' + c + '-' + p;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push([c, i, p]);
        }
      }
      const OFF = { 1: [[0, 0]], 2: [[-0.17, 0], [0.17, 0]], 3: [[-0.17, 0.12], [0.17, 0.12], [0, -0.17]], 4: [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]] };
      for (const list of groups.values()) {
        const n = Math.min(list.length, 4);
        list.forEach(([c, i, p], k) => {
          const [x, y] = R.cellOf(c, p, i);
          const o = OFF[n][Math.min(k, 3)];
          place(toks[c][i], x + o[0], y + o[1], n > 1 ? 0.78 : 1);
        });
      }
      applyMovable();
    }

    function applyMovable() {
      for (let c = 0; c < 4; c++) for (let i = 0; i < 4; i++) {
        const on = c === movable.color && movable.list.indexOf(i) >= 0;
        toks[c][i].classList.toggle('movable', on && movable.hint);
        toks[c][i].classList.toggle('pickable', on);
        toks[c][i].setAttribute('tabindex', on ? '0' : '-1');
      }
      svg.classList.toggle('picking', movable.list.length > 0);
    }

    function setMovable(color, list, hint) {
      movable = { color, list: list || [], hint: hint !== false };
      applyMovable();
    }

    function showTrail(color, rels) {
      while (trail.firstChild) trail.removeChild(trail.firstChild);
      (rels || []).forEach((rel, k) => {
        if (rel < 0 || rel >= R.FINISH) return;
        const [x, y] = R.cellOf(color, rel, 0);
        el('circle', { cx: x * U, cy: y * U, r: 1.1 + k * 0.08, class: 'trail-dot', style: { fill: pv(color) } }, trail);
      });
    }

    function burst(x, y, color) {
      const g = el('g', { class: 'burst', transform: 'translate(' + x * U + ' ' + y * U + ')' }, fxLayer);
      for (let k = 0; k < 10; k++) {
        const a = k * Math.PI / 5;
        el('circle', { cx: 0, cy: 0, r: 1.1, style: { fill: color != null ? pv(color) : 'var(--acc)', '--dx': (Math.cos(a) * 9).toFixed(1) + 'px', '--dy': (Math.sin(a) * 9).toFixed(1) + 'px' } }, g);
      }
      setTimeout(() => g.remove(), 900);
    }

    /**
     * Animates the events of one action from the drawn state to `next`. stepMs = duration of one square.
     * onStep() is called for each square (sound).
     */
    async function animate(next, events, stepMs, hooks) {
      hooks = hooks || {};
      if (!shown || stepMs <= 0) { render(next); return; }
      for (const ev of events) {
        if (ev.type === 'move') {
          const g = toks[ev.color][ev.token];
          tokLayer.appendChild(g); // on top
          g.style.transition = 'transform ' + Math.round(stepMs * 0.92) + 'ms cubic-bezier(.3,.7,.4,1)';
          g.classList.add('moving');
          const steps = ev.from < 0 ? [0] : ev.path;
          for (const rel of steps) {
            const [x, y] = R.cellOf(ev.color, rel, ev.token);
            place(g, x, y, rel === R.FINISH ? 0.5 : 1.08);
            hooks.step && hooks.step(rel);
            await sleep(stepMs);
          }
          g.classList.remove('moving');
          g.style.transition = '';
          showTrail(ev.color, ev.from < 0 ? [0] : [ev.from].concat(ev.path.slice(0, -1)));
        } else if (ev.type === 'capture') {
          const g = toks[ev.victim][ev.token];
          const [x, y] = R.cellOf(ev.victim, ev.from, ev.token);
          burst(x, y, ev.color);
          hooks.capture && hooks.capture(ev);
          g.style.transition = 'transform ' + Math.round(Math.max(260, stepMs * 4)) + 'ms cubic-bezier(.5,-0.4,.5,1.4)';
          const [yx, yy] = R.cellOf(ev.victim, -1, ev.token);
          place(g, yx, yy, 1);
          await sleep(Math.max(260, stepMs * 4));
          g.style.transition = '';
        } else if (ev.type === 'home') {
          burst(7.5, 7.5, ev.color);
          hooks.home && hooks.home(ev);
        }
      }
      render(next);
    }

    function tokenCenter(c, i) {
      const g = toks[c][i];
      const b = g.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }

    return { svg, render, animate, setMovable, showTrail, burst, tokenCenter, get shown() { return shown; } };
  }

  root.L4P.Board = { create };
})(window);
