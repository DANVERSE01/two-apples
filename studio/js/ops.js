/* ops.js — deterministic edit operations + offline quick-command parser */
'use strict';

const COLOR_WORDS = {
  red: '#C8102E', crimson: '#B3122E', orange: '#F07F1A', pumpkin: '#F07F1A', amber: '#E8A33D', gold: '#D4A64A', golden: '#D4A64A',
  yellow: '#F2C94C', green: '#4F9A2B', 'apple green': '#7DBA2F', lime: '#9BD14B', teal: '#1F8A8A', blue: '#2563EB', navy: '#1E2A4A',
  purple: '#6B2FA3', violet: '#7C3AED', pink: '#E8508B', black: '#0E0B09', white: '#FFFFFF', cream: CREAM, beige: '#E9D8BD',
  brown: '#5A3420', grey: '#8A857D', gray: '#8A857D', silver: '#C9C6C0',
  'أحمر': '#C8102E', 'احمر': '#C8102E', 'حمرا': '#C8102E', 'أخضر': '#4F9A2B', 'اخضر': '#4F9A2B', 'خضرا': '#4F9A2B', 'دهبي': '#D4A64A', 'ذهبي': '#D4A64A',
  'أبيض': '#FFFFFF', 'ابيض': '#FFFFFF', 'بيضا': '#FFFFFF', 'أسود': '#0E0B09', 'اسود': '#0E0B09', 'سودا': '#0E0B09', 'برتقالي': '#F07F1A',
  'بنفسجي': '#6B2FA3', 'موف': '#6B2FA3', 'أزرق': '#2563EB', 'ازرق': '#2563EB', 'زرقا': '#2563EB', 'أصفر': '#F2C94C', 'اصفر': '#F2C94C', 'كريمي': CREAM, 'بني': '#5A3420',
};
const TARGET_WORDS = [
  ['apple_green', /green apple|التفاح[هة] ال?خضر|التفاحة الخضرا/i],
  ['apple_carved', /carved|pumpkin apple|jack|red apple|the apple|apple\b|التفاح[هة]( المحفور[هة]| الحمرا)?|التفاحه/i],
  ['product', /\b(tin|product|box|can|pack|package)\b|العلب[هة]|المنتج|الباكو/i],
  ['smoke', /smoke|steam|الدخان|البخار/i],
  ['button', /button|cta|shop now|الزرار|الزر|البوتون/i],
  ['url', /\b(url|website|site|link|domain)\b|shisha-test|الموقع|اللينك|الويب/i],
  ['subline', /sub ?line|subtitle|offer line|code line|the code|small text|كود|الكود|السطر|السب/i],
  ['headline', /headline|title|heading|carved for|العنوان|الهيدلاين|التايتل/i],
  ['scene', /background|backdrop|\bbg\b|wall|table|الخلفي[هة]|الخلفيه|الحيط|الترابيزة/i],
];

function resolveTarget(t) {
  if (!t) return S.sel ? L(S.sel) : null;
  if (L(t)) return L(t);
  const s = String(t).toLowerCase();
  const byName = S.layers.find(l => l.name.toLowerCase() === s);
  if (byName) return byName;
  for (const [id, re] of TARGET_WORDS) if (re.test(s) && L(id)) return L(id);
  return S.sel ? L(S.sel) : null;
}
const fmtsFor = scope => (scope || S.scope) === 'all' ? FMT_KEYS : [S.fmt];
const hex = c => {
  if (!c) return c; c = String(c).trim();
  if (COLOR_WORDS[c.toLowerCase()]) return COLOR_WORDS[c.toLowerCase()];
  return c;
};


