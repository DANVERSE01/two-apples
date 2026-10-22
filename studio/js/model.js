/* model.js — formats, layer model, state, history */
'use strict';

const FORMATS = {
  feed:   { w: 1080, h: 1350, label: 'Feed',      ratio: '4:5',    file: 'Feed_1080x1350' },
  story:  { w: 1080, h: 1920, label: 'Story',     ratio: '9:16',   file: 'Story_1080x1920', safe: { top: 250, bottom: 340 } },
  square: { w: 1080, h: 1080, label: 'Square',    ratio: '1:1',    file: 'Square_1080x1080' },
  land:   { w: 1200, h: 628,  label: 'Landscape', ratio: '1.91:1', file: 'Landscape_1200x628' },
};
const FMT_KEYS = Object.keys(FORMATS);
// photographic "camera" per format: scene (1080x1350 design space) scale + offset
const CAM = {
  feed:   { s: 1,      x: 0,   y: 0 },
  story:  { s: 1,      x: 0,   y: 250 },
  square: { s: 0.9,    x: 108, y: -100 },
  land:   { s: 0.4652, x: 698, y: 0 },
};
// relative unit per format (used when a relative edit is applied to all sizes)
const UNIT = { feed: 1, story: 1, square: 0.88, land: 0.62 };

const ASSET_SRC = {
  scene: 'assets/scene.jpg',
  product: 'assets/product.webp',
  apple_carved: 'assets/apple_carved.webp',
  apple_green: 'assets/apple_green.webp',
  smoke: 'assets/smoke.webp',
};
// base geometry of cut-outs in feed design space
const BASE = {
  product:      { x: 511,   y: 484,   w: 536,   h: 484 },
  apple_carved: { x: 87.5,  y: 543.5, w: 519,   h: 564.5 },
  apple_green:  { x: 856,   y: 709,   w: 224,   h: 361.5 },
  smoke:        { x: 227.5, y: 0,     w: 267.5, h: 649.5 },
};

const FONTS = {
  serif:   { family: 'Newsreader',       weights: [300, 400, 500, 600, 700] },
  sans:    { family: 'Inter',            weights: [300, 400, 500, 600, 700, 800] },
  display: { family: 'Instrument Serif', weights: [400] },
  playfair:{ family: 'Playfair Display', weights: [400, 600, 800] },
  dmserif: { family: 'DM Serif Display', weights: [400] },
  grotesk: { family: 'Space Grotesk',    weights: [300, 400, 500, 700] },
  arSerif: { family: 'Amiri',            weights: [400, 700] },
  arSans:  { family: 'IBM Plex Sans Arabic', weights: [300, 400, 500, 600, 700] },
};
const FONT_KEYS_EN = ['serif', 'sans', 'display', 'playfair', 'dmserif', 'grotesk'];
const CREAM = '#FBEEDA';

function camFrame(id, fmt) {
  const b = BASE[id], c = CAM[fmt];
  return { x: c.x + b.x * c.s, y: c.y + b.y * c.s, w: b.w * c.s, h: b.h * c.s, rot: 0 };
}
function photoLayer(id, name, extra = {}) {
  const frames = {};
  for (const f of FMT_KEYS) frames[f] = camFrame(id, f);
  return Object.assign({ id, src: id, name, type: 'image', visible: true, locked: false, opacity: 1, fx: {}, frames }, extra);
}

