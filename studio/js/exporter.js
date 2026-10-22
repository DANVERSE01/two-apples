/* exporter.js — PNG / ZIP / layered PSD (live text layers) */
'use strict';

const BASENAME = 'TwoApples_Halloween';
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const canvasBlob = (c, type = 'image/png', q) => new Promise(r => c.toBlob(r, type, q));
function fileName(fmt, scale, ext, suffix = '') {
  const F = FORMATS[fmt]; return `${BASENAME}_${F.label}_${F.w * scale}x${F.h * scale}${S.lang === 'ar' ? '_AR' : ''}${suffix}.${ext}`;
}

async function exportPNG(fmt = S.fmt, scale = 1) {
  const c = renderToCanvas(fmt, scale);
  download(await canvasBlob(c), fileName(fmt, scale, 'png'));
}
async function exportZIP() {
  const zip = new JSZip();
  for (const f of FMT_KEYS) {
    zip.file(fileName(f, 1, 'png'), await canvasBlob(renderToCanvas(f, 1)));
    zip.file('2x/' + fileName(f, 2, 'png'), await canvasBlob(renderToCanvas(f, 2)));
  }
  download(await zip.generateAsync({ type: 'blob' }), `${BASENAME}_All-Sizes${S.lang === 'ar' ? '_AR' : ''}.zip`);
}

const PS_WEIGHT = { 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold' };
function psFontName(layer) {
  const fam = fontFamily(layer).replace(/\s+/g, '');
  const w = layer.props.weight || 400; const near = Object.keys(PS_WEIGHT).reduce((a, b) => Math.abs(b - w) < Math.abs(a - w) ? b : a);
  return `${fam}-${PS_WEIGHT[near]}${layer.props.italic ? 'Italic' : ''}`.replace('RegularItalic', 'Italic');
}
function rgb(hexStr) {
  const c = document.createElement('canvas').getContext('2d'); c.fillStyle = hexStr; const v = c.fillStyle;
  if (v.startsWith('#')) return { r: parseInt(v.slice(1, 3), 16), g: parseInt(v.slice(3, 5), 16), b: parseInt(v.slice(5, 7), 16) };
  const m = v.match(/\d+(\.\d+)?/g).map(Number); return { r: m[0], g: m[1], b: m[2] };
}

function buildPSD(fmt, scale = 2) {
  const F = FORMATS[fmt]; const W = F.w * scale, Hh = F.h * scale;
  const children = [];
  const bg = document.createElement('canvas'); bg.width = W; bg.height = Hh; bg.getContext('2d').drawImage(sceneCanvas(fmt, scale), 0, 0);
  children.push({ name: 'Background · photography', canvas: bg, top: 0, left: 0 });
  for (const layer of S.layers) {
    if (layer.type === 'scene') continue;
    const base = { name: layer.name, hidden: !layer.visible, opacity: layer.opacity };
    if (layer.type === 'image') {
      const c = renderToCanvas(fmt, scale, { only: layer.id });
      const saved = layer.visible; layer.visible = true; const c2 = renderToCanvas(fmt, scale, { only: layer.id }); layer.visible = saved;
      children.push(Object.assign(base, { canvas: saved ? c : c2, top: 0, left: 0, opacity: 1, protected: layer.brand ? { transparency: true, composite: true, position: false } : undefined }));
      if (layer.brand) children[children.length - 1].name = layer.name + ' (brand-locked)';
    } else if (layer.type === 'text') {
      const saved = layer.visible; layer.visible = true; const c = renderToCanvas(fmt, scale, { only: layer.id }); layer.visible = saved;
      const G = textGeom(layer, fmt); const p = layer.props; const rad = (G.rot || 0) * Math.PI / 180;
      const al = S.lang === 'ar' ? 'right' : p.align;
      const ox = (al === 'right' ? G.x + G.w : al === 'center' ? G.x + G.w / 2 : G.x) * scale;
      children.push(Object.assign(base, { canvas: c, top: 0, left: 0,
        text: {
          text: textOf(layer),
          transform: [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), ox, G.base * scale],
          style: { font: { name: psFontName(layer) }, fontSize: G.fs * scale, fillColor: rgb(p.color), tracking: S.lang === 'ar' ? 0 : Math.round((p.tracking || 0) * 1000), leading: (p.lh || 1.2) * G.fs * scale, autoLeading: false },
          paragraphStyle: { justification: al },
        } }));
    } else if (layer.type === 'button') {
      const saved = { v: layer.visible, c: layer.props.color, a: layer.props.arrow, t: layer.props.text, ta: layer.props.textAr };
      layer.visible = true; layer.props.color = 'rgba(0,0,0,0)';
      const shape = renderToCanvas(fmt, scale, { only: layer.id });
      layer.props.color = saved.c;
      const G = buttonGeom(layer, fmt); const p = layer.props;
      const labelColor = p.style === 'outline' ? p.bg : p.style === 'glass' && /^#(3E2315|24150C)$/i.test(p.color) ? CREAM : p.color;
      const keep = { bg: p.bg, style: p.style, fx: layer.fx, color: p.color };
      p.bg = 'rgba(0,0,0,0)'; p.style = 'solid'; layer.fx = {}; p.color = labelColor;
      const label = renderToCanvas(fmt, scale, { only: layer.id });
      p.bg = keep.bg; p.style = keep.style; layer.fx = keep.fx; p.color = keep.color;
      layer.visible = saved.v;
      const tx = G.x + (G.w - G.m.w - G.arrow) / 2; const by = G.y + G.h / 2 + G.fs * 0.36;
      children.push({ name: layer.name, hidden: !layer.visible, opacity: layer.opacity, opened: true, children: [
        { name: 'Button shape', canvas: shape, top: 0, left: 0 },
        { name: 'Button label', canvas: label, top: 0, left: 0,
          text: { text: textOf(layer), transform: [1, 0, 0, 1, (S.lang === 'ar' ? tx + G.m.w + G.arrow : tx) * scale, by * scale],
            style: { font: { name: psFontName(layer) }, fontSize: G.fs * scale, fillColor: rgb(labelColor), tracking: Math.round((p.tracking || 0) * 1000) },
            paragraphStyle: { justification: S.lang === 'ar' ? 'right' : 'left' } } },
      ] });
    }
  }
  const comp = renderToCanvas(fmt, scale);
  return { width: W, height: Hh, children, canvas: comp };
}
async function exportPSD(fmt = S.fmt) {
  const psd = buildPSD(fmt, 2);
  const buf = agPsd.writePsd(psd, { invalidateTextLayers: true, generateThumbnail: true });
  download(new Blob([buf], { type: 'image/vnd.adobe.photoshop' }), fileName(fmt, 2, 'psd', '_LAYERED'));
}
async function exportPSDAll() {
  const zip = new JSZip();
  for (const f of FMT_KEYS) { const buf = agPsd.writePsd(buildPSD(f, 2), { invalidateTextLayers: true, generateThumbnail: true }); zip.file(fileName(f, 2, 'psd', '_LAYERED'), buf); }
  try { for (const [n, u] of [['Newsreader.ttf', 'fonts/Newsreader.ttf'], ['Inter.ttf', 'fonts/Inter.ttf']]) { const r = await fetch(u); if (r.ok) zip.file('fonts/' + n, await r.blob()); } } catch (e) {}
  download(await zip.generateAsync({ type: 'blob' }), `${BASENAME}_Layered-PSD_All-Sizes${S.lang === 'ar' ? '_AR' : ''}.zip`);
}
