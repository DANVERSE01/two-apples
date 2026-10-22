/* render.js — single renderer for preview + export (WYSIWYG) */
'use strict';

const MEASURE = document.createElement('canvas').getContext('2d');

function fontFamily(layer) {
  const p = layer.props;
  const key = S.lang === 'ar' ? (p.fontAr || 'arSans') : p.font;
  return (FONTS[key] || FONTS.sans).family;
}
function fontStr(layer, fs) {
  const p = layer.props;
  return `${p.italic && S.lang !== 'ar' ? 'italic ' : ''}${p.weight || 400} ${fs}px "${fontFamily(layer)}"`;
}
function textOf(layer) {
  const p = layer.props;
  let t = S.lang === 'ar' ? (p.textAr ?? p.text) : p.text;
  if (p.upper && S.lang !== 'ar') t = t.toUpperCase();
  return t;
}
function setTextCtx(g, layer, fs) {
  const p = layer.props;
  g.font = fontStr(layer, fs);
  g.letterSpacing = (S.lang === 'ar' ? 0 : (p.tracking || 0) * fs) + 'px';
  g.fontKerning = 'normal';
  g.direction = S.lang === 'ar' ? 'rtl' : 'ltr';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
}
function measureLines(layer, fs, lang = S.lang) {
  const saved = S.lang; S.lang = lang;
  const p = layer.props; const g = MEASURE;
  setTextCtx(g, layer, fs);
  g.direction = 'ltr';
  const lines = textOf(layer).split('\n');
  const sp = lang === 'ar' ? 0 : (p.tracking || 0) * fs;
  const ws = lines.map(l => Math.max(0, g.measureText(l).width - (l.length ? sp : 0)));
  const mH = g.measureText('Hhlfd'); const mD = g.measureText('gjpqy');
  const asc = lang === 'ar' ? fs * 0.95 : (mH.actualBoundingBoxAscent || fs * 0.75);
  const desc = lang === 'ar' ? fs * 0.45 : Math.max(mD.actualBoundingBoxDescent || 0, fs * 0.08);
  S.lang = saved;
  return { lines, ws, w: Math.max(0, ...ws), asc, desc };
}

/* geometry ------------------------------------------------------------ */
function textGeom(layer, fmt) {
  const f = layer.frames[fmt]; const fs = f.fs; const p = layer.props;
  const m = measureLines(layer, fs);
  const lh = (p.lh || 1.2) * fs;
  let x = f.x, base = f.y;
  const an = p.anchor && L(p.anchor.to);
  if (an && an.visible && an.frames[fmt]) {
    const B = buttonGeom(an, fmt);
    x = B.x + B.w + p.anchor.gap * B.fs;
    base = B.y + B.h / 2 + (p.anchor.dy || 0.33) * fs;
  } else if (S.lang === 'ar') { const en = measureLines(layer, fs, 'en'); x = f.x + en.w - m.w; }
  const top = base - m.asc;
  const h = m.asc + (m.lines.length - 1) * lh + m.desc;
  return { kind: 'text', m, lh, x, y: top, w: m.w, h, base, fs, rot: f.rot || 0 };
}
function buttonGeom(layer, fmt) {
  const f = layer.frames[fmt]; const fs = f.fs; const p = layer.props;
  const m = measureLines(layer, fs);
  const arrow = p.arrow ? fs * 1.1 : 0;
  const w = m.w + arrow + 2 * p.padX * fs;
  const h = fs * (1 + 2 * p.padY) + fs * 0.19;
  let x = f.x;
  if (S.lang === 'ar') { const en = measureLines(layer, fs, 'en'); const wen = en.w + arrow + 2 * p.padX * fs; x = f.x + wen - w; }
  return { kind: 'button', m, x, y: f.y, w, h, fs, arrow, rot: f.rot || 0 };
}
function imageGeom(layer, fmt) {
  const f = layer.frames[fmt];
  return { kind: 'image', x: f.x, y: f.y, w: f.w, h: f.h, rot: f.rot || 0, flip: !!f.flip };
}
function geom(layer, fmt = S.fmt) {
  if (layer.type === 'text') return textGeom(layer, fmt);
  if (layer.type === 'button') return buttonGeom(layer, fmt);
  if (layer.type === 'image') return imageGeom(layer, fmt);
  const F = FORMATS[fmt]; return { kind: 'scene', x: 0, y: 0, w: F.w, h: F.h, rot: 0 };
}

