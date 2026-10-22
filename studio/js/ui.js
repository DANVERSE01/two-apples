/* ui.js — studio shell: stage, selection, panels, commands */
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const ICON = {
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  unlock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.8-1.3"/></svg>',
};
let dpr = Math.min(2, window.devicePixelRatio || 1);
let K = 1; // css px per design px on the main stage

/* ------------------------------------------------------------ toast/busy */
let toastT;
function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
function busy(on, text = 'Working…') { $('#busy').hidden = !on; $('#busyT').textContent = text; }

/* ------------------------------------------------------------ render scheduling */
let rafPending = false;
function requestRender() { if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; renderAll(); }); } }
function renderAll() {
  if (S.view === 'grid') renderGrid(); else renderMain();
  renderThumbs();
  renderOverlay();
}
function fitStage() {
  const st = $('#stage'); const F = FORMATS[S.fmt];
  const W = st.clientWidth - 48, Hh = st.clientHeight - 28;
  K = Math.max(0.1, Math.min(W / F.w, Hh / F.h));
  const art = $('#art'); art.style.width = Math.round(F.w * K) + 'px'; art.style.height = Math.round(F.h * K) + 'px';
}
function renderMain() {
  fitStage();
  const F = FORMATS[S.fmt]; const cv = $('#cv'); const sc = K * dpr;
  const w = Math.round(F.w * sc), h = Math.round(F.h * sc);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  renderFormat(cv.getContext('2d'), S.fmt, sc);
}
function renderThumbs() {
  const box = $('#thumbs');
  if (!box.children.length) {
    for (const f of FMT_KEYS) {
      const b = el('button', { 'data-f': f, title: FORMATS[f].label, onclick: () => { S.fmt = f; S.view = 'single'; syncChrome(); requestRender(); } }, el('canvas'), `${FORMATS[f].label} ${FORMATS[f].ratio}`);
      box.append(b);
    }
  }
  for (const b of box.children) {
    const f = b.dataset.f, F = FORMATS[f]; b.classList.toggle('on', f === S.fmt && S.view === 'single');
    const H0 = 64, sc = H0 / F.h; const c = b.querySelector('canvas');
    const w = Math.round(F.w * sc * dpr), h = Math.round(F.h * sc * dpr);
    if (c.width !== w) { c.width = w; c.height = h; c.style.width = (w / dpr) + 'px'; c.style.height = (h / dpr) + 'px'; }
    renderFormat(c.getContext('2d'), f, sc * dpr);
  }
}
function renderGrid() {
  const g = $('#gridView');
  const st = $('#stage'); const availH = st.clientHeight - 90, availW = st.clientWidth - 48 - 20 * 3;
  const totalW = FMT_KEYS.reduce((a, f) => a + FORMATS[f].w / FORMATS[f].h, 0);
  const H0 = Math.max(120, Math.min(availH, availW / totalW));
  if (!g.children.length) for (const f of FMT_KEYS) g.append(el('figure', { 'data-f': f, onclick: () => { S.fmt = f; S.view = 'single'; syncChrome(); requestRender(); } }, el('canvas'), el('figcaption', {}, el('span', {}, FORMATS[f].label), el('span', {}, `${FORMATS[f].w}×${FORMATS[f].h}`))));
  for (const fig of g.children) {
    const f = fig.dataset.f, F = FORMATS[f], sc = H0 / F.h, c = fig.querySelector('canvas');
    const w = Math.round(F.w * sc * dpr), h = Math.round(F.h * sc * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; c.style.width = (w / dpr) + 'px'; c.style.height = (h / dpr) + 'px'; }
    renderFormat(c.getContext('2d'), f, sc * dpr);
  }
}

/* ------------------------------------------------------------ overlay */
let hoverId = null, guides = [];
function bboxCss(layer) { const G = geom(layer); return { x: G.x * K, y: G.y * K, w: G.w * K, h: G.h * K, rot: G.rot || 0 }; }
function renderOverlay() {
  const ov = $('#ov'); ov.innerHTML = '';
  if (S.view !== 'single') return;
  const F = FORMATS[S.fmt];
  if (S.safe && F.safe) {
    ov.append(el('div', { class: 'safe t', style: `height:${F.safe.top * K}px` }, el('span', {}, 'Profile & progress bar')));
    ov.append(el('div', { class: 'safe b', style: `height:${F.safe.bottom * K}px` }, el('span', {}, 'Reply bar & CTA sticker')));
  }
  if (hoverId && hoverId !== S.sel && L(hoverId)) { const b = bboxCss(L(hoverId)); ov.append(el('div', { class: 'hover', style: `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;transform:rotate(${b.rot}deg)` })); }
  const lay = S.sel && L(S.sel);
  if (lay && lay.visible && lay.type !== 'scene') {
    const b = bboxCss(lay);
    const box = el('div', { class: 'selbox', style: `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;transform:rotate(${b.rot}deg)` });
    box.append(el('span', { class: 'tag' + (lay.brand ? ' lock' : '') }, lay.brand ? '◆ ' + lay.name + ' · brand-locked' : lay.name));
    if (!lay.locked) { for (const c of ['nw', 'ne', 'sw', 'se']) box.append(el('i', { class: 'hd ' + c, 'data-h': c })); box.append(el('i', { class: 'stem' }), el('i', { class: 'hd rot', 'data-h': 'rot' })); }
    ov.append(box);
  }
  for (const gd of guides) ov.append(el('div', { class: 'guide ' + gd.t, style: gd.t === 'v' ? `left:${gd.p * K}px` : `top:${gd.p * K}px` }));
}
function flashLayer(id) { /* subtle pulse on edited layer */
  const lay = L(id); if (!lay || S.view !== 'single' || lay.type === 'scene') return;
  const b = bboxCss(lay); const f = el('div', { class: 'selbox flash', style: `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;transform:rotate(${b.rot}deg);border-color:transparent` });
  $('#ov').append(f); setTimeout(() => f.remove(), 650);
}

