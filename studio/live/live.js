/* live.js — two-lane live voice interpreter (Arabic ⇄ English) */
'use strict';
const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem('dvl.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('dvl.' + k, JSON.stringify(v)); } catch (e) {} },
};
const KEY = () => { try { return localStorage.getItem('dv.key') || ''; } catch (e) { return ''; } };
const MODEL = 'gemini-3.5-live-translate-preview';
const WS = k => `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(k)}`;
const LIVE = 'BroadcastChannel' in window ? new BroadcastChannel('danverse-live') : null;
let toastT; function toast(m, ms = 2600) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }

/* ---------- capture worklet: any rate → 16 kHz PCM16, 100 ms chunks ---------- */
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor(){ super(); this.r = sampleRate/16000; this.acc=0; this.sum=0; this.cnt=0; this.buf=new Int16Array(1600); this.n=0; this.gate=true; this.sq=0; this.sc=0;
    this.port.onmessage = e => { if ('gate' in e.data) this.gate = e.data.gate; }; }
  process(inputs){ const ch = inputs[0] && inputs[0][0]; if(!ch) return true;
    for (let i=0;i<ch.length;i++){ const x = ch[i]; this.sum+=x; this.cnt++; this.sq+=x*x; this.sc++; this.acc+=1;
      if (this.acc>=this.r){ this.acc-=this.r; let v=this.sum/this.cnt; this.sum=0; this.cnt=0; if(!this.gate) v=0;
        v = v<-1?-1:v>1?1:v; this.buf[this.n++] = v*32767;
        if (this.n===1600){ this.port.postMessage({ pcm: this.buf.slice(0), rms: Math.sqrt(this.sq/Math.max(1,this.sc)), gate:this.gate }); this.n=0; this.sq=0; this.sc=0; } } }
    return true; } }