/* text anchored to another layer (website follows the button) detaches when moved on its own */
function detach(t) {
  if (!t || !t.props || !t.props.anchor) return;
  const saveLang = S.lang; S.lang = 'en';
  for (const f of FMT_KEYS) { const G = textGeom(t, f); t.frames[f].x = G.x; t.frames[f].y = G.base; }
  S.lang = saveLang; delete t.props.anchor;
}
function lum(hexStr) { const c = rgb(hexStr); const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
function autoLabel(t) { // keep button label readable after a fill change
  const L1 = lum(t.props.bg), L2 = lum(t.props.color); const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  if (cr < 3.2) t.props.color = L1 > 0.4 ? '#24150C' : '#FFFFFF';
}

/** Apply one op object {action,target,scope,params}. Returns a short human label or throws. */
function applyOp(op) {
  const a = op.action, p = op.params || {}, scope = op.scope;
  const t = ['undo', 'redo', 'switch_format', 'set_language', 'set_view', 'brand_check', 'export', 'compare', 'add_text', 'scene_adjust', 'ai_background', 'reset_all'].includes(a) ? null : resolveTarget(op.target);
  const need = () => { if (!t) throw new Error('Which layer? Select it or name it.'); return t; };
  const brandGuard = () => { if (t && t.brand && ['style', 'set_text', 'ai_edit'].includes(a)) throw new Error('The product is brand-locked. It can move or scale, never change.'); };
  brandGuard();
  switch (a) {
    case 'select': S.sel = need().id; return `Selected ${t.name}`;
    case 'set_text': {
      need(); if (!('text' in t.props)) throw new Error('That layer has no text.');
      const lang = p.lang || (S.lang === 'ar' ? 'ar' : 'en');
      if (lang === 'ar') t.props.textAr = p.text; else t.props.text = p.text;
      return `${t.name} → “${p.text.replace(/\n/g, ' ')}”`;
    }
    case 'style': {
      need(); const pr = t.props || {}; const out = [];
      if (p.color) { const c = hex(p.color); if (t.type === 'button' && !p.fg) { pr.bg = c; if (pr.style !== 'solid') pr.style = 'solid'; autoLabel(t); } else pr.color = c; out.push('color'); }
      if (p.bg) { pr.bg = hex(p.bg); if (t.type === 'button' && !p.fg) autoLabel(t); out.push('fill'); }
      if (p.fg) { pr.color = hex(p.fg); out.push('label color'); }
      if (p.font) { const k = Object.keys(FONTS).find(k => k === p.font || FONTS[k].family.toLowerCase() === String(p.font).toLowerCase() || (p.font === 'serif' && k === 'serif')); if (k) { if (k.startsWith('ar')) pr.fontAr = k; else pr.font = k; out.push('font'); } }
      if (p.weight) { pr.weight = p.weight === 'bold' ? 700 : p.weight === 'light' ? 300 : +p.weight; out.push('weight'); }
      if (p.italic != null) { pr.italic = !!p.italic; out.push('italic'); }
      if (p.upper != null) { pr.upper = !!p.upper; out.push('case'); }
      if (p.tracking != null) { pr.tracking = +p.tracking; out.push('tracking'); }
      if (p.lineHeight != null) { pr.lh = +p.lineHeight; out.push('line height'); }
      if (p.textAlign) { pr.align = p.textAlign; out.push('alignment'); }
      if (p.radius != null) { pr.radius = +p.radius; out.push('radius'); }
      if (p.buttonStyle) { pr.style = p.buttonStyle; out.push(p.buttonStyle); }
      if (p.arrow != null) { pr.arrow = !!p.arrow; out.push('arrow'); }
      if (p.padX != null) { pr.padX = +p.padX; out.push('padding'); }
      if (p.padY != null) { pr.padY = +p.padY; out.push('padding'); }
      if (p.size != null || p.sizeFactor != null) {
        for (const f of fmtsFor(scope)) { const fr = t.frames[f]; if (!fr || fr.fs == null) continue;
          if (p.sizeFactor != null) fr.fs = Math.max(6, fr.fs * p.sizeFactor);
          else fr.fs = f === S.fmt ? +p.size : Math.max(6, fr.fs * (+p.size / t.frames[S.fmt].fs)); }
        out.push('size');
      }
      t.fx = t.fx || {};
      if (p.shadow != null) { t.fx.shadow = p.shadow ? { c: 'rgba(0,0,0,.6)', b: 22, y: 6 } : undefined; out.push('shadow'); }
      if (p.glow != null) { t.fx.glow = p.glow ? { c: typeof p.glow === 'string' ? hex(p.glow) : (p.glowColor ? hex(p.glowColor) : '#FFB347'), b: 34 } : undefined; out.push('glow'); }
      if (p.stroke != null) { t.fx.stroke = p.stroke ? { c: hex(p.strokeColor || '#000'), w: p.strokeWidth || 2 } : undefined; out.push('outline'); }
      if (p.gradient !== undefined) { t.fx.gradient = p.gradient && p.gradient.length >= 2 ? p.gradient.map(hex) : undefined; out.push('gradient'); }
      return `${t.name}: ${out.join(', ') || 'style'}`;
    }
    case 'move_by': {
      need(); detach(t); const dx = +p.dx || 0, dy = +p.dy || 0;
      for (const f of fmtsFor(scope)) { const fr = t.frames[f]; if (!fr) continue; const u = f === S.fmt ? 1 : UNIT[f]; fr.x += dx * u; fr.y += dy * u; }
      return `${t.name} moved`;
    }
    case 'move_to': {
      need(); detach(t);
      for (const f of fmtsFor(scope)) { const fr = t.frames[f]; if (!fr) continue; const G = geom(t, f);
        const fx = f === S.fmt ? 1 : FORMATS[f].w / FORMATS[S.fmt].w, fy = f === S.fmt ? 1 : FORMATS[f].h / FORMATS[S.fmt].h;
        if (p.x != null) fr.x += p.x * fx - G.x; if (p.y != null) fr.y += p.y * fy - G.y; }
      return `${t.name} placed`;
    }
    case 'align': {
      need(); detach(t);
      for (const f of fmtsFor(scope)) { const fr = t.frames[f]; if (!fr) continue; const G = geom(t, f), F = FORMATS[f];
        const m = p.margin != null ? +p.margin : Math.round(F.w * 0.095);
        const safeTop = F.safe ? F.safe.top : 0, safeBot = F.safe ? F.safe.bottom : 0;
        if (p.h === 'center') fr.x += (F.w - G.w) / 2 - G.x; else if (p.h === 'left') fr.x += m - G.x; else if (p.h === 'right') fr.x += F.w - m - G.w - G.x;
        if (p.v === 'middle') fr.y += (F.h - G.h) / 2 - G.y; else if (p.v === 'top') fr.y += Math.max(m, safeTop + 24) - G.y; else if (p.v === 'bottom') fr.y += F.h - Math.max(m, safeBot + 24) - G.h - G.y; }
      return `${t.name} aligned ${[p.h, p.v].filter(Boolean).join(' / ')}`;
    }
    case 'scale': {
      need(); const k = +p.factor || 1;
      for (const f of fmtsFor(scope)) { const fr = t.frames[f]; if (!fr) continue; const G = geom(t, f); const cx = G.x + G.w / 2, cy = G.y + G.h / 2;
        if (fr.fs != null) { fr.fs *= k; const G2 = geom(t, f); fr.x += cx - (G2.x + G2.w / 2); fr.y += cy - (G2.y + G2.h / 2); }
        else { fr.w *= k; fr.h *= k; fr.x = cx - fr.w / 2; fr.y = cy - fr.h / 2; } }
      return `${t.name} ${k >= 1 ? 'bigger' : 'smaller'} ×${(+k).toFixed(2)}`;
    }
    case 'rotate': {
      need();
      for (const f of fmtsFor(scope)) { const fr = t.frames[f]; if (!fr) continue; fr.rot = p.angle != null ? +p.angle : (fr.rot || 0) + (+p.by || 0); }
      return `${t.name} rotated`;
    }
    case 'flip': { need(); for (const f of fmtsFor(scope)) { const fr = t.frames[f]; if (fr && t.type === 'image') fr.flip = !fr.flip; } return `${t.name} flipped`; }
    case 'opacity': { need(); t.opacity = Math.max(0, Math.min(1, p.value > 1 ? p.value / 100 : +p.value)); return `${t.name} opacity ${Math.round(t.opacity * 100)}%`; }
    case 'hide': need(); t.visible = false; return `${t.name} hidden`;
    case 'show': need(); t.visible = true; return `${t.name} shown`;
    case 'delete': {
      need(); if (t.type === 'scene') throw new Error('The background stays. Hide it instead.');
      S.layers.splice(idx(t.id), 1); if (S.sel === t.id) S.sel = null; return `${t.name} removed`;
    }
    case 'duplicate': {
      need(); if (t.type === 'scene') throw new Error('Background can’t be duplicated.');
      const c = JSON.parse(JSON.stringify(t)); c.id = uid(t.id); c.name = t.name + ' copy'; c.brand = false;
      for (const f of FMT_KEYS) if (c.frames[f]) { c.frames[f].x += (p.dx ?? 30) * UNIT[f]; c.frames[f].y += (p.dy ?? 30) * UNIT[f]; }
      S.layers.splice(idx(t.id) + 1, 0, c); S.sel = c.id; return `${t.name} duplicated`;
    }
    case 'bring_forward': case 'send_backward': case 'bring_to_front': case 'send_to_back': {
      need(); const i = idx(t.id); S.layers.splice(i, 1);
      let j = a === 'bring_forward' ? i + 1 : a === 'send_backward' ? i - 1 : a === 'bring_to_front' ? S.layers.length : 1;
      j = Math.max(1, Math.min(S.layers.length, j)); S.layers.splice(j, 0, t); return `${t.name} ${a.replace(/_/g, ' ')}`;
    }
    case 'lock': need(); t.locked = true; return `${t.name} locked`;
    case 'unlock': need(); if (t.brand) { t.locked = false; } t.locked = false; return `${t.name} unlocked`;
    case 'reset': {
      need(); const orig = INITIAL.find(l => l.id === t.id); if (!orig) throw new Error('No original for that layer.');
      S.layers[idx(t.id)] = JSON.parse(JSON.stringify(orig)); return `${t.name} reset`;
    }
    case 'reset_all': S.layers = JSON.parse(JSON.stringify(INITIAL)); S.sceneId = 'base'; return 'Back to the original design';
    case 'add_text': {
      const id = uid('text'); const fr = {};
      for (const f of FMT_KEYS) fr[f] = { x: (p.x ?? 107) * (f === S.fmt ? 1 : UNIT[f]), y: (p.y ?? 460) * (f === S.fmt ? 1 : UNIT[f]), fs: (p.size || 40) * (f === S.fmt ? 1 : UNIT[f]), rot: 0 };
      const lay = { id, name: 'Text · ' + String(p.text || 'New').slice(0, 18), type: 'text', visible: true, locked: false, opacity: 1, fx: {},
        props: { text: p.text || 'New text', textAr: p.textAr || p.text || 'نص جديد', font: p.font || 'sans', fontAr: 'arSans', weight: p.weight || 500, color: hex(p.color) || CREAM, tracking: p.tracking || 0, lh: 1.15, align: 'left', upper: !!p.upper, italic: false }, frames: fr };
      S.layers.push(lay); S.sel = id; return `Added “${lay.props.text}”`;
    }
    case 'scene_adjust': {
      const sp = L('scene').props;
      for (const k of ['bright', 'contrast', 'sat', 'warm', 'vignette', 'blur']) if (p[k] != null) sp[k] = Math.max(-100, Math.min(100, +p[k]));
      return 'Background adjusted';
    }
    case 'switch_format': { const f = String(p.format || '').toLowerCase(); const k = FMT_KEYS.find(x => x === f || FORMATS[x].label.toLowerCase() === f); if (!k) throw new Error('Unknown size.'); S.fmt = k; return `Showing ${FORMATS[k].label}`; }
    case 'set_view': S.view = p.view === 'grid' ? 'grid' : 'single'; return S.view === 'grid' ? 'All sizes' : 'Single size';
    case 'set_language': S.lang = p.lang === 'ar' ? 'ar' : 'en'; return S.lang === 'ar' ? 'Arabic version' : 'English version';
    case 'undo': undo(p.steps || 1); return 'Undone';
    case 'redo': redo(p.steps || 1); return 'Redone';
    default: throw new Error('Unsupported: ' + a);
  }
}

/* -------- offline quick-command parser (EN + Egyptian Arabic) -------- */
function quickParse(text) {
  const s = ' ' + text.toLowerCase().trim() + ' ';
  const ops = [];
  const scope = /all sizes|every size|all formats|everywhere|كل المقاسات|كل الأحجام|في الكل/.test(s) ? 'all' : undefined;
  const tgt = (() => { for (const [id, re] of TARGET_WORDS) if (re.test(s) && L(id)) return id; return S.sel || null; })();
  const num = (re) => { const m = s.match(re); return m ? parseFloat(m[1]) : null; };
  // formats / language / view / history
  if (/\bundo\b|تراجع|ارجع خطو[ةه]|رجّع/.test(s)) return [{ action: 'undo' }];
  if (/\bredo\b|اعادة|إعادة/.test(s)) return [{ action: 'redo' }];
  if (/\b(story|stories)\b|ستوري/.test(s) && /show|switch|make|go|open|اعرض|وريني|حول/.test(s)) ops.push({ action: 'switch_format', params: { format: 'story' } });
  else if (/\bsquare\b|مربع/.test(s) && /show|switch|make|go|open|اعرض|وريني|حول/.test(s)) ops.push({ action: 'switch_format', params: { format: 'square' } });
  else if (/landscape|banner|عرضي/.test(s)) ops.push({ action: 'switch_format', params: { format: 'land' } });
  else if (/\bfeed\b|فيد|البوست/.test(s) && /show|switch|go|open|اعرض|وريني|ارجع/.test(s)) ops.push({ action: 'switch_format', params: { format: 'feed' } });
  if (/all sizes|كل المقاسات/.test(s) && /show|view|اعرض|وريني/.test(s)) return [{ action: 'set_view', params: { view: 'grid' } }];
  if (/\barabic\b|بالعربي|عربي/.test(s) && /version|make|switch|show|نسخ|حول|خلي|اعمل/.test(s)) return [{ action: 'set_language', params: { lang: 'ar' } }];
  if (/\benglish\b|انجليزي|إنجليزي/.test(s) && /version|make|switch|show|back|نسخ|حول|خلي|رجع/.test(s)) return [{ action: 'set_language', params: { lang: 'en' } }];
  if (/brand check|check it|افحص|اتأكد/.test(s)) return [{ action: 'brand_check' }];
  if (/reset everything|start over|original design|رجع الأصل|رجعه زي ما كان/.test(s)) return [{ action: 'reset_all' }];
  // set text: "change headline to X" / "headline: X" / خلي العنوان "X"
  let m = text.match(/(?:to|say|says|reads?|الى|إلى|لـ|ل|يبقى|تبقى|بقى)\s*[“"']([^”"']+)[”"']/i) || text.match(/[“"']([^”"']+)[”"']/);
  if (m && tgt && L(tgt) && 'text' in (L(tgt).props || {})) ops.push({ action: 'set_text', target: tgt, params: { text: m[1] } });
  // colors
  const colorKeys = Object.keys(COLOR_WORDS).sort((a, b) => b.length - a.length);
  const hm = s.match(/#[0-9a-f]{6}\b/); let col = hm ? hm[0] : null;
  if (!col) for (const k of colorKeys) {
    const ar = /[؀-ۿ]/.test(k);
    const hit = ar ? s.includes(k) : new RegExp('\\b' + k + '\\b').test(s);
    if (!hit) continue;
    if (k === 'green' && /green apple/.test(s) && (s.match(/green/g) || []).length < 2) continue;
    if (ar && /(خضر|الخضرا)/.test(k) && /التفاح[هة] ال?خضر/.test(s)) continue;
    col = COLOR_WORDS[k]; break;
  }
  if (col && tgt) {
    if (tgt === 'scene') { /* ignore */ } else if (L(tgt).brand) { /* locked */ } else if (L(tgt).type === 'image') ops.push({ action: 'style', target: tgt, params: { glow: col } });
    else if (/text|label|الكلام|النص/.test(s) && L(tgt).type === 'button') ops.push({ action: 'style', target: tgt, params: { fg: col } });
    else ops.push({ action: 'style', target: tgt, params: { color: col } });
  }
  // size
  const pct = num(/(\d+(?:\.\d+)?)\s*%/);
  if (/bigger|larger|increase|enlarge|أكبر|اكبر|كبّر|كبر|تكبير/.test(s)) ops.push({ action: 'scale', target: tgt, scope, params: { factor: pct ? 1 + pct / 100 : (/much|a lot|كتير|خالص|اوي|أوي/.test(s) ? 1.5 : 1.2) } });
  if (/smaller|decrease|shrink|reduce|أصغر|اصغر|صغّر|صغر|تصغير/.test(s)) ops.push({ action: 'scale', target: tgt, scope, params: { factor: pct ? 1 - pct / 100 : (/much|a lot|كتير|خالص|اوي|أوي/.test(s) ? 0.67 : 0.83) } });
  // move
  const amt = num(/(\d+)\s*(?:px|pixels?|بكسل)/) ?? (/a bit|slightly|little|شوية|سنة|حبة/.test(s) ? 15 : /a lot|much|far|كتير|خالص/.test(s) ? 120 : 40);
  if (/\bup\b|higher|raise|لفوق|فوق|اطلع|طلّع|ارفع/.test(s) && !/bigger/.test(s)) ops.push({ action: 'move_by', target: tgt, scope, params: { dx: 0, dy: -amt } });
  if (/\bdown\b|lower|لتحت|تحت|نزّل|نزل/.test(s)) ops.push({ action: 'move_by', target: tgt, scope, params: { dx: 0, dy: amt } });
  if (/\bleft\b|شمال|يسار/.test(s) && !/align/.test(s)) ops.push({ action: 'move_by', target: tgt, scope, params: { dx: -amt, dy: 0 } });
  if (/\bright\b|يمين/.test(s) && !/align|bright/.test(s)) ops.push({ action: 'move_by', target: tgt, scope, params: { dx: amt, dy: 0 } });
  if (/center|centre|middle|في النص|سنتر|توسيط/.test(s)) ops.push({ action: 'align', target: tgt, scope, params: { h: 'center' } });
  // visibility / structure
  if (/\b(remove|delete|hide|get rid|lose)\b|امسح|شيل|احذف|اخفي|اخفِ/.test(s)) ops.push({ action: 'hide', target: tgt });
  if (/\b(show|bring back|restore)\b|رجّع|ارجع|اظهر|اظهار/.test(s) && tgt && !L(tgt).visible) ops.push({ action: 'show', target: tgt });
  if (/duplicate|copy|نسخ|كرر|اعمل نسخة/.test(s) && !/version/.test(s)) ops.push({ action: 'duplicate', target: tgt });
  if (/bring (it )?to (the )?front|on top|قدّام|قدام|فوق الكل/.test(s)) ops.push({ action: 'bring_to_front', target: tgt });
  if (/send (it )?to (the )?back|behind|ورا|خلف/.test(s)) ops.push({ action: 'send_to_back', target: tgt });
  const rot = num(/rotate\D*(-?\d+)/) ?? num(/لف\D*(-?\d+)/);
  if (rot != null) ops.push({ action: 'rotate', target: tgt, scope, params: { by: rot } });
  if (/\bflip\b|mirror|اقلب|اعكس/.test(s)) ops.push({ action: 'flip', target: tgt, scope });
  // style toggles
  if (/\bbold\b|bolder|heavier|أتقل|اتقل|تقيل|بولد/.test(s)) ops.push({ action: 'style', target: tgt, params: { weight: 700 } });
  if (/\blight(er)?\b|thinner|أخف|اخف|رفيع/.test(s) && !/lighting/.test(s)) ops.push({ action: 'style', target: tgt, params: { weight: 300 } });
  if (/italic|مائل/.test(s)) ops.push({ action: 'style', target: tgt, params: { italic: true } });
  if (/uppercase|all caps|capital|كابيتال/.test(s)) ops.push({ action: 'style', target: tgt, params: { upper: true } });
  if (/\bshadow\b|ظل/.test(s)) ops.push({ action: 'style', target: tgt, params: { shadow: !/no shadow|remove shadow|من غير ظل|شيل الظل/.test(s) } });
  if (/\bglow\b|توهج|نور حوالي/.test(s) && !col) ops.push({ action: 'style', target: tgt, params: { glow: true } });
  if (/outline|outlined|اوتلاين|إطار/.test(s) && tgt === 'button') ops.push({ action: 'style', target: tgt, params: { buttonStyle: 'outline' } });
  if (/glass|زجاج/.test(s) && tgt === 'button') ops.push({ action: 'style', target: tgt, params: { buttonStyle: 'glass' } });
  if (/solid|سوليد/.test(s) && tgt === 'button') ops.push({ action: 'style', target: tgt, params: { buttonStyle: 'solid' } });
  if (/arrow|سهم/.test(s) && tgt === 'button') ops.push({ action: 'style', target: tgt, params: { arrow: !/no arrow|remove arrow|شيل السهم/.test(s) } });
  if (/round(er|ed)?|pill|مدور|دائري/.test(s) && tgt === 'button') ops.push({ action: 'style', target: tgt, params: { radius: 2 } });
  if (/square corners|sharp|حاد/.test(s) && tgt === 'button') ops.push({ action: 'style', target: tgt, params: { radius: 0 } });
  // scene
  if (tgt === 'scene' || /background|الخلفي/.test(s)) {
    if (/brighter|lighter|أفتح|افتح|نوّر/.test(s)) ops.push({ action: 'scene_adjust', params: { bright: (L('scene').props.bright || 0) + 15 } });
    if (/darker|moodier|أغمق|اغمق|ضلّم/.test(s)) ops.push({ action: 'scene_adjust', params: { bright: (L('scene').props.bright || 0) - 15 } });
    if (/warmer|أدفى|ادفى|دافي/.test(s)) ops.push({ action: 'scene_adjust', params: { warm: (L('scene').props.warm || 0) + 25 } });
    if (/cooler|colder|أبرد|ابرد|بارد/.test(s)) ops.push({ action: 'scene_adjust', params: { warm: (L('scene').props.warm || 0) - 25 } });
    if (/blur|بلور|ضبّب/.test(s)) ops.push({ action: 'scene_adjust', params: { blur: 35 } });
    if (/vignette|فينيت/.test(s)) ops.push({ action: 'scene_adjust', params: { vignette: 45 } });
  }
  return ops.filter(o => o.target !== null || !['style', 'scale', 'move_by', 'align', 'hide', 'show', 'duplicate', 'rotate', 'flip', 'bring_to_front', 'send_to_back'].includes(o.action));
}
