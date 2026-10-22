/* assist.js — talk-to-edit: model-backed command understanding, voice, image edits, live feed */
'use strict';

const CFG = {
  get key() { try { return localStorage.getItem('dv.key') || ''; } catch (e) { return ''; } },
  set key(v) { try { localStorage.setItem('dv.key', v); } catch (e) {} },
  get model() { try { return localStorage.getItem('dv.model') || 'gemini-3.5-flash-lite'; } catch (e) { return 'gemini-3.5-flash-lite'; } },
  set model(v) { try { localStorage.setItem('dv.model', v); } catch (e) {} },
  get imgModel() { try { return localStorage.getItem('dv.imgModel') || 'gemini-3-pro-image'; } catch (e) { return 'gemini-3-pro-image'; } },
  set imgModel(v) { try { localStorage.setItem('dv.imgModel', v); } catch (e) {} },
};
const TEXT_FALLBACKS = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash'];
const IMG_FALLBACKS = ['gemini-3-pro-image', 'gemini-3.1-flash-image'];
const API = 'https://generativelanguage.googleapis.com/v1beta/models/';

async function gemini(models, body, { thinking } = {}) {
  if (!CFG.key) throw Object.assign(new Error('no-key'), { code: 'nokey' });
  let lastErr;
  for (const model of models) {
    for (const withThinking of thinking ? [true, false] : [false]) {
      const b = JSON.parse(JSON.stringify(body));
      if (withThinking) { b.generationConfig = b.generationConfig || {}; b.generationConfig.thinkingConfig = { thinkingLevel: thinking }; }
      try {
        const r = await fetch(API + model + ':generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': CFG.key }, body: JSON.stringify(b) });
        if (r.ok) { const j = await r.json(); j._model = model; return j; }
        const t = await r.text(); lastErr = new Error(`${model}: ${r.status} ${t.slice(0, 240)}`); lastErr.status = r.status;
        if (r.status === 401 || r.status === 403) throw lastErr;
        if (r.status === 400 && withThinking && /thinking/i.test(t)) continue;
        if (r.status === 400 && !/not found|not supported|unknown name|model/i.test(t)) throw lastErr;
        break; // try next model
      } catch (e) { lastErr = e; if (e.status === 401 || e.status === 403) throw e; if (!e.status) break; }
    }
  }
  throw lastErr || new Error('Request failed');
}

const ACTIONS = ['select', 'set_text', 'style', 'move_by', 'move_to', 'align', 'scale', 'rotate', 'flip', 'opacity', 'hide', 'show', 'delete', 'duplicate',
  'bring_forward', 'send_backward', 'bring_to_front', 'send_to_back', 'lock', 'unlock', 'reset', 'reset_all', 'add_text', 'scene_adjust', 'ai_background',
  'variants', 'switch_format', 'set_view', 'set_language', 'undo', 'redo', 'brand_check', 'export', 'compare'];
const P = (type, extra = {}) => Object.assign({ type }, extra);
const OP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: P('STRING', { description: 'One short confirmation for the person, in their language (Egyptian Arabic if they wrote Arabic).' }),
    ops: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      action: P('STRING', { enum: ACTIONS }),
      target: P('STRING', { description: 'Layer id from the state.' }),
      scope: P('STRING', { enum: ['current', 'all'] }),
      params: { type: 'OBJECT', properties: {
        text: P('STRING'), lang: P('STRING', { enum: ['en', 'ar'] }), color: P('STRING'), bg: P('STRING'), fg: P('STRING'), font: P('STRING', { enum: Object.keys(FONTS) }),
        weight: P('NUMBER'), italic: P('BOOLEAN'), upper: P('BOOLEAN'), tracking: P('NUMBER'), lineHeight: P('NUMBER'), textAlign: P('STRING', { enum: ['left', 'center', 'right'] }),
        radius: P('NUMBER'), buttonStyle: P('STRING', { enum: ['solid', 'outline', 'glass'] }), arrow: P('BOOLEAN'), padX: P('NUMBER'), padY: P('NUMBER'),
        size: P('NUMBER'), sizeFactor: P('NUMBER'), shadow: P('BOOLEAN'), glow: P('BOOLEAN'), glowColor: P('STRING'), stroke: P('BOOLEAN'), strokeColor: P('STRING'), strokeWidth: P('NUMBER'),
        gradient: { type: 'ARRAY', items: P('STRING') }, dx: P('NUMBER'), dy: P('NUMBER'), x: P('NUMBER'), y: P('NUMBER'), h: P('STRING', { enum: ['left', 'center', 'right'] }), v: P('STRING', { enum: ['top', 'middle', 'bottom'] }),
        margin: P('NUMBER'), factor: P('NUMBER'), angle: P('NUMBER'), by: P('NUMBER'), value: P('NUMBER'), format: P('STRING', { enum: FMT_KEYS }), view: P('STRING', { enum: ['single', 'grid'] }),
        steps: P('NUMBER'), bright: P('NUMBER'), contrast: P('NUMBER'), sat: P('NUMBER'), warm: P('NUMBER'), vignette: P('NUMBER'), blur: P('NUMBER'),
        prompt: P('STRING'), options: { type: 'ARRAY', items: P('STRING') }, field: P('STRING', { enum: ['text', 'color', 'bg'] }), kind: P('STRING', { enum: ['png', 'png2', 'zip', 'psd', 'psdall'] }),
      } },
    }, required: ['action'] } },
  },
  required: ['reply', 'ops'],
};