/* ------------------------------------------------------------ hit testing */
function toDesign(e) { const r = $('#art').getBoundingClientRect(); return { x: (e.clientX - r.left) / K, y: (e.clientY - r.top) / K }; }
function localPoint(G, p) {
  const cx = G.x + G.w / 2, cy = G.y + G.h / 2, a = -(G.rot || 0) * Math.PI / 180;
  const dx = p.x - cx, dy = p.y - cy; return { x: dx * Math.cos(a) - dy * Math.sin(a) + G.w / 2, y: dx * Math.sin(a) + dy * Math.cos(a) + G.h / 2 };
}
function hitTest(p) {
  for (let i = S.layers.length - 1; i >= 0; i--) {
    const l = S.layers[i]; if (!l.visible || l.type === 'scene') continue;
    const G = geom(l); const q = localPoint(G, p); const pad = 6 / K;
    if (q.x < -pad || q.y < -pad || q.x > G.w + pad || q.y > G.h + pad) continue;
    if (l.type === 'image') {
      const A = ALPHA[l.src]; if (!A) return l;
      let u = q.x / G.w; if (G.flip) u = 1 - u;
      const ax = Math.floor(u * A.w), ay = Math.floor(q.y / G.h * A.h);
      if (ax < 0 || ay < 0 || ax >= A.w || ay >= A.h || A.a[ay * A.w + ax] < 40) continue;
    }
    return l;
  }
  return null;
}

/* ------------------------------------------------------------ pointer interactions */
let drag = null;
function onDown(e) {
  if (S.view !== 'single' || e.button !== 0) return;
  const p = toDesign(e); const h = e.target.dataset && e.target.dataset.h;
  const lay = S.sel && L(S.sel);
  if (h && lay) {
    const G = geom(lay); const fr = lay.frames[S.fmt];
    drag = { mode: h === 'rot' ? 'rot' : 'scale', id: lay.id, start: p, fr0: JSON.parse(JSON.stringify(fr)), G0: G, cx: G.x + G.w / 2, cy: G.y + G.h / 2 };
  } else {
    const hit = hitTest(p);
    if (!hit) { S.sel = null; syncPanels(); requestRender(); return; }
    S.sel = hit.id; syncPanels();
    if (hit.locked) { requestRender(); return; }
    drag = { mode: 'move', id: hit.id, start: p, fr0: JSON.parse(JSON.stringify(hit.frames[S.fmt])), G0: geom(hit), moved: false };
  }
  $('#ov').setPointerCapture(e.pointerId);
  requestRender();
}
function onMove(e) {
  const p = toDesign(e);
  if (!drag) { if (S.view === 'single') { const h = hitTest(p); const nid = h ? h.id : null; if (nid !== hoverId) { hoverId = nid; renderOverlay(); } } return; }
  const lay = L(drag.id); if (!lay) return; const fr = lay.frames[S.fmt]; const F = FORMATS[S.fmt];
  if (drag.mode === 'move') {
    let dx = p.x - drag.start.x, dy = p.y - drag.start.y; if (Math.abs(dx) + Math.abs(dy) > 1) drag.moved = true;
    if (drag.moved && !drag.detached) { drag.detached = true; if (lay.props && lay.props.anchor) { detach(lay); drag.fr0 = JSON.parse(JSON.stringify(lay.frames[S.fmt])); drag.G0 = geom(lay); } }
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    guides = [];
    const G = drag.G0, th = 7 / K, m = Math.round(F.w * 0.095);
    const xs = [0, m, F.w / 2, F.w - m, F.w], ys = [0, F.h / 2, F.h, ...(F.safe ? [F.safe.top, F.h - F.safe.bottom] : [])];
    for (const l of S.layers) if (l.id !== lay.id && l.visible && l.type !== 'scene') { const g2 = geom(l); xs.push(g2.x, g2.x + g2.w); ys.push(g2.y, g2.y + g2.h); }
    if (!e.altKey) {
      const cand = [[G.x + dx, 0], [G.x + G.w / 2 + dx, G.w / 2], [G.x + G.w + dx, G.w]];
      let best = null; for (const [v] of cand) for (const t of xs) { const d = t - v; if (Math.abs(d) < th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t }; }
      if (best) { dx += best.d; guides.push({ t: 'v', p: best.t }); }
      const candY = [G.y + dy, G.y + G.h / 2 + dy, G.y + G.h + dy];
      let bY = null; for (const v of candY) for (const t of ys) { const d = t - v; if (Math.abs(d) < th && (!bY || Math.abs(d) < Math.abs(bY.d))) bY = { d, t }; }
      if (bY) { dy += bY.d; guides.push({ t: 'h', p: bY.t }); }
    }
    fr.x = drag.fr0.x + dx; fr.y = drag.fr0.y + dy; drag.dx = dx; drag.dy = dy;
  } else if (drag.mode === 'scale') {
    const d0 = Math.hypot(drag.start.x - drag.cx, drag.start.y - drag.cy), d1 = Math.hypot(p.x - drag.cx, p.y - drag.cy);
    const k = Math.max(0.08, d1 / Math.max(1, d0)); drag.k = k;
    if (fr.fs != null) { fr.fs = drag.fr0.fs * k; fr.x = drag.fr0.x; fr.y = drag.fr0.y; const G2 = geom(lay); fr.x += drag.cx - (G2.x + G2.w / 2); fr.y += drag.cy - (G2.y + G2.h / 2); }
    else { fr.w = drag.fr0.w * k; fr.h = drag.fr0.h * k; fr.x = drag.cx - fr.w / 2; fr.y = drag.cy - fr.h / 2; }
  } else if (drag.mode === 'rot') {
    let a = Math.atan2(p.y - drag.cy, p.x - drag.cx) * 180 / Math.PI + 90; if (e.shiftKey) a = Math.round(a / 15) * 15;
    if (Math.abs(a) < 2.5) a = 0; fr.rot = Math.round(a * 10) / 10; drag.a = fr.rot;
  }
  requestRender(); syncInspectorValues();
}
function onUp(e) {
  if (!drag) return; const lay = L(drag.id); const d = drag; drag = null; guides = [];
  if (lay && S.scope === 'all') {
    for (const f of FMT_KEYS) if (f !== S.fmt && lay.frames[f]) {
      const fr = lay.frames[f];
      if (d.mode === 'move' && d.moved) { fr.x += (d.dx || 0) * UNIT[f]; fr.y += (d.dy || 0) * UNIT[f]; }
      if (d.mode === 'scale' && d.k) { const G = geom(lay, f), cx = G.x + G.w / 2, cy = G.y + G.h / 2; if (fr.fs != null) { fr.fs *= d.k; const G2 = geom(lay, f); fr.x += cx - (G2.x + G2.w / 2); fr.y += cy - (G2.y + G2.h / 2); } else { fr.w *= d.k; fr.h *= d.k; fr.x = cx - fr.w / 2; fr.y = cy - fr.h / 2; } }
      if (d.mode === 'rot' && d.a != null) fr.rot = d.a;
    }
  }
  if (lay && (d.mode !== 'move' || d.moved)) { commit(`${lay.name}: ${d.mode === 'move' ? 'moved' : d.mode === 'scale' ? 'resized' : 'rotated'}`); syncPanels(); }
  requestRender();
}
function onDbl(e) {
  const p = toDesign(e); const hit = hitTest(p); if (!hit || !hit.props || !('text' in hit.props) || hit.locked) return;
  S.sel = hit.id; syncPanels(); inlineEdit(hit);
}
function inlineEdit(lay) {
  const b = bboxCss(lay); const ta = el('textarea', { class: 'edit-ta', dir: S.lang === 'ar' ? 'rtl' : 'ltr' });
  ta.value = S.lang === 'ar' ? lay.props.textAr : lay.props.text;
  Object.assign(ta.style, { left: b.x - 4 + 'px', top: b.y - 4 + 'px', width: Math.max(220, b.w + 16) + 'px', height: Math.max(44, b.h + 16) + 'px' });
  $('#art').append(ta); ta.focus(); ta.select();
  const done = ok => { if (ok && ta.value.trim()) { applyOp({ action: 'set_text', target: lay.id, params: { text: ta.value, lang: S.lang } }); commit(`${lay.name}: text`); syncPanels(); } ta.remove(); requestRender(); };
  ta.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); done(true); } if (ev.key === 'Escape') done(false); ev.stopPropagation(); });
  ta.addEventListener('blur', () => done(true), { once: true });
}