function defaultLayers() {
  return [
    { id: 'scene', name: 'Background', type: 'scene', visible: true, locked: true, opacity: 1, fx: {},
      props: { bright: 0, contrast: 0, sat: 0, warm: 0, vignette: 0, blur: 0 }, frames: {} },
    photoLayer('product', 'Product · Two Apples tin', { brand: true }),
    photoLayer('apple_carved', 'Carved apple · 30%'),
    photoLayer('apple_green', 'Green apple'),
    photoLayer('smoke', 'Smoke', { opacity: 1 }),
    { id: 'headline', name: 'Headline', type: 'text', visible: true, locked: false, opacity: 1, fx: {},
      props: { text: 'Carved for\nHalloween.', textAr: 'منحوتة\nللهالوين.', font: 'serif', fontAr: 'arSerif', weight: 470,
               color: CREAM, tracking: -0.004, lh: 1.077, align: 'left', upper: false, italic: false },
      frames: {
        feed:   { x: 105, y: 187.5, fs: 97,  rot: 0 },
        story:  { x: 107, y: 430,   fs: 116, rot: 0 },
        square: { x: 96,  y: 150,   fs: 82,  rot: 0 },
        land:   { x: 60,  y: 150,   fs: 66,  rot: 0 },
      } },
    { id: 'subline', name: 'Offer line', type: 'text', visible: true, locked: false, opacity: 1, fx: {},
      props: { text: 'Off all shisha · Code: SHISHA', textAr: 'على كل الشيشة · كود: SHISHA', font: 'sans', fontAr: 'arSans', weight: 400,
               color: CREAM, tracking: 0.19, lh: 1.3, align: 'left', upper: true, italic: false },
      frames: {
        feed:   { x: 105, y: 348.5, fs: 24, rot: 0 },
        story:  { x: 109, y: 640,   fs: 28, rot: 0 },
        square: { x: 96,  y: 290,   fs: 21, rot: 0 },
        land:   { x: 60,  y: 284,   fs: 19, rot: 0 },
      } },
    { id: 'button', name: 'CTA button', type: 'button', visible: true, locked: false, opacity: 1, fx: {},
      props: { text: 'Shop Now', textAr: 'تسوّق الآن', font: 'sans', fontAr: 'arSans', weight: 420, color: '#24150C', bg: '#FCECD6',
               radius: 0.23, padX: 0.9, padY: 0.415, style: 'solid', arrow: false, tracking: 0, upper: false },
      frames: {
        feed:   { x: 103, y: 1215, fs: 26, rot: 0 },
        story:  { x: 107, y: 1452, fs: 32, rot: 0 },
        square: { x: 96,  y: 958,  fs: 25, rot: 0 },
        land:   { x: 60,  y: 470,  fs: 20.5, rot: 0 },
      } },
    { id: 'url', name: 'Website', type: 'text', visible: true, locked: false, opacity: 1, fx: {},
      props: { text: 'shisha-test.com', textAr: 'shisha-test.com', font: 'sans', fontAr: 'arSans', weight: 400,
               color: CREAM, tracking: 0, lh: 1.2, align: 'left', upper: false, italic: false, anchor: { to: 'button', gap: 0.83, dy: 0.33 } },
      frames: {
        feed:   { x: 291.5, y: 1250, fs: 26.5, rot: 0 },
        story:  { x: 340,   y: 1496, fs: 32.5, rot: 0 },
        square: { x: 275,   y: 991,  fs: 25.5, rot: 0 },
        land:   { x: 207,   y: 494,  fs: 20.5, rot: 0 },
      } },
  ];
}

const S = {
  fmt: 'feed', lang: 'en', view: 'single', scope: 'current', sel: null, safe: false,
  sceneId: 'base',
  layers: defaultLayers(),
};
const INITIAL = JSON.parse(JSON.stringify(S.layers));

/* ---------- images ---------- */
const IMG = {};        // id -> HTMLImageElement|Canvas
const SCENES = {};     // sceneId -> image
const ALPHA = {};      // id -> {data,w,h} low-res alpha for hit testing
function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
async function loadAssets() {
  const entries = Object.entries(ASSET_SRC);
  await Promise.all(entries.map(async ([k, src]) => {
    const img = await loadImage(src);
    if (k === 'scene') SCENES.base = img; else { IMG[k] = img; buildAlpha(k, img); }
  }));
}
function buildAlpha(k, img) {
  const w = Math.max(1, Math.round(img.width / 4)), h = Math.max(1, Math.round(img.height / 4));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data; const a = new Uint8Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  ALPHA[k] = { a, w, h };
}

/* ---------- lookup ---------- */
const L = id => S.layers.find(l => l.id === id);
const idx = id => S.layers.findIndex(l => l.id === id);
function frameOf(layer, fmt = S.fmt) { return layer.frames[fmt]; }
function uid(base) { let i = 2; while (L(base + '_' + i)) i++; return base + '_' + i; }

/* ---------- history ---------- */
const H = { stack: [], pos: -1, pinned: null };
function snapshot() { return JSON.stringify({ layers: S.layers, sceneId: S.sceneId }); }
function restore(json) { const o = JSON.parse(json); S.layers = o.layers; S.sceneId = o.sceneId; if (S.sel && !L(S.sel)) S.sel = null; }
function commit(label) {
  const snap = snapshot();
  if (H.pos >= 0 && H.stack[H.pos].snap === snap) return false;
  H.stack = H.stack.slice(0, H.pos + 1);
  H.stack.push({ label, snap, t: Date.now() });
  if (H.stack.length > 200) H.stack.shift();
  H.pos = H.stack.length - 1;
  try { localStorage.setItem('tas.state', snap); } catch (e) {}
  return true;
}
function undo(n = 1) { if (H.pos - n < 0) return false; H.pos -= n; restore(H.stack[H.pos].snap); return true; }
function redo(n = 1) { if (H.pos + n >= H.stack.length) return false; H.pos += n; restore(H.stack[H.pos].snap); return true; }
function jumpTo(i) { if (i < 0 || i >= H.stack.length) return; H.pos = i; restore(H.stack[i].snap); }