function stateForModel() {
  const F = FORMATS[S.fmt];
  return {
    format: { id: S.fmt, width: F.w, height: F.h, safe_zone: F.safe || null }, all_formats: FMT_KEYS, language: S.lang, selected: S.sel, default_scope: S.scope,
    layers: S.layers.map(l => {
      const G = geom(l); const o = { id: l.id, name: l.name, type: l.type, visible: l.visible, locked: l.locked, opacity: l.opacity,
        bbox: { x: Math.round(G.x), y: Math.round(G.y), w: Math.round(G.w), h: Math.round(G.h) }, rotation: G.rot || 0 };
      if (l.brand) o.brand_locked = true;
      if (l.props && 'text' in l.props) Object.assign(o, { text: l.props.text, textAr: l.props.textAr, color: l.props.color, font: l.props.font, weight: l.props.weight, fontSize: Math.round(l.frames[S.fmt].fs), upper: l.props.upper, tracking: l.props.tracking });
      if (l.type === 'button') Object.assign(o, { fill: l.props.bg, buttonStyle: l.props.style, radius: l.props.radius, arrow: l.props.arrow });
      if (l.type === 'scene') o.adjust = l.props;
      return o;
    }),
  };
}

const SYS = `You are the command engine of a layered ad-design studio for an Al Fakher "Two Apples" shisha promo (Halloween, 30% off all shisha, code SHISHA, CTA "Shop Now", site shisha-test.com).
Turn the person's instruction (English or Egyptian Arabic, possibly casual, possibly from a live call transcript) into precise edit ops on the layers in STATE. Return JSON only.
Rules:
- Coordinates are pixels of the active format (origin top-left, y grows downward). "up" = negative dy. Default nudge 40px, "a bit/slightly/شوية" 15px, "a lot/كتير" 120px.
- "bigger" = scale factor 1.2, "much bigger" 1.5, "smaller" 0.83. "x% bigger" = 1+x/100. For text size changes prefer action "scale" (keeps it centred) unless an absolute size is given.
- Colours: return hex codes. For a button, "make the button red" sets its fill (params.color); its label colour is params.fg.
- "it/this/that" means the selected layer; otherwise pick the layer the words describe.
- Scope: "all sizes/everywhere/كل المقاسات" → scope "all"; otherwise omit scope.
- The product (brand_locked) can be moved, scaled or hidden only when asked explicitly; never restyle it.
- Never invent offer facts: keep SHISHA, 30%, shisha-test.com unless the person explicitly changes them.
- Copy changes: write on-brand, premium, short copy. Arabic copy goes in set_text with params.lang "ar".
- "give me N options/variations/alternatives" for a headline or colour → one "variants" op with params.field and params.options (N items, default 6).
- Background mood/scene changes that need new pixels (fog, moonlight, different backdrop, add props on the table) → "ai_background" with a precise params.prompt describing ONLY the change.
- Simple background tone changes (brighter, darker, warmer, cooler, blur, vignette) → "scene_adjust" with absolute values -100..100 (current values are in STATE).
- Several changes in one sentence → several ops, in order.
- If the instruction is a question or not an edit, return no ops and answer briefly in reply.`;