/* ------------------------------------------------------------ panels */
function syncChrome() {
  $$('#fmtTabs button').forEach(b => b.classList.toggle('on', b.dataset.f === S.fmt && S.view === 'single'));
  $$('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
  $$('[data-lang]').forEach(b => b.classList.toggle('on', b.dataset.lang === S.lang));
  $$('[data-scope]').forEach(b => b.classList.toggle('on', b.dataset.scope === S.scope));
  $('#btnSafe').classList.toggle('on', S.safe);
  $('#art').hidden = S.view !== 'single' || !$('#compareView').hidden;
  $('#gridView').hidden = S.view !== 'grid';
  $('#btnUndo').disabled = H.pos <= 0; $('#btnRedo').disabled = H.pos >= H.stack.length - 1;
}
function buildFmtTabs() {
  const n = $('#fmtTabs'); n.innerHTML = '';
  for (const f of FMT_KEYS) n.append(el('button', { 'data-f': f, onclick: () => { S.fmt = f; S.view = 'single'; closeCompare(); syncChrome(); syncPanels(); requestRender(); } }, FORMATS[f].label, el('small', {}, FORMATS[f].ratio)));
}
function layerThumb(l) {
  if (l.type === 'image') { const i = el('img', { alt: '' }); i.src = ASSET_SRC[l.src]; return el('span', { class: 'lt' }, i); }
  if (l.type === 'scene') { const i = el('img', { alt: '', style: 'object-fit:cover' }); i.src = (SCENES[S.sceneId] || SCENES.base).src; return el('span', { class: 'lt' }, i); }
  if (l.type === 'button') return el('span', { class: 'lt', html: '<svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="8" rx="3"/></svg>' });
  return el('span', { class: 'lt' }, el('b', {}, 'Aa'));
}
function syncLayers() {
  const ol = $('#layers'); ol.innerHTML = '';
  $('#layerCount').textContent = S.layers.length;
  [...S.layers].reverse().forEach(l => {
    const li = el('li', { class: (l.id === S.sel ? 'on ' : '') + (l.visible ? '' : 'off'), onclick: () => { S.sel = l.type === 'scene' ? 'scene' : l.id; syncPanels(); requestRender(); },
      onmouseenter: () => { hoverId = l.id; renderOverlay(); }, onmouseleave: () => { hoverId = null; renderOverlay(); } },
      layerThumb(l), el('span', { class: 'ln' }, l.name), l.brand ? el('span', { class: 'lk', title: 'Brand-locked: never regenerated or restyled' }, 'BRAND') : null,
      el('span', { class: 'li-b' },
        el('button', { title: l.visible ? 'Hide' : 'Show', html: l.visible ? ICON.eye : ICON.eyeOff, onclick: ev => { ev.stopPropagation(); run([{ action: l.visible ? 'hide' : 'show', target: l.id }], 'panel'); } }),
        el('button', { title: l.locked ? 'Unlock' : 'Lock', html: l.locked ? ICON.lock : ICON.unlock, onclick: ev => { ev.stopPropagation(); run([{ action: l.locked ? 'unlock' : 'lock', target: l.id }], 'panel'); } })));
    ol.append(li);
  });
}
function ago(t) { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? s + 's' : Math.round(s / 60) + 'm'; }
function syncHistory() {
  const ol = $('#history'); ol.innerHTML = '';
  H.stack.map((h, i) => ({ h, i })).reverse().forEach(({ h, i }) => ol.append(el('li', { class: (i === H.pos ? 'on' : '') + (i > H.pos ? ' future' : ''), title: 'Jump to this step', onclick: () => { jumpTo(i); syncPanels(); requestRender(); } }, el('span', {}, h.label), el('time', {}, ago(h.t)))));
}

/* inspector */
const SWATCH = [CREAM, '#FCECD6', '#FFFFFF', '#0E0B09', '#3E2315', '#E8B26A', '#D4A64A', '#F07F1A', '#C8102E', '#7DBA2F', '#4F9A2B', '#6B2FA3'];
function fld(label, input, full) { return el('label', { class: 'f' + (full ? ' full' : '') }, el('span', {}, label), input); }
function num(val, on, step = 1) { const i = el('input', { type: 'number', step, value: Math.round(val * 100) / 100 }); i.addEventListener('change', () => on(+i.value)); return i; }
function colorField(val, on) {
  const c = el('input', { type: 'color', value: toHex6(val) }); const t = el('input', { type: 'text', value: val });
  c.addEventListener('input', () => { t.value = c.value.toUpperCase(); on(c.value.toUpperCase(), true); });
  c.addEventListener('change', () => on(c.value.toUpperCase()));
  t.addEventListener('change', () => on(t.value));
  const sw = el('div', { class: 'sw' }, SWATCH.map(s => el('button', { title: s, style: `background:${s}`, onclick: e => { e.preventDefault(); on(s); } })));
  return el('div', {}, el('div', { class: 'colr' }, c, t), sw);
}
function toHex6(v) { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = v || '#000'; const s = c.fillStyle; return s.startsWith('#') ? s : '#000000'; }
function toggles(opts, cur, on) { return el('div', { class: 'tg' }, opts.map(([v, lab]) => el('button', { class: v === cur ? 'on' : '', onclick: e => { e.preventDefault(); on(v); } }, lab))); }
function range(val, min, max, on) { const r = el('input', { type: 'range', min, max, value: val }); r.addEventListener('input', () => on(+r.value, true)); r.addEventListener('change', () => on(+r.value)); return r; }
function edit(ops, label, live) { // live = preview only, no history
  try { ops.forEach(applyOp); } catch (e) { toast(e.message); return; }
  if (!live) { commit(label); syncPanels(); }
  requestRender();
}

function syncInspector() {
  const box = $('#insp'); box.innerHTML = '';
  const lay = S.sel && L(S.sel);
  if (!lay) {
    box.append(el('div', { class: 'empty' },
      el('p', {}, 'Click anything on the design, or just say what to change.'),
      el('div', { class: 'kb' },
        el('kbd', {}, 'M'), el('span', {}, 'Hold to talk'), el('kbd', {}, '/'), el('span', {}, 'Type a command'),
        el('kbd', {}, '↑↓←→'), el('span', {}, 'Nudge (Shift ×10)'), el('kbd', {}, 'Del'), el('span', {}, 'Hide layer'),
        el('kbd', {}, 'Ctrl Z'), el('span', {}, 'Undo'), el('kbd', {}, 'Ctrl D'), el('span', {}, 'Duplicate'),
        el('kbd', {}, '[ ]'), el('span', {}, 'Send back / forward'), el('kbd', {}, 'Dbl-click'), el('span', {}, 'Edit text in place'))));
    return;
  }
  const id = lay.id; const fr = lay.frames[S.fmt]; const G = geom(lay);
  box.append(el('div', { class: 'ih' }, layerThumb(lay), el('b', {}, lay.name), lay.brand ? el('span', { class: 'lk' }, 'BRAND') : null));
  if (lay.brand) box.append(el('div', { class: 'lockcard' }, 'Brand-locked. The tin can move, scale or hide, but its pixels are never regenerated or restyled.'));

  if (lay.type === 'scene') {
    const p = lay.props; const s = el('div', { class: 'sec' }, el('h4', {}, 'Photography'));
    const g = el('div', { class: 'fg' });
    for (const [k, lab, mn, mx] of [['bright', 'Brightness', -60, 60], ['contrast', 'Contrast', -50, 50], ['sat', 'Saturation', -80, 80], ['warm', 'Warmth', -100, 100], ['vignette', 'Vignette', 0, 100], ['blur', 'Depth blur', 0, 100]])
      g.append(fld(lab, range(p[k] || 0, mn, mx, (v, live) => edit([{ action: 'scene_adjust', params: { [k]: v } }], `Background: ${lab.toLowerCase()}`, live))));
    s.append(g); box.append(s);
    const ai = el('div', { class: 'sec' }, el('h4', {}, 'Change the scene'));
    const inp = el('input', { type: 'text', placeholder: 'e.g. add soft moonlight fog behind the table' });
    ai.append(el('div', { class: 'f full' }, el('div', { class: 'ai-row' }, inp, el('button', { class: 'pill solid', onclick: () => inp.value.trim() && run([{ action: 'ai_background', params: { prompt: inp.value.trim() } }], 'panel') }, 'Apply'))));
    ai.append(el('p', { class: 'note' }, 'Only the background plate changes. Product and type stay untouched on their own layers.'));
    if (S.sceneId !== 'base') ai.append(el('button', { class: 'pill ghost', onclick: () => { S.sceneId = 'base'; commit('Background: original'); syncPanels(); requestRender(); } }, 'Restore original background'));
    box.append(ai);
    return;
  }

  // geometry
  const sg = el('div', { class: 'sec' }, el('h4', {}, 'Position & size'));
  const gg = el('div', { class: 'fg' });
  gg.append(fld('X', num(G.x, v => edit([{ action: 'move_to', target: id, params: { x: v } }], `${lay.name}: position`))));
  gg.append(fld('Y', num(G.y, v => edit([{ action: 'move_to', target: id, params: { y: v } }], `${lay.name}: position`))));
  if (fr.fs != null) gg.append(fld('Font size', num(fr.fs, v => edit([{ action: 'style', target: id, params: { size: v } }], `${lay.name}: size`), 0.5)));
  else gg.append(fld('Width', num(G.w, v => edit([{ action: 'scale', target: id, params: { factor: v / G.w } }], `${lay.name}: size`))));
  gg.append(fld('Rotation', num(G.rot || 0, v => edit([{ action: 'rotate', target: id, params: { angle: v } }], `${lay.name}: rotation`), 0.5)));
  gg.append(fld('Opacity', range(Math.round(lay.opacity * 100), 0, 100, (v, live) => edit([{ action: 'opacity', target: id, params: { value: v / 100 } }], `${lay.name}: opacity`, live)), true));
  gg.append(el('div', { class: 'f full' }, el('span', {}, 'Align'), toggles([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], null, v => edit([{ action: 'align', target: id, params: { h: v } }], `${lay.name}: align ${v}`))));
  sg.append(gg); box.append(sg);

  if (lay.props && 'text' in lay.props) {
    const p = lay.props; const ts = el('div', { class: 'sec' }, el('h4', {}, lay.type === 'button' ? 'Label' : 'Text'));
    const tg = el('div', { class: 'fg' });
    const en = el('textarea', { rows: lay.type === 'button' ? 1 : 2 }); en.value = p.text;
    en.addEventListener('change', () => edit([{ action: 'set_text', target: id, params: { text: en.value, lang: 'en' } }], `${lay.name}: text`));
    const ar = el('textarea', { rows: lay.type === 'button' ? 1 : 2, dir: 'rtl' }); ar.value = p.textAr || '';
    ar.addEventListener('change', () => edit([{ action: 'set_text', target: id, params: { text: ar.value, lang: 'ar' } }], `${lay.name}: Arabic text`));
    tg.append(fld('English', en, true), fld('Arabic', ar, true));
    if (!lay.brand) {
      const fs = el('select'); for (const k of FONT_KEYS_EN) fs.append(el('option', { value: k, selected: p.font === k }, FONTS[k].family));
      fs.addEventListener('change', () => edit([{ action: 'style', target: id, params: { font: fs.value } }], `${lay.name}: font`));
      const ws = el('select'); const nearW = [300, 400, 500, 600, 700, 800].reduce((a, b) => Math.abs(b - p.weight) < Math.abs(a - p.weight) ? b : a); for (const w of [300, 400, 500, 600, 700, 800]) ws.append(el('option', { value: w, selected: nearW === w }, { 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Heavy' }[w]));
      ws.addEventListener('change', () => edit([{ action: 'style', target: id, params: { weight: +ws.value } }], `${lay.name}: weight`));
      tg.append(fld('Font', fs), fld('Weight', ws));
      tg.append(fld('Tracking', num(p.tracking || 0, v => edit([{ action: 'style', target: id, params: { tracking: v } }], `${lay.name}: tracking`), 0.01)));
      if (lay.type === 'text') tg.append(fld('Line height', num(p.lh || 1.2, v => edit([{ action: 'style', target: id, params: { lineHeight: v } }], `${lay.name}: line height`), 0.01)));
      tg.append(el('div', { class: 'f full' }, el('span', {}, 'Case & style'), toggles([['upper', 'AA'], ['italic', 'Italic'], ['shadow', 'Shadow'], ['glow', 'Glow']], null, v => {
        const cur = v === 'upper' ? p.upper : v === 'italic' ? p.italic : !!(lay.fx || {})[v];
        edit([{ action: 'style', target: id, params: { [v]: !cur } }], `${lay.name}: ${v}`);
      })));
      tg.append(fld(lay.type === 'button' ? 'Label colour' : 'Colour', colorField(p.color, (v, live) => edit([{ action: 'style', target: id, params: lay.type === 'button' ? { fg: v } : { color: v } }], `${lay.name}: colour`, live)), true));
    }
    ts.append(tg); box.append(ts);
  }
  if (lay.type === 'button') {
    const p = lay.props; const bs = el('div', { class: 'sec' }, el('h4', {}, 'Button'));
    const bg = el('div', { class: 'fg' });
    bg.append(el('div', { class: 'f full' }, el('span', {}, 'Style'), toggles([['solid', 'Solid'], ['outline', 'Outline'], ['glass', 'Glass']], p.style, v => edit([{ action: 'style', target: id, params: { buttonStyle: v } }], `Button: ${v}`))));
    bg.append(fld('Fill', colorField(p.bg, (v, live) => edit([{ action: 'style', target: id, params: { bg: v } }], 'Button: fill', live)), true));
    bg.append(fld('Corner', range(Math.round(p.radius * 50), 0, 100, (v, live) => edit([{ action: 'style', target: id, params: { radius: v / 50 } }], 'Button: corners', live))));
    bg.append(fld('Padding', range(Math.round(p.padX * 50), 20, 120, (v, live) => edit([{ action: 'style', target: id, params: { padX: v / 50 } }], 'Button: padding', live))));
    bg.append(el('div', { class: 'f full' }, el('span', {}, 'Arrow'), toggles([[true, 'On'], [false, 'Off']], !!p.arrow, v => edit([{ action: 'style', target: id, params: { arrow: v } }], 'Button: arrow'))));
    bs.append(bg); box.append(bs);
  }
  if (lay.type === 'image') {
    const is = el('div', { class: 'sec' }, el('h4', {}, 'Effects'));
    is.append(toggles([['shadow', 'Drop shadow'], ['glow', 'Glow'], ['flip', 'Flip']], null, v => {
      if (v === 'flip') return edit([{ action: 'flip', target: id }], `${lay.name}: flip`);
      edit([{ action: 'style', target: id, params: { [v]: !(lay.fx || {})[v] } }], `${lay.name}: ${v}`);
    }));
    box.append(is);
  }
  const act = el('div', { class: 'sec' }, el('h4', {}, 'Layer'));
  act.append(toggles([['duplicate', 'Duplicate'], ['bring_forward', 'Forward'], ['send_backward', 'Backward'], ['reset', 'Reset'], ['delete', 'Delete']], null, v => { if (v === 'delete' && lay.brand) return toast('The product stays. Hide it instead.'); edit([{ action: v, target: id }], `${lay.name}: ${v.replace('_', ' ')}`); }));
  if (lay.props && 'text' in lay.props && !lay.brand) act.append(el('div', { class: 'row' }, el('button', { class: 'pill ghost', onclick: () => runCommand(`give me 6 alternative ${lay.type === 'button' ? 'button labels' : lay.name.toLowerCase()} options`, 'panel') }, 'Variants…')));
  box.append(act);
}
function syncInspectorValues() { /* cheap refresh during drags: re-render inspector at most every 120ms */
  clearTimeout(syncInspectorValues.t); syncInspectorValues.t = setTimeout(syncInspector, 120);
}
function syncPanels() { syncChrome(); syncLayers(); syncHistory(); syncInspector(); }

/* ------------------------------------------------------------ command pipeline */
function friendlyErr(e) {
  const m = String(e && e.message || e || '');
  if (/no-key/.test(m)) return 'Add an assistant key in Settings.';
  if (/\b429\b|quota/i.test(m)) return 'This feature needs billing enabled on the account.';
  if (/\b503\b|overloaded|high demand/i.test(m)) return 'Assistant is busy. Try again in a moment.';
  if (/\b40[13]\b/.test(m)) return 'The assistant key was rejected.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Network error. Check the connection.';
  return m.replace(/gemini[\w.\-]*:?\s*/gi, '').slice(0, 120);
}
function feedback(items, src) {
  const fb = $('#feedback'); fb.innerHTML = '';
  if (src) fb.append(el('span', { class: 'src' }, src));
  for (const it of items) fb.append(typeof it === 'string' ? el('span', { class: 'reply' }, it) : el('span', { class: 'chip ' + (it.err ? 'err' : 'ok') }, it.t));
}
const UI_ACTIONS = new Set(['ai_background', 'variants', 'brand_check', 'export', 'compare']);
async function run(ops, source = 'panel', reply) {
  const chips = []; let changed = false; const touched = new Set();
  for (const op of ops) {
    try {
      if (UI_ACTIONS.has(op.action)) { await uiAction(op); chips.push({ t: op.action.replace('_', ' ') }); continue; }
      const label = applyOp(op); chips.push({ t: label }); changed = true;
      const t = op.target && resolveTarget(op.target); if (t) touched.add(t.id);
    } catch (e) { chips.push({ t: friendlyErr(e), err: true }); }
  }
  if (changed) { const lab = chips.filter(c => !c.err).map(c => c.t).slice(0, 2).join(' · ') || 'Edit'; if (!['undo', 'redo'].includes(ops[0]?.action)) commit(lab); }
  syncPanels(); requestRender();
  setTimeout(() => touched.forEach(flashLayer), 30);
  if (source !== 'panel') feedback([reply, ...chips].filter(Boolean), source);
  return chips;
}
async function runCommand(text, source = 'you') {
  text = (text || '').trim(); if (!text) return;
  const fb = $('#feedback'); fb.innerHTML = ''; fb.append(el('span', { class: 'src' }, source), el('span', { class: 'thinking' }, el('i'), el('i'), el('i')), el('span', { class: 'reply', style: 'color:var(--muted)' }, text));
  if (CFG.key) {
    try {
      const out = await understand(text);
      if (out.ops && out.ops.length) return run(out.ops, source, out.reply);
      feedback([out.reply || 'Nothing to change.'], source); return;
    } catch (e) {
      console.warn('assistant', e);
      const ops = quickParse(text);
      if (ops.length) return run(ops, source, 'Applied with quick commands (assistant unreachable).');
      feedback([{ t: friendlyErr(e), err: true }], source); return;
    }
  }
  const ops = quickParse(text);
  if (ops.length) return run(ops, source);
  feedback([{ t: 'Not sure what to change. Add an assistant key in Settings for free-form requests.', err: true }], source);
}

async function uiAction(op) {
  const p = op.params || {};
  if (op.action === 'brand_check') return openGuard();
  if (op.action === 'compare') return toggleCompare();
  if (op.action === 'export') return doExport(p.kind || 'zip');
  if (op.action === 'variants') return openVariants(op);
  if (op.action === 'ai_background') {
    busy(true, 'Rebuilding the background plate…');
    try { const id = await editBackground(p.prompt || ''); S.sceneId = id; commit('Background: ' + (p.prompt || 'new scene').slice(0, 40)); }
    finally { busy(false); }
  }
}

/* variants */
function openVariants(op) {
  const p = op.params || {}; const t = resolveTarget(op.target) || L('headline'); const opts = (p.options || []).filter(Boolean).slice(0, 12);
  if (!opts.length) throw new Error('No variants returned');
  const field = p.field || 'text';
  $('#varTitle').textContent = `${t.name} · ${opts.length} options`;
  const body = $('#varBody'); body.innerHTML = '';
  const snap = snapshot();
  for (const o of opts) {
    const ops = field === 'text' ? [{ action: 'set_text', target: t.id, params: { text: o, lang: /[؀-ۿ]/.test(o) ? 'ar' : S.lang } }] : [{ action: 'style', target: t.id, params: field === 'bg' || t.type === 'button' ? { bg: o } : { color: o } }];
    try { ops.forEach(applyOp); } catch (e) {}
    const F = FORMATS[S.fmt]; const c = renderToCanvas(S.fmt, 320 / F.w);
    restore(snap);
    body.append(el('figure', { onclick: () => { closeModals(); run(ops, 'variants'); } }, c, el('figcaption', {}, field === 'text' ? o.replace(/\n/g, ' ') : o)));
  }
  $('#varModal').hidden = false;
}

/* brand guard */
function luminance(r, g, b) { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
function contrastAt(fmt, layer) {
  const snapVis = layer.visible; const G = geom(layer, fmt); const F = FORMATS[fmt];
  const c = document.createElement('canvas'); c.width = F.w / 2; c.height = F.h / 2; const g = c.getContext('2d', { willReadFrequently: true });
  layer.visible = false; renderFormat(g, fmt, 0.5); layer.visible = snapVis;
  const x = Math.max(0, Math.floor(G.x / 2)), y = Math.max(0, Math.floor(G.y / 2)), w = Math.max(1, Math.min(c.width - x, Math.ceil(G.w / 2))), h = Math.max(1, Math.min(c.height - y, Math.ceil(G.h / 2)));
  const d = g.getImageData(x, y, w, h).data; let r = 0, gg = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 16) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
  const bgL = luminance(r / n, gg / n, b / n);
  const col = layer.props.color; const fg = rgb(col); const fgL = luminance(fg.r, fg.g, fg.b);
  let base = bgL; if (layer.type === 'button' && layer.props.style === 'solid') { const bb = rgb(layer.props.bg); base = luminance(bb.r, bb.g, bb.b); }
  return (Math.max(base, fgL) + 0.05) / (Math.min(base, fgL) + 0.05);
}
function brandCheck() {
  const res = []; const add = (st, title, detail, fix) => res.push({ st, title, detail, fix });
  const vis = l => l && l.visible;
  const allText = S.layers.filter(l => vis(l) && l.props && 'text' in l.props).map(l => (S.lang === 'ar' ? l.props.textAr : l.props.text) || '').join(' ');
  const prod = S.layers.find(l => l.brand);
  add(vis(prod) ? 'pass' : 'fail', 'Product visible', vis(prod) ? 'Al Fakher Two Apples tin is on every size, untouched.' : 'The tin is hidden.', vis(prod) ? null : () => run([{ action: 'show', target: prod.id }]));
  if (vis(prod)) { const G = geom(prod, 'feed'); const share = (G.w * G.h) / (1080 * 1350); add(share > 0.08 ? 'pass' : 'warn', 'Product presence', `Tin covers ${Math.round(share * 100)}% of the feed frame.`, share > 0.08 ? null : () => run([{ action: 'scale', target: prod.id, params: { factor: 1.25 } }])); }
  add(/SHISHA/.test(allText) ? 'pass' : 'fail', 'Coupon code SHISHA', /SHISHA/.test(allText) ? 'Present.' : 'Missing from all text layers.');
  add(/shisha-test\.com/i.test(allText) ? 'pass' : 'fail', 'Website shisha-test.com', /shisha-test\.com/i.test(allText) ? 'Present.' : 'Missing.');
  const btn = S.layers.find(l => l.type === 'button');
  add(vis(btn) ? 'pass' : 'fail', 'CTA button', vis(btn) ? `“${btn.props.text}”` : 'Hidden or removed.', vis(btn) ? null : () => run([{ action: 'show', target: btn.id }]));
  const offer = vis(L('apple_carved')) || /30\s?%/.test(allText);
  add(offer ? 'pass' : 'fail', 'Offer 30% visible', offer ? (vis(L('apple_carved')) ? 'Carved into the hero apple.' : 'In the copy.') : 'The 30% is not visible anywhere.', offer ? null : () => run([{ action: 'show', target: 'apple_carved' }]));
  for (const f of FMT_KEYS) {
    const F = FORMATS[f];
    for (const l of S.layers) {
      if (!vis(l) || !(l.type === 'text' || l.type === 'button')) continue;
      const G = geom(l, f);
      if (G.x < 0 || G.y < 0 || G.x + G.w > F.w || G.y + G.h > F.h) add('fail', `${l.name} cut off · ${F.label}`, 'Part of it falls outside the frame.', () => { const prev = S.fmt; S.fmt = f; run([{ action: 'align', target: l.id, scope: 'current', params: { h: 'left' } }]); S.fmt = prev; });
      else if (F.safe && (G.y < F.safe.top || G.y + G.h > F.h - F.safe.bottom)) add('warn', `${l.name} in Story UI zone`, 'Instagram covers this area with profile or reply bar.', () => { const prev = S.fmt; S.fmt = f; run([{ action: 'align', target: l.id, scope: 'current', params: { v: G.y < F.safe.top ? 'top' : 'bottom' } }]); S.fmt = prev; });
      const fs = l.frames[f].fs; if (fs != null && fs * (1080 / F.w) < 16) add('warn', `${l.name} small · ${F.label}`, `${Math.round(fs)}px may be hard to read on a phone.`, () => { const prev = S.fmt; S.fmt = f; run([{ action: 'scale', target: l.id, scope: 'current', params: { factor: 18 / fs } }]); S.fmt = prev; });
    }
  }
  for (const l of S.layers) {
    if (!vis(l) || !(l.type === 'text' || l.type === 'button')) continue;
    const cr = contrastAt('feed', l);
    const big = l.type === 'text' && l.frames.feed.fs >= 36;
    const need = big ? 3 : 4.5;
    add(cr >= need ? 'pass' : (cr >= 2.5 ? 'warn' : 'fail'), `Contrast · ${l.name}`, `${cr.toFixed(1)}:1 (needs ${need}:1)`, cr >= need ? null : () => run([{ action: 'style', target: l.id, params: { shadow: true } }]));
  }
  return res;
}
function openGuard() {
  const res = brandCheck(); const pass = res.filter(r => r.st === 'pass').length; const body = $('#guardBody'); body.innerHTML = '';
  body.append(el('div', { class: 'gscore' }, el('b', {}, `${pass}/${res.length}`), el('span', {}, res.some(r => r.st === 'fail') ? 'Fix the red items before export.' : res.some(r => r.st === 'warn') ? 'Ready, with notes.' : 'Ready to export on every size.')));
  const ul = el('ul', { class: 'gl' });
  const order = { fail: 0, warn: 1, pass: 2 };
  res.sort((a, b) => order[a.st] - order[b.st]).forEach(r => ul.append(el('li', { class: r.st }, el('span', { class: 'st' }, r.st.toUpperCase()), el('p', {}, r.title, el('small', {}, r.detail)), r.fix ? el('button', { class: 'pill ghost', onclick: () => { r.fix(); openGuard(); } }, 'Fix') : null)));
  body.append(ul); $('#guardModal').hidden = false;
}

/* compare */
function toggleCompare() {
  const cv = $('#compareView');
  if (!cv.hidden) return closeCompare();
  if (!H.pinned) { H.pinned = H.stack[0] ? H.stack[0].snap : snapshot(); toast('Comparing with the original. Use “Pin as A” to choose another version.'); }
  S.view = 'single'; cv.hidden = false; $('#btnCompare').classList.add('on'); syncChrome(); drawCompare();
}
function closeCompare() { $('#compareView').hidden = true; $('#btnCompare').classList.remove('on'); syncChrome(); }
function drawCompare() {
  const F = FORMATS[S.fmt]; const st = $('#stage'); const h = Math.min(st.clientHeight - 80, (st.clientWidth - 90) / 2 * F.h / F.w); const sc = h / F.h * dpr;
  const now = snapshot();
  for (const [id, snap] of [['#cvA', H.pinned], ['#cvB', now]]) {
    restore(snap); const c = $(id); c.width = Math.round(F.w * sc); c.height = Math.round(F.h * sc); c.style.width = c.width / dpr + 'px'; c.style.height = c.height / dpr + 'px';
    renderFormat(c.getContext('2d'), S.fmt, sc);
  }
  restore(now);
}

/* export */
async function doExport(kind) {
  $('#exportMenu').hidden = true;
  const res = brandCheck(); const fails = res.filter(r => r.st === 'fail');
  if (fails.length) toast(`Heads-up: ${fails.length} brand check item(s) failing.`, 3000);
  busy(true, 'Exporting…');
  try {
    if (kind === 'png') await exportPNG(S.fmt, 1);
    else if (kind === 'png2') await exportPNG(S.fmt, 2);
    else if (kind === 'zip') await exportZIP();
    else if (kind === 'psd') await exportPSD(S.fmt);
    else if (kind === 'psdall') await exportPSDAll();
  } catch (e) { console.error(e); toast('Export failed: ' + e.message, 4000); }
  finally { busy(false); }
}

function closeModals() { $$('.modal').forEach(m => m.hidden = true); }

/* ------------------------------------------------------------ voice */
function startVoice() {
  if (Voice.on) return;
  const btn = $('#btnMic'), inp = $('#cmdIn');
  try {
    Voice.start(t => { inp.value = t; inp.dir = /[؀-ۿ]/.test(t) ? 'rtl' : 'ltr'; }, t => { inp.value = ''; runCommand(t, 'voice'); }, err => { btn.classList.remove('live'); if (err && err !== 'no-speech' && err !== 'aborted') toast('Mic: ' + err); });
    btn.classList.add('live');
  } catch (e) { toast(e.message); }
}
function stopVoice() { Voice.stop(); }

/* ------------------------------------------------------------ live feed */
function addHeard(msg) {
  const box = $('#heard'); box.hidden = false;
  const item = el('div', { class: 'hi' }, el('span', { class: 'who' }, msg.who || 'Client'), el('p', {}, msg.en || '', msg.ar ? el('small', { dir: 'rtl' }, msg.ar) : null),
    el('button', { class: 'pill solid', onclick: () => { runCommand(msg.en || msg.ar, 'client'); item.remove(); if (!box.children.length) box.hidden = true; } }, 'Apply'),
    el('button', { class: 'ib', title: 'Dismiss', html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>', onclick: () => { item.remove(); if (!box.children.length) box.hidden = true; } }));
  box.prepend(item); while (box.children.length > 6) box.lastChild.remove();
}
if (LIVE) LIVE.onmessage = e => { const m = e.data || {}; if (m.type === 'client_said' || m.type === 'action_item') addHeard(m); if (m.type === 'apply') runCommand(m.en, 'client'); };

/* ------------------------------------------------------------ wiring */
function wire() {
  const ov = $('#ov');
  ov.addEventListener('pointerdown', onDown); ov.addEventListener('pointermove', onMove); ov.addEventListener('pointerup', onUp); ov.addEventListener('pointercancel', onUp);
  ov.addEventListener('dblclick', onDbl);
  ov.addEventListener('pointerleave', () => { if (!drag && hoverId) { hoverId = null; renderOverlay(); } });
  $$('[data-view]').forEach(b => b.onclick = () => { S.view = b.dataset.view; closeCompare(); syncChrome(); requestRender(); });
  $$('[data-lang]').forEach(b => b.onclick = () => { run([{ action: 'set_language', params: { lang: b.dataset.lang } }], 'panel'); });
  $$('[data-scope]').forEach(b => b.onclick = () => { S.scope = b.dataset.scope; syncChrome(); });
  $('#btnUndo').onclick = () => { if (undo()) { syncPanels(); requestRender(); } };
  $('#btnRedo').onclick = () => { if (redo()) { syncPanels(); requestRender(); } };
  $('#btnSafe').onclick = () => { S.safe = !S.safe; if (S.safe && !FORMATS[S.fmt].safe) { S.fmt = 'story'; } syncChrome(); requestRender(); };
  $('#btnCompare').onclick = toggleCompare;
  $('#btnReset').onclick = () => { run([{ action: 'reset_all' }], 'panel'); toast('Back to the original design.'); };
  $('#btnPin').onclick = () => { H.pinned = snapshot(); toast('Pinned as A. Keep editing, then hit Compare.'); };
  $('#btnGuard').onclick = openGuard;
  $('#btnExport').onclick = e => { e.stopPropagation(); $('#exportMenu').hidden = !$('#exportMenu').hidden; };
  $$('#exportMenu [data-exp]').forEach(b => b.onclick = () => doExport(b.dataset.exp));
  document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) $('#exportMenu').hidden = true; });
  $$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) m.hidden = true; }));
  $('#btnSettings').onclick = () => { $('#keyIn').value = CFG.key; $('#keyStatus').textContent = CFG.key ? 'Key saved' : 'No key'; $('#setModal').hidden = false; };
  $('#btnSaveKey').onclick = () => { CFG.key = $('#keyIn').value.trim(); $('#keyStatus').textContent = 'Saved'; };
  $('#btnTestKey').onclick = async () => { $('#btnSaveKey').click(); $('#keyStatus').textContent = 'Testing…'; try { const t0 = performance.now(); await understand('select the button'); $('#keyStatus').textContent = `Working · ${Math.round(performance.now() - t0)} ms`; } catch (e) { $('#keyStatus').textContent = 'Failed: ' + friendlyErr(e); } };
  // command bar
  const inp = $('#cmdIn');
  inp.addEventListener('input', () => { inp.dir = /[؀-ۿ]/.test(inp.value) ? 'rtl' : 'ltr'; });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const v = inp.value; inp.value = ''; runCommand(v, 'you'); } e.stopPropagation(); });
  $('#btnSend').onclick = () => { const v = inp.value; inp.value = ''; runCommand(v, 'you'); };
  const mic = $('#btnMic'); let micHold = 0;
  mic.addEventListener('pointerdown', () => { micHold = Date.now(); if (Voice.on) { stopVoice(); } else startVoice(); });
  mic.addEventListener('pointerup', () => { if (Date.now() - micHold > 450) stopVoice(); });
  $('#btnMicLang').onclick = () => { Voice.lang = Voice.lang === 'en-US' ? 'ar-EG' : 'en-US'; $('#btnMicLang').textContent = Voice.lang === 'en-US' ? 'EN' : 'ع'; };
  // keyboard
  let mDown = false;
  document.addEventListener('keydown', e => {
    if (e.target.closest('input,textarea,select')) return;
    const lay = S.sel && L(S.sel); const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') { closeModals(); S.sel = null; syncPanels(); requestRender(); return; }
    if ((e.key === 'm' || e.key === 'M') && !mod && !e.repeat) { mDown = true; startVoice(); return; }
    if (e.key === '/') { e.preventDefault(); inp.focus(); return; }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? redo() : undo()) && (syncPanels(), requestRender()); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() && (syncPanels(), requestRender()); return; }
    if (!lay || lay.type === 'scene') return;
    const step = e.shiftKey ? 10 : 1;
    const arrows = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
    if (arrows[e.key] && !lay.locked) { e.preventDefault(); applyOp({ action: 'move_by', target: lay.id, params: { dx: arrows[e.key][0], dy: arrows[e.key][1] } }); clearTimeout(wire.nt); wire.nt = setTimeout(() => { commit(`${lay.name}: nudged`); syncHistory(); }, 500); requestRender(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); run([{ action: 'hide', target: lay.id }], 'panel'); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); run([{ action: 'duplicate', target: lay.id }], 'panel'); return; }
    if (e.key === ']') run([{ action: 'bring_forward', target: lay.id }], 'panel');
    if (e.key === '[') run([{ action: 'send_backward', target: lay.id }], 'panel');
  });
  document.addEventListener('keyup', e => { if ((e.key === 'm' || e.key === 'M') && mDown) { mDown = false; stopVoice(); } });
  new ResizeObserver(() => { requestRender(); if (!$('#compareView').hidden) drawCompare(); }).observe($('#stage'));
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener?.('change', () => { dpr = Math.min(2, window.devicePixelRatio || 1); requestRender(); });
}

