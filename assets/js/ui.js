/* Ludo4Peergos – small DOM helpers: elements, toasts, dialogs. */
(function (root) {
  'use strict';

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') { for (const sk of Object.keys(v)) { if (sk.startsWith('--')) e.style.setProperty(sk, v[sk]); else e.style[sk] = v[sk]; } }
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      e.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }

  // SVG icons (inline, stroke = currentColor)
  const ICONS = {
    gear: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    sound: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    mute: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
    full: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.6-.8 1.1V13M12 17h.01"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    play: '<path d="M7 4v16l13-8z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    flag: '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 16 0v1"/>',
    device: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  };
  function icon(name, cls) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'ico' + (cls ? ' ' + cls : ''));
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[name] || '';
    return s;
  }

  // Toasts
  let toastBox = null;
  function toast(text, kind, ms) {
    if (!toastBox) { toastBox = h('div', { class: 'toasts', 'aria-live': 'polite' }); document.body.appendChild(toastBox); }
    const t = h('div', { class: 'toast ' + (kind || 'info') }, text);
    toastBox.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    const life = ms || (kind === 'bad' ? 6000 : 2600);
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, life);
    while (toastBox.children.length > 4) toastBox.firstChild.remove();
    return t;
  }

  // Dialogs: title … controls · Close (always last, top right)
  const stack = [];
  function dialog(opts) {
    const close = () => {
      const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
      wrap.classList.remove('in');
      setTimeout(() => wrap.remove(), 180);
      opts.onClose && opts.onClose();
    };
    const head = h('div', { class: 'dlg-head' },
      h('div', { class: 'dlg-title' }, opts.icon ? icon(opts.icon) : null, h('span', null, opts.title || '')),
      h('div', { class: 'dlg-controls' }, opts.controls || null),
      h('button', { class: 'icon-btn dlg-close', title: root.L4P.I18n.t('common.close') + ' (Esc)', 'aria-label': root.L4P.I18n.t('common.close'), onclick: close }, icon('close')));
    const body = h('div', { class: 'dlg-body' }, opts.body || null);
    const foot = opts.footer ? h('div', { class: 'dlg-foot' }, opts.footer) : null;
    const box = h('div', { class: 'dlg ' + (opts.cls || ''), role: 'dialog', 'aria-modal': 'true' }, head, body, foot);
    const wrap = h('div', { class: 'dlg-wrap', onmousedown: e => { if (e.target === wrap && opts.dismissable !== false) close(); } }, box);
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('in'));
    const api = { close, el: box, body, head, foot };
    stack.push(api);
    setTimeout(() => { const f = box.querySelector('[autofocus]') || box.querySelector('.dlg-foot .btn.primary'); if (f) f.focus(); }, 30);
    return api;
  }
  function topDialog() { return stack[stack.length - 1] || null; }

  function confirm(text, okLabel, opts) {
    const t = root.L4P.I18n.t;
    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (done) return; done = true; d.close(); resolve(v); };
      const d = dialog({
        title: (opts && opts.title) || '', cls: 'dlg-small', body: h('p', { class: 'confirm-text' }, text),
        footer: [h('button', { class: 'btn', onclick: () => finish(false) }, t('common.cancel')),
          h('button', { class: 'btn primary' + (opts && opts.danger ? ' danger' : ''), onclick: () => finish(true) }, okLabel || t('common.ok'))],
        onClose: () => { if (!done) { done = true; resolve(false); } },
      });
    });
  }

  function timeAgo(date) {
    const t = root.L4P.I18n.t;
    const ms = Date.now() - date.getTime();
    if (!(ms >= 0)) return '';
    const m = Math.floor(ms / 60000);
    if (m < 1) return t('common.justNow');
    if (m < 60) return t('common.minAgo', { n: m });
    const hh = Math.floor(m / 60);
    if (hh < 48) return t('common.hAgo', { n: hh });
    return t('common.dAgo', { n: Math.floor(hh / 24) });
  }

  root.L4P.UI = { h, icon, toast, dialog, confirm, topDialog, timeAgo, ICONS };
})(window);