const SPEC = `Output JSON only: {"reply": string, "ops": [{"action": string, "target": layer id, "scope": "current"|"all" (optional), "params": {...}}]}
Actions: ${ACTIONS.join(', ')}.
params by action:
 style: color|bg|fg (hex), font (${Object.keys(FONTS).join('|')}), weight (300-800), italic, upper, tracking (em), lineHeight, textAlign, radius (em), buttonStyle (solid|outline|glass), arrow (bool), padX, padY, size (px), sizeFactor, shadow (bool), glow (bool), glowColor (hex), stroke (bool), strokeColor, strokeWidth, gradient ([hex,hex])
 set_text: text, lang (en|ar)
 move_by: dx, dy | move_to: x, y | align: h (left|center|right), v (top|middle|bottom), margin
 scale: factor | rotate: angle (absolute) or by (relative) | opacity: value (0..1) | flip: none
 scene_adjust: bright, contrast, sat, warm, vignette, blur (absolute, -100..100)
 ai_background: prompt | variants: field (text|color|bg), options [strings] | add_text: text, x, y, size, color, font
 switch_format: format (feed|story|square|land) | set_view: view (single|grid) | set_language: lang (en|ar) | undo/redo: steps | export: kind (png|png2|zip|psd|psdall)
 hide, show, delete, duplicate, bring_forward, send_backward, bring_to_front, send_to_back, lock, unlock, reset, select, brand_check, compare, reset_all: no params
Examples:
"make the button red and move it up a bit" -> {"reply":"Button is red and nudged up.","ops":[{"action":"style","target":"button","params":{"color":"#C8102E"}},{"action":"move_by","target":"button","params":{"dx":0,"dy":-15}}]}
"كبر العنوان 10% في كل المقاسات" -> {"reply":"كبّرت العنوان 10% في كل المقاسات.","ops":[{"action":"scale","target":"headline","scope":"all","params":{"factor":1.1}}]}
"give me 4 button label options" -> {"reply":"Four CTA options.","ops":[{"action":"variants","target":"button","params":{"field":"text","options":["Shop Now","Claim 30% Off","Get the Deal","Shop the Spell"]}}]}
(For headline variants write fresh, original lines that fit the visual; use \\n for a line break; never repeat the current headline.)
"make it a story and center the headline there" -> {"reply":"Story view, headline centred.","ops":[{"action":"switch_format","params":{"format":"story"}},{"action":"align","target":"headline","params":{"h":"center"}}]}`;

const CONVO = [];
async function understand(text) {
  const state = stateForModel();
  const ar = /[\u0600-\u06FF]/.test(text);
  const contents = [...CONVO.slice(-6), { role: 'user', parts: [{ text: `STATE:\n${JSON.stringify(state)}\n\nINSTRUCTION:\n${text}\n\nReply language: ${ar ? 'Egyptian Arabic' : 'English'}` }] }];
  const j = await gemini([CFG.model, ...TEXT_FALLBACKS.filter(m => m !== CFG.model)], {
    systemInstruction: { parts: [{ text: SYS + '\n\n' + SPEC }] },
    contents,
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
  }, { thinking: 'minimal' });
  const part = (j.candidates?.[0]?.content?.parts || []).filter(p => p.text && !p.thought).pop();
  if (!part) throw new Error('Empty answer');
  const raw = part.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const out = JSON.parse(raw);
  out.ops = (Array.isArray(out.ops) ? out.ops : []).filter(o => o && ACTIONS.includes(o.action)).map(o => { if (o.target && !L(o.target)) { const r = resolveTarget(o.target); o.target = r ? r.id : undefined; } return o; });
  CONVO.push({ role: 'user', parts: [{ text }] }, { role: 'model', parts: [{ text: JSON.stringify({ reply: out.reply, ops: out.ops }) }] });
  return out;
}

/* ---------- background edit with image model ---------- */
async function editBackground(prompt) {
  const src = SCENES[S.sceneId] || SCENES.base;
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1350; c.getContext('2d').drawImage(src, 0, 0, 1080, 1350);
  const b64 = c.toDataURL('image/jpeg', 0.9).split(',')[1];
  const instruction = `Edit this photograph. It is the empty background plate of a premium product ad (the products are composited later on top).
Change requested: ${prompt}
Hard rules: keep the exact camera angle, framing, perspective and the height of the table edge/horizon line; keep the wooden table surface where it is; keep the overall low-key, candle-lit premium mood unless the change asks otherwise; photorealistic; no text, no logos, no products, no people. Return the full edited image at the same aspect ratio (4:5).`;
  const j = await gemini([CFG.imgModel, ...IMG_FALLBACKS.filter(m => m !== CFG.imgModel)], {
    contents: [{ role: 'user', parts: [{ text: instruction }, { inlineData: { mimeType: 'image/jpeg', data: b64 } }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '4:5' } },
  });
  const part = j.candidates?.[0]?.content?.parts?.find(p => p.inlineData || p.inline_data);
  if (!part) throw new Error('No image returned');
  const d = part.inlineData || part.inline_data;
  const img = await loadImage(`data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}`);
  const id = 'ai_' + Date.now().toString(36);
  SCENES[id] = img; return id;
}

/* ---------- voice ---------- */
const Voice = {
  rec: null, on: false, lang: 'en-US',
  supported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },
  start(onInterim, onFinal, onEnd) {
    if (!this.supported()) throw new Error('Voice input needs Chrome or Edge.');
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new R(); r.lang = this.lang; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    let finalText = '';
    r.onresult = e => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) finalText += t; else interim += t; } onInterim(finalText + interim); };
    r.onerror = e => { this.on = false; onEnd(e.error); };
    r.onend = () => { this.on = false; if (finalText.trim()) onFinal(finalText.trim()); onEnd(); };
    this.rec = r; this.on = true; r.start();
  },
  stop() { if (this.rec && this.on) this.rec.stop(); },
};

/* ---------- live feed from the interpreter page ---------- */
const LIVE = ('BroadcastChannel' in window) ? new BroadcastChannel('danverse-live') : null;