registerProcessor('tap', Tap);`;
const workletURL = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));

function b64FromInt16(a) { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
function int16FromB64(b) { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Int16Array(u.buffer, 0, u.length >> 1); }

/* ---------- output sink (one AudioContext per device) ---------- */
class Sink {
  constructor(deviceId, gain = 1) { this.ctx = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' }); this.g = this.ctx.createGain(); this.g.gain.value = gain; this.g.connect(this.ctx.destination); this.next = 0; this.deviceId = deviceId; }
  async init() { if (this.deviceId && this.ctx.setSinkId) { try { await this.ctx.setSinkId(this.deviceId); } catch (e) { toast('Could not open output device: ' + e.message); } } if (this.ctx.state !== 'running') await this.ctx.resume(); return this; }
  play(f32) {
    const c = this.ctx, now = c.currentTime;
    let rms = 0; for (let i = 0; i < f32.length; i += 8) rms += f32[i] * f32[i]; rms = Math.sqrt(rms / (f32.length / 8));
    if (this.next - now > 1.0 && rms < 0.004) return; // catch up by dropping silence
    const b = c.createBuffer(1, f32.length, 24000); b.copyToChannel(f32, 0);
    const s = c.createBufferSource(); s.buffer = b; s.connect(this.g);
    const t = Math.max(now + 0.03, this.next); s.start(t); this.next = t + b.duration;
  }
  close() { try { this.ctx.close(); } catch (e) {} }
}

/* ---------- one translation lane ---------- */
class Lane {
  constructor(name, target, ui) { Object.assign(this, { name, target, ui, ws: null, ready: false, running: false, sinks: [], retries: 0, speechAt: 0, waitingFirst: false }); }
  async start(stream, sinks) {
    this.running = true; this.sinks = sinks; this.stream = stream;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule(workletURL);
    this.src = this.ctx.createMediaStreamSource(stream);
    this.node = new AudioWorkletNode(this.ctx, 'tap');
    this.src.connect(this.node);
    const mute = this.ctx.createGain(); mute.gain.value = 0; this.node.connect(mute); mute.connect(this.ctx.destination);
    this.node.port.onmessage = e => this.onChunk(e.data);
    this.connect();
  }
  setGate(on) { if (this.node) this.node.port.postMessage({ gate: on }); }
  connect() {
    const k = KEY(); if (!k) { this.ui.status('no key', 'err'); return; }
    this.ui.status('connecting…');
    const ws = new WebSocket(WS(k)); this.ws = ws; this.ready = false;
    ws.onopen = () => ws.send(JSON.stringify({ setup: { model: 'models/' + MODEL,
      generationConfig: { responseModalities: ['AUDIO'], translationConfig: { targetLanguageCode: this.target, echoTargetLanguage: false } },
      inputAudioTranscription: {}, outputAudioTranscription: {} } }));
    ws.onmessage = async ev => { const txt = typeof ev.data === 'string' ? ev.data : await ev.data.text(); let m; try { m = JSON.parse(txt); } catch (e) { return; } this.onMsg(m); };
    ws.onclose = ev => {
      this.ready = false; if (!this.running) { this.ui.status('stopped'); return; }
      const code = ev.code; this.ui.status(`reconnecting (${code})`, code === 1007 || code === 1008 ? 'err' : '');
      if (code === 1007 || code === 1008) { toast(`${this.name}: ${ev.reason || 'rejected'}`, 6000); this.running = false; return; }
      const wait = Math.min(4000, 300 * Math.pow(2, this.retries++)); setTimeout(() => this.running && this.connect(), wait);
    };
    ws.onerror = () => {};
  }
  onMsg(m) {
    if (m.setupComplete) { this.ready = true; this.retries = 0; this.ui.status('live', 'on'); return; }
    if (m.goAway) { try { this.ws.close(); } catch (e) {} return; }
    const sc = m.serverContent; if (!sc) return;
    if (sc.inputTranscription && sc.inputTranscription.text) this.ui.onIn(sc.inputTranscription.text);
    if (sc.outputTranscription && sc.outputTranscription.text) this.ui.onOut(sc.outputTranscription.text);
    const parts = sc.modelTurn && sc.modelTurn.parts || [];
    for (const p of parts) {
      const d = p.inlineData || p.inline_data; if (!d || !d.data) continue;
      const i16 = int16FromB64(d.data); const f = new Float32Array(i16.length); for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
      if (this.waitingFirst) { let r = 0; for (let i = 0; i < f.length; i += 8) r += f[i] * f[i]; if (Math.sqrt(r / (f.length / 8)) > 0.01) { this.waitingFirst = false; this.ui.delay((performance.now() - this.speechAt) / 1000); } }
      for (const s of this.sinks) s.play(f);
    }
  }
  onChunk({ pcm, rms, gate }) {
    this.ui.level(gate ? rms : 0);
    if (gate && rms > 0.02 && !this.waitingFirst && performance.now() - this.speechAt > 4000) { this.speechAt = performance.now(); this.waitingFirst = true; }
    if (this.ws && this.ready && this.ws.readyState === 1) this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: b64FromInt16(pcm), mimeType: 'audio/pcm;rate=16000' } } }));
  }
  stop() {
    this.running = false; try { this.ws && this.ws.close(); } catch (e) {}
    try { this.ctx && this.ctx.close(); } catch (e) {}
    this.sinks.forEach(s => s.close()); this.sinks = [];
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.ui.level(0); this.ui.status('idle', '');
  }
}

/* ---------- transcript ---------- */
const T = { items: [], cur: { me: null, cl: null }, timers: {} };
function bubble(lane) {
  if (T.cur[lane]) return T.cur[lane];
  $('#empty') && $('#empty').remove();
  const isMe = lane === 'me';
  const item = { lane, src: '', tr: '', t: new Date(), el: document.createElement('div') };
  item.el.className = 'msg live ' + (isMe ? 'me' : 'client');
  item.el.innerHTML = `<div class="who">${isMe ? 'You' : 'Client'} <span>${item.t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div><div class="o" dir="${isMe ? 'rtl' : 'ltr'}"></div><div class="t" dir="${isMe ? 'ltr' : 'rtl'}"></div>`;
  $('#feed').append(item.el); T.items.push(item); T.cur[lane] = item; return item;
}
function touch(lane) {
  clearTimeout(T.timers[lane]);
  T.timers[lane] = setTimeout(() => finalize(lane), 1800);
  const f = $('#feed'); if (f.scrollHeight - f.scrollTop - f.clientHeight < 240) f.scrollTop = f.scrollHeight;
}
const EDIT_RE = /\b(make|change|move|bigger|smaller|larger|increase|decrease|color|colour|button|headline|title|font|text|remove|delete|add|swap|replace|darker|brighter|lighter|logo|size|story|square|banner|cta|price|percent|%|bold|center|left|right|up|down)\b/i;
function finalize(lane) {
  const it = T.cur[lane]; if (!it) return; T.cur[lane] = null; it.el.classList.remove('live');
  $('#btnSave').disabled = false; $('#btnRecap').disabled = false;
  if (lane === 'cl') {
    const acts = document.createElement('div'); acts.className = 'acts';
    const b = document.createElement('button'); b.textContent = 'Send to Studio';
    b.onclick = () => { LIVE && LIVE.postMessage({ type: 'client_said', en: it.src.trim(), ar: it.tr.trim(), who: 'Client' }); b.textContent = 'Sent'; b.classList.add('sent'); };
    acts.append(b); it.el.append(acts);
    if ($('#optStudio').checked && EDIT_RE.test(it.src)) b.click();
  }
}
function uiFor(lane) {
  const st = $(lane === 'me' ? '#stMe' : '#stCl'), m = $(lane === 'me' ? '#mMe' : '#mCl'), card = $(lane === 'me' ? '#laneMe' : '#laneCl');
  return {
    status(t, cls = '') { st.textContent = t; card.classList.toggle('on', cls === 'on'); card.classList.toggle('err', cls === 'err'); updateStat(); },
    level(r) { m.style.width = Math.min(100, Math.round(r * 420)) + '%'; },
    onIn(t) { const b = bubble(lane); b.src += t; b.el.querySelector('.o').textContent = b.src.trim(); touch(lane); },
    onOut(t) { const b = bubble(lane); b.tr += t; b.el.querySelector('.t').textContent = b.tr.trim(); touch(lane); },
    delay(s) { st.textContent = `live · ${s.toFixed(1)}s`; },
  };
}
function updateStat() { $('#stat').textContent = `You→EN: ${$('#stMe').textContent} · Client→AR: ${$('#stCl').textContent}`; }

/* ---------- devices ---------- */
async function listDevices(ask) {
  if (ask) { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); } catch (e) {} }
  const ds = await navigator.mediaDevices.enumerateDevices();
  const fill = (sel, kind, saved, extra = []) => {
    sel.innerHTML = ''; for (const [v, l] of extra) sel.append(new Option(l, v));
    for (const d of ds.filter(d => d.kind === kind)) sel.append(new Option(d.label || (kind === 'audioinput' ? 'Microphone' : 'Speaker') + ' ' + d.deviceId.slice(0, 4), (kind === 'audioinput' && sel.id === 'selClientSrc' ? 'dev:' : '') + d.deviceId));
    if (saved && [...sel.options].some(o => o.value === saved)) sel.value = saved;
  };
  fill($('#selMic'), 'audioinput', store.get('mic'));
  fill($('#selOutEn'), 'audiooutput', store.get('outEn'));
  fill($('#selOutAr'), 'audiooutput', store.get('outAr'));
  fill($('#selClientSrc'), 'audioinput', store.get('clSrc'), [['tab', 'Share the meeting tab / screen audio']]);
  if (!store.get('outEn')) { const cab = [...$('#selOutEn').options].find(o => /cable input|vb-audio/i.test(o.text)); if (cab) $('#selOutEn').value = cab.value; }
  if (!store.get('outAr')) { const hp = [...$('#selOutAr').options].find(o => !/cable|vb-audio/i.test(o.text)); if (hp) $('#selOutAr').value = hp.value; }
  const cableSeen = ds.some(d => /cable|vb-audio/i.test(d.label));
  $('#srcMe').textContent = cableSeen ? 'Virtual cable found. Your English goes there.' : 'Virtual cable not found yet. Install VB-Cable and restart Chrome.';
}

/* ---------- session ---------- */
let laneMe = null, laneCl = null, muted = false, pttDown = false;
async function start() {
  if (!KEY()) { $('#keyWarn').hidden = false; toast('Add the key in the Studio first.'); return; }
  $('#btnStart').disabled = true;
  try {
    // your voice
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: $('#selMic').value ? { exact: $('#selMic').value } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const sinksMe = [await new Sink($('#selOutEn').value, 1).init()];
    if ($('#optMon').checked) sinksMe.push(await new Sink($('#selOutAr').value, 0.55).init());
    const mix = +$('#optMix').value / 100;
    if (mix > 0) { const c = sinksMe[0].ctx; const s = c.createMediaStreamSource(mic); const g = c.createGain(); g.gain.value = mix; s.connect(g); g.connect(c.destination); }
    laneMe = new Lane('You → English', 'en', uiFor('me'));
    await laneMe.start(mic, sinksMe);
    applyGate();
    // client voice
    let clStream;
    const srcSel = $('#selClientSrc').value;
    if (srcSel === 'tab') {
      clStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { suppressLocalAudioPlayback: !$('#optOrig').checked, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include' });
      clStream.getVideoTracks().forEach(t => t.stop());
      if (!clStream.getAudioTracks().length) { toast('No audio was shared. Pick the meeting tab and tick “Also share tab audio”.', 6000); }
      $('#srcCl').textContent = 'Capturing: ' + (clStream.getAudioTracks()[0]?.label || 'shared audio');
    } else {
      clStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: srcSel.slice(4) }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      $('#srcCl').textContent = 'Capturing: ' + $('#selClientSrc').selectedOptions[0].text;
    }
    if (clStream.getAudioTracks().length) {
      laneCl = new Lane('Client → Arabic', 'ar', uiFor('cl'));
      await laneCl.start(clStream, [await new Sink($('#selOutAr').value, 1).init()]);
    }
    $('#btnStart').textContent = 'Stop'; $('#btnStart').className = 'pill stop'; $('#btnStart').disabled = false; $('#btnStart').onclick = stop;
    $('#btnMute').disabled = false; $('#btnRecap').disabled = false;
    listDevices(false);
  } catch (e) {
    console.error(e); toast('Could not start: ' + e.message, 6000); stop();
  }
}
function stop() {
  laneMe && laneMe.stop(); laneCl && laneCl.stop(); laneMe = laneCl = null;
  $('#btnStart').textContent = 'Start interpreting'; $('#btnStart').className = 'pill go'; $('#btnStart').disabled = false; $('#btnStart').onclick = start;
  $('#btnMute').disabled = true;
}
function applyGate() { const ptt = $('#optPtt').checked; $('#btnPtt').hidden = !ptt; laneMe && laneMe.setGate(!muted && (!ptt || pttDown)); $('#btnPtt').classList.toggle('live', ptt && pttDown); }

/* ---------- recap ---------- */
function transcriptText() {
  return T.items.map(i => `[${i.t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}] ${i.lane === 'me' ? 'Danverse' : 'Client'}: ${i.lane === 'me' ? i.tr.trim() + '  (original: ' + i.src.trim() + ')' : i.src.trim()}`).join('\n');
}
async function recap() {
  const text = transcriptText(); if (!text.trim()) { toast('Nothing recorded yet.'); return; }
  const body = $('#recapBody'); body.innerHTML = '<h2>Building the recap…</h2>'; $('#recapModal').hidden = false;
  const prompt = `This is a transcript of a call between Danverse (creative director, his lines are machine-translated from Arabic) and a client about an Al Fakher Two Apples shisha ad campaign (Halloween, 30% off, code SHISHA, shisha-test.com).
Return JSON: {"summary": string (3-4 sentences), "decisions": [string], "client_requests": [string, each a concrete, actionable edit or deliverable], "next_steps": [string], "email_subject": string, "email_body": string (short, warm, professional follow-up from Danverse in English, confirming decisions and next steps with a clear timeline; no mention of AI, tools or translation)}.
Transcript:\n${text}`;
  const models = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash'];
  let out, err;
  for (const m of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY() }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, responseMimeType: 'application/json' } }) });
      if (!r.ok) { err = new Error(m + ' ' + r.status); continue; }
      const j = await r.json(); const t = (j.candidates?.[0]?.content?.parts || []).filter(p => p.text && !p.thought).pop().text;
      out = JSON.parse(t.replace(/^```(?:json)?\s*|\s*```$/g, '')); break;
    } catch (e) { err = e; }
  }
  if (!out) { body.innerHTML = `<h2>Recap failed</h2><p>${(err && err.message) || ''}</p><div class="row"><button class="pill" onclick="document.querySelector('#recapModal').hidden=true">Close</button></div>`; return; }
  const esc = s => String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const list = a => '<ul>' + (a || []).map(x => `<li>${esc(x)}</li>`).join('') + '</ul>';
  body.innerHTML = `<h2>Call recap</h2><p>${esc(out.summary)}</p>
    <h4>Decisions</h4>${list(out.decisions)}<h4>Client requests</h4>${list(out.client_requests)}<h4>Next steps</h4>${list(out.next_steps)}
    <h4>Follow-up email</h4><pre><b>${esc(out.email_subject)}</b>\n\n${esc(out.email_body)}</pre>
    <div class="row"><button class="pill" id="rcStudio">Send requests to Studio</button><button class="pill" id="rcCopy">Copy email</button><button class="pill go" id="rcClose">Done</button></div>`;
  $('#rcCopy').onclick = async () => { try { await navigator.clipboard.writeText(`${out.email_subject}\n\n${out.email_body}`); toast('Email copied'); } catch (e) { toast('Copy failed'); } };
  $('#rcStudio').onclick = () => { (out.client_requests || []).forEach(r => LIVE && LIVE.postMessage({ type: 'action_item', en: r, who: 'Recap' })); toast('Sent to Studio'); };
  $('#rcClose').onclick = () => $('#recapModal').hidden = true;
}
function saveTranscript() {
  const blob = new Blob([transcriptText()], { type: 'text/plain' }); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `call-transcript-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/* ---------- wiring ---------- */
for (const [id, k] of [['#selMic', 'mic'], ['#selOutEn', 'outEn'], ['#selOutAr', 'outAr'], ['#selClientSrc', 'clSrc']]) $(id).addEventListener('change', e => store.set(k, e.target.value));
for (const id of ['optPtt', 'optOrig', 'optMon', 'optStudio']) { const e = $('#' + id); e.checked = store.get(id, e.checked); e.addEventListener('change', () => { store.set(id, e.checked); applyGate(); }); }
$('#optMix').value = store.get('optMix', 0); $('#optMix').addEventListener('change', e => store.set('optMix', +e.target.value));
$('#btnStart').onclick = start;
$('#btnMute').onclick = () => { muted = !muted; $('#btnMute').textContent = muted ? 'Unmute me' : 'Mute me'; $('#btnMute').classList.toggle('stop', muted); applyGate(); };
$('#btnSave').onclick = saveTranscript;
$('#btnRecap').onclick = recap;
$('#recapModal').addEventListener('click', e => { if (e.target.id === 'recapModal') e.target.hidden = true; });
const ptt = $('#btnPtt');
ptt.addEventListener('pointerdown', () => { pttDown = true; applyGate(); }); ptt.addEventListener('pointerup', () => { pttDown = false; applyGate(); }); ptt.addEventListener('pointerleave', () => { if (pttDown) { pttDown = false; applyGate(); } });
document.addEventListener('keydown', e => { if (e.code === 'Space' && $('#optPtt').checked && !e.repeat && !e.target.closest('input,select,textarea')) { e.preventDefault(); pttDown = true; applyGate(); } });
document.addEventListener('keyup', e => { if (e.code === 'Space' && pttDown) { pttDown = false; applyGate(); } });
navigator.mediaDevices.addEventListener('devicechange', () => listDevices(false));
if (!KEY()) $('#keyWarn').hidden = false;
listDevices(true);
updateStat();