async function boot() {
  busy(true, 'Loading studio…');
  try {
    await loadAssets();
    const fams = [['Newsreader', [300, 400, 500, 600, 700]], ['Inter', [300, 400, 500, 600, 700, 800]], ['Instrument Serif', [400]], ['Playfair Display', [400, 600, 800]], ['DM Serif Display', [400]], ['Space Grotesk', [400, 500, 700]], ['Amiri', [400, 700]], ['IBM Plex Sans Arabic', [300, 400, 500, 600, 700]]];
    await Promise.race([Promise.all(fams.flatMap(([f, ws]) => ws.map(w => document.fonts.load(`${w} 40px "${f}"`, f.includes('Arab') || f === 'Amiri' ? 'نص' : 'Aa')))), new Promise(r => setTimeout(r, 6000))]);
    await document.fonts.ready;
  } catch (e) { console.error(e); toast('Some assets failed to load. Refresh to retry.', 5000); }
  try { const saved = new URLSearchParams(location.search).has('fresh') ? null : localStorage.getItem('tas.state'); if (saved) { const o = JSON.parse(saved); if (Array.isArray(o.layers) && o.layers.find(l => l.id === 'scene')) { S.layers = o.layers; S.sceneId = SCENES[o.sceneId] ? o.sceneId : 'base'; } } } catch (e) {}
  H.stack = [{ label: 'Original design', snap: JSON.stringify({ layers: INITIAL, sceneId: 'base' }), t: Date.now() }]; H.pos = 0;
  if (snapshot() !== H.stack[0].snap) commit('Restored last session');
  buildFmtTabs(); wire(); syncPanels(); requestRender();
  busy(false);
  window.__studioReady = true;
}
boot();