/* scene ---------------------------------------------------------------- */
const SCENE_CACHE = new Map();
function sceneKey(fmt, scale) { const p = L('scene').props; return [fmt, scale, S.sceneId, p.bright, p.contrast, p.sat, p.warm, p.vignette, p.blur].join('|'); }
function sceneCanvas(fmt, scale) {
  const key = sceneKey(fmt, scale);
  if (SCENE_CACHE.has(key)) return SCENE_CACHE.get(key);
  if (SCENE_CACHE.size > 24) SCENE_CACHE.clear();
  const F = FORMATS[fmt], c = CAM[fmt], img = SCENES[S.sceneId] || SCENES.base;
  const W = Math.round(F.w * scale), Hh = Math.round(F.h * scale);
  const raw = document.createElement('canvas'); raw.width = W; raw.height = Hh;
  const g = raw.getContext('2d'); g.scale(scale, scale); g.imageSmoothingQuality = 'high';
  const sw = 1080 * c.s, sh = 1350 * c.s, IW = img.width, IH = img.height;
  // left extension: horizontal stretch of left edge (wall + plank grain run horizontally)
  if (c.x > 0) {
    g.drawImage(img, 0, 0, Math.max(2, IW * 0.004), IH, 0, c.y, c.x + 2, sh);
    const gr = g.createLinearGradient(0, 0, c.x, 0); gr.addColorStop(0, 'rgba(0,0,0,.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, c.y, c.x + 2, sh);
  }
  if (c.x + sw < F.w) { g.drawImage(img, IW - Math.max(2, IW * 0.004), 0, Math.max(2, IW * 0.004), IH, c.x + sw - 2, c.y, F.w - (c.x + sw) + 2, sh); }
  // top extension: mirrored wall + darken
  if (c.y > 0) {
    const m = c.y; const srcH = IH * (m / sh);
    g.save(); g.translate(0, m); g.scale(1, -1); g.drawImage(img, 0, 0, IW, srcH, c.x, 0, sw, m); g.restore();
    const gr = g.createLinearGradient(0, 0, 0, m); gr.addColorStop(0, 'rgba(8,5,3,.55)'); gr.addColorStop(1, 'rgba(8,5,3,0)');
    g.fillStyle = gr; g.fillRect(0, 0, F.w, m);
  }
  const bottom = c.y + sh;
  if (bottom < F.h) {
    const m = F.h - bottom; const srcH = IH * (m / sh);
    g.save(); g.translate(0, bottom + m); g.scale(1, -1); g.drawImage(img, 0, IH - srcH, IW, srcH, c.x, 0, sw, m); g.restore();
    const gr = g.createLinearGradient(0, bottom, 0, F.h); gr.addColorStop(0, 'rgba(6,3,2,.15)'); gr.addColorStop(1, 'rgba(6,3,2,.72)');
    g.fillStyle = gr; g.fillRect(0, bottom, F.w, m);
  }
  g.drawImage(img, c.x, c.y, sw, sh);
  // adjustments
  const p = L('scene').props;
  const out = document.createElement('canvas'); out.width = W; out.height = Hh;
  const o = out.getContext('2d');
  const f = [];
  if (p.bright) f.push(`brightness(${1 + p.bright / 100})`);
  if (p.contrast) f.push(`contrast(${1 + p.contrast / 100})`);
  if (p.sat) f.push(`saturate(${1 + p.sat / 100})`);
  if (p.blur) f.push(`blur(${(p.blur / 100) * 14 * scale}px)`);
  o.filter = f.length ? f.join(' ') : 'none';
  o.drawImage(raw, 0, 0); o.filter = 'none';
  if (p.warm) {
    o.globalCompositeOperation = 'soft-light';
    o.fillStyle = p.warm > 0 ? `rgba(255,140,40,${Math.abs(p.warm) / 100 * 0.55})` : `rgba(60,120,255,${Math.abs(p.warm) / 100 * 0.55})`;
    o.fillRect(0, 0, W, Hh); o.globalCompositeOperation = 'source-over';
  }
  if (p.vignette) {
    const r = Math.hypot(W, Hh) / 2; const gr = o.createRadialGradient(W / 2, Hh / 2, r * 0.35, W / 2, Hh / 2, r);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${Math.max(0, p.vignette) / 100 * 0.8})`);
    o.fillStyle = gr; o.fillRect(0, 0, W, Hh);
  }
  SCENE_CACHE.set(key, out);
  return out;
}

/* fx ------------------------------------------------------------------ */
function withShadow(g, fx, scale) {
  if (fx && fx.shadow) { const s = fx.shadow; g.shadowColor = s.c || 'rgba(0,0,0,.55)'; g.shadowBlur = (s.b ?? 18) * scale; g.shadowOffsetX = (s.x ?? 0) * scale; g.shadowOffsetY = (s.y ?? 6) * scale; }
}
function clearShadow(g) { g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetX = 0; g.shadowOffsetY = 0; }

/* layers --------------------------------------------------------------- */
function drawImageLayer(g, layer, fmt, scale) {
  const G = geom(layer, fmt), img = IMG[layer.src]; if (!img) return;
  g.save();
  g.globalAlpha = layer.opacity;
  g.translate(G.x + G.w / 2, G.y + G.h / 2); g.rotate(G.rot * Math.PI / 180); if (G.flip) g.scale(-1, 1);
  const fx = layer.fx || {};
  if (fx.glow) { g.shadowColor = fx.glow.c || '#FFB347'; g.shadowBlur = (fx.glow.b ?? 40) * scale; g.drawImage(img, -G.w / 2, -G.h / 2, G.w, G.h); clearShadow(g); }
  withShadow(g, fx, scale);
  g.drawImage(img, -G.w / 2, -G.h / 2, G.w, G.h);
  g.restore();
}

function fillFor(g, layer, G, color) {
  const fx = layer.fx || {};
  if (fx.gradient && fx.gradient.length >= 2) {
    const gr = g.createLinearGradient(0, G.y, 0, G.y + G.h);
    fx.gradient.forEach((c, i) => gr.addColorStop(i / (fx.gradient.length - 1), c));
    return gr;
  }
  return color;
}

function drawTextLayer(g, layer, fmt, scale) {
  const G = textGeom(layer, fmt), p = layer.props, fx = layer.fx || {};
  g.save();
  g.globalAlpha = layer.opacity;
  const cx = G.x + G.w / 2, cy = G.y + G.h / 2;
  g.translate(cx, cy); g.rotate(G.rot * Math.PI / 180); g.translate(-cx, -cy);
  setTextCtx(g, layer, G.fs);
  const rtl = S.lang === 'ar';
  const lines = G.m.lines;
  const paint = (mode) => {
    lines.forEach((ln, i) => {
      const lw = G.m.ws[i];
      let lx;
      const al = rtl ? (p.align === 'left' ? 'right' : p.align === 'right' ? 'left' : p.align) : p.align;
      if (al === 'center') lx = G.x + (G.w - lw) / 2; else if (al === 'right') lx = G.x + G.w - lw; else lx = G.x;
      const by = G.base + i * G.lh;
      if (rtl) { g.direction = 'rtl'; g.textAlign = 'right'; mode === 'stroke' ? g.strokeText(ln, lx + lw, by) : g.fillText(ln, lx + lw, by); }
      else { mode === 'stroke' ? g.strokeText(ln, lx, by) : g.fillText(ln, lx, by); }
    });
  };
  g.fillStyle = fillFor(g, layer, G, p.color);
  if (fx.glow) { g.shadowColor = fx.glow.c || p.color; g.shadowBlur = (fx.glow.b ?? 28) * scale; paint('fill'); paint('fill'); clearShadow(g); }
  withShadow(g, fx, scale);
  paint('fill');
  clearShadow(g);
  if (fx.stroke && fx.stroke.w) { g.strokeStyle = fx.stroke.c || '#000'; g.lineWidth = fx.stroke.w; g.lineJoin = 'round'; paint('stroke'); }
  g.restore();
}

function drawButtonLayer(g, layer, fmt, scale) {
  const G = buttonGeom(layer, fmt), p = layer.props, fx = layer.fx || {};
  const r = Math.min(G.h / 2, p.radius * G.fs);
  g.save();
  g.globalAlpha = layer.opacity;
  const cx = G.x + G.w / 2, cy = G.y + G.h / 2;
  g.translate(cx, cy); g.rotate(G.rot * Math.PI / 180); g.translate(-cx, -cy);
  const path = new Path2D(); path.roundRect(G.x, G.y, G.w, G.h, r);
  let labelColor = p.color;
  if (p.style === 'glass') {
    const snap = document.createElement('canvas'); snap.width = g.canvas.width; snap.height = g.canvas.height;
    snap.getContext('2d').drawImage(g.canvas, 0, 0);
    g.save(); g.clip(path); const t = g.getTransform(); g.setTransform(1, 0, 0, 1, 0, 0);
    g.filter = `blur(${16 * scale}px) saturate(1.2)`; g.drawImage(snap, 0, 0); g.filter = 'none'; g.setTransform(t);
    g.fillStyle = 'rgba(255,255,255,.14)'; g.fill(path); g.restore();
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.2; g.stroke(path);
    labelColor = /^#(3E2315|24150C)$/i.test(p.color) ? CREAM : p.color;
  } else if (p.style === 'outline') {
    g.strokeStyle = p.bg; g.lineWidth = Math.max(1.5, G.fs * 0.07); g.stroke(path); labelColor = p.bg;
  } else {
    withShadow(g, fx, scale);
    if (fx.glow) { g.shadowColor = fx.glow.c || p.bg; g.shadowBlur = (fx.glow.b ?? 30) * scale; }
    g.fillStyle = fillFor(g, layer, G, p.bg); g.fill(path); clearShadow(g);
  }
  setTextCtx(g, layer, G.fs);
  g.fillStyle = labelColor;
  const tx = G.x + (G.w - G.m.w - G.arrow) / 2;
  const by = G.y + G.h / 2 + G.fs * 0.36;
  if (S.lang === 'ar') { g.textAlign = 'right'; g.fillText(G.m.lines[0], tx + G.m.w + G.arrow, by); }
  else g.fillText(G.m.lines[0], tx, by);
  if (G.arrow) {
    const ax = S.lang === 'ar' ? tx + G.fs * 0.15 : tx + G.m.w + G.fs * 0.35, ay = G.y + G.h / 2, s = G.fs * 0.32;
    g.strokeStyle = labelColor; g.lineWidth = Math.max(1.4, G.fs * 0.075); g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    if (S.lang === 'ar') { g.moveTo(ax + s * 1.6, ay); g.lineTo(ax, ay); g.moveTo(ax + s * .6, ay - s * .6); g.lineTo(ax, ay); g.lineTo(ax + s * .6, ay + s * .6); }
    else { g.moveTo(ax, ay); g.lineTo(ax + s * 1.6, ay); g.moveTo(ax + s, ay - s * .6); g.lineTo(ax + s * 1.6, ay); g.lineTo(ax + s, ay + s * .6); }
    g.stroke();
  }
  g.restore();
}

function drawLayer(g, layer, fmt, scale) {
  if (!layer.visible) return;
  if (layer.type === 'image') drawImageLayer(g, layer, fmt, scale);
  else if (layer.type === 'text') drawTextLayer(g, layer, fmt, scale);
  else if (layer.type === 'button') drawButtonLayer(g, layer, fmt, scale);
}

/** Render a full format into a 2D context sized F.w*scale × F.h*scale. */
function renderFormat(g, fmt, scale, opts = {}) {
  const F = FORMATS[fmt];
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  const scn = L('scene');
  if (scn && scn.visible && !(opts.only && opts.only !== 'scene')) g.drawImage(sceneCanvas(fmt, scale), 0, 0);
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.imageSmoothingQuality = 'high';
  for (const layer of S.layers) {
    if (layer.type === 'scene') continue;
    if (opts.only && opts.only !== layer.id) continue;
    if (opts.skip && opts.skip.has(layer.id)) continue;
    drawLayer(g, layer, fmt, scale);
  }
  g.restore();
}
function renderToCanvas(fmt, scale, opts) {
  const F = FORMATS[fmt]; const c = document.createElement('canvas');
  c.width = Math.round(F.w * scale); c.height = Math.round(F.h * scale);
  renderFormat(c.getContext('2d'), fmt, scale, opts); return c;
}
