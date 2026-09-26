// 가벼운 SVG 차트 — 막대·누적 막대·선·점·열지도, PNG 내려받기
// 색은 그릴 때 테마 토큰 값을 그대로 넣어, PNG로 내보내도 같은 모습이 된다.

import { themeColors, onThemeChange } from './common.js';
import { downloadBlob } from './store.js';

const NS = 'http://www.w3.org/2000/svg';
const registry = new Set();
onThemeChange(() => registry.forEach((fn) => fn()));

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

export function niceTicks(min, max, count = 6) {
  if (!(max > min)) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

function fmtTick(v) {
  if (Math.abs(v) >= 10000) return v.toLocaleString('ko-KR');
  if (Number.isInteger(v)) return String(v).replace('-', '−');
  const s = Math.abs(v) < 0.01 ? v.toExponential(0) : String(Number(v.toPrecision(3)));
  return s.replace('-', '−');
}

/**
 * 차트를 그린다. 테마가 바뀌면 자동으로 다시 그린다.
 * @param {HTMLElement} container
 * @param {() => object} specFn 호출할 때마다 사양을 만든다(테마 색 반영)
 */
export function chart(container, specFn) {
  const render = () => {
    const c = themeColors();
    const spec = specFn(c);
    container.innerHTML = '';
    const svg = drawChart(spec, c);
    container.appendChild(svg);
    if (spec.legend?.length) container.appendChild(legendEl(spec.legend, c));
    container._svg = svg;
    container._title = spec.title;
  };
  render();
  registry.add(render);
  container._render = render;
  return render;
}

export function unregister(container) {
  if (container._render) registry.delete(container._render);
}

function legendEl(items, c) {
  const div = document.createElement('div');
  div.className = 'chart-legend';
  for (const it of items) {
    const span = document.createElement('span');
    span.innerHTML = swatch(it, c) + `<span>${it.label}</span>`;
    div.appendChild(span);
  }
  return div;
}

export function swatch(it, c = themeColors()) {
  const col = it.color || c.blue;
  switch (it.kind) {
    case 'line':
      return `<svg width="24" height="10" aria-hidden="true"><line x1="0" y1="5" x2="24" y2="5" stroke="${col}" stroke-width="2"/></svg>`;
    case 'dash':
      return `<svg width="24" height="10" aria-hidden="true"><line x1="0" y1="5" x2="24" y2="5" stroke="${col}" stroke-width="2" stroke-dasharray="5 3"/></svg>`;
    case 'point':
      return `<svg width="14" height="12" aria-hidden="true"><circle cx="7" cy="6" r="4" fill="${c.bg}" stroke="${col}" stroke-width="1.8"/></svg>`;
    case 'dot':
      return `<svg width="14" height="12" aria-hidden="true"><circle cx="7" cy="6" r="4" fill="${col}"/></svg>`;
    default:
      return `<svg width="16" height="12" aria-hidden="true"><rect x="1" y="1" width="14" height="10" rx="2" fill="${col}"/></svg>`;
  }
}

function drawChart(spec, c) {
  const W = spec.width || 640, H = spec.height || 320;
  const m = { top: 16, right: 16, bottom: 46, left: 58, ...spec.margin };
  const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': spec.title || '그래프', 'font-family': c.font || 'sans-serif' });
  el('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent', class: 'chart-bg' }, svg);

  const xs = spec.x || {}, ys = spec.y || {};
  const [x0, x1] = xs.domain || [0, 1];
  const [y0, y1] = ys.domain || [0, 1];
  const lx = xs.log ? (v) => Math.log10(v) : (v) => v;
  const X = (v) => m.left + ((lx(v) - lx(x0)) / (lx(x1) - lx(x0) || 1)) * iw;
  const Y = (v) => m.top + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
  const scale = { X, Y, iw, ih, m };

  // 격자·축
  const grid = el('g', {}, svg);
  const yt = ys.ticks || niceTicks(y0, y1, ys.tickCount || 5);
  for (const t of yt) {
    if (t < y0 - 1e-12 || t > y1 + 1e-12) continue;
    el('line', { x1: m.left, x2: m.left + iw, y1: Y(t), y2: Y(t), stroke: c.borderLt, 'stroke-width': 1 }, grid);
    const tx = el('text', { x: m.left - 6, y: Y(t) + 4, 'text-anchor': 'end', 'font-size': 11, fill: c.text2 }, grid);
    tx.textContent = ys.format ? ys.format(t) : fmtTick(t);
  }
  let xt = xs.ticks;
  if (!xt) {
    if (xs.log) {
      xt = [];
      for (let p = Math.ceil(Math.log10(x0)); p <= Math.floor(Math.log10(x1)); p++) xt.push(Math.pow(10, p));
    } else if (xs.integer) {
      const span = x1 - x0;
      const step = Math.max(1, Math.ceil(span / 16));
      const nice = step <= 1 ? 1 : step <= 2 ? 2 : step <= 5 ? 5 : 10;
      xt = [];
      for (let v = Math.ceil(x0 / nice) * nice; v <= x1; v += nice) xt.push(v);
    } else xt = niceTicks(x0, x1, xs.tickCount || 6);
  }
  for (const t of xt) {
    if (t < x0 - 1e-12 || t > x1 + 1e-12) continue;
    if (xs.grid) el('line', { x1: X(t), x2: X(t), y1: m.top, y2: m.top + ih, stroke: c.borderLt }, grid);
    el('line', { x1: X(t), x2: X(t), y1: m.top + ih, y2: m.top + ih + 4, stroke: c.border }, grid);
    const tx = el('text', { x: X(t), y: m.top + ih + 17, 'text-anchor': 'middle', 'font-size': 11, fill: c.text2 }, grid);
    tx.textContent = xs.format ? xs.format(t) : fmtTick(t);
  }
  el('line', { x1: m.left, x2: m.left + iw, y1: m.top + ih + 0.5, y2: m.top + ih + 0.5, stroke: c.border }, grid);
  if (xs.label) {
    const t = el('text', { x: m.left + iw / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 12, fill: c.text2 }, svg);
    t.textContent = xs.label;
  }
  if (ys.label) {
    const t = el('text', { x: 14, y: m.top + ih / 2, 'text-anchor': 'middle', 'font-size': 12, fill: c.text2, transform: `rotate(-90 14 ${m.top + ih / 2})` }, svg);
    t.textContent = ys.label;
  }

  const clipId = `clip${Math.random().toString(36).slice(2, 8)}`;
  const defs = el('defs', {}, svg);
  const cp = el('clipPath', { id: clipId }, defs);
  el('rect', { x: m.left, y: m.top - 2, width: iw, height: ih + 2 }, cp);
  const plot = el('g', { 'clip-path': `url(#${clipId})` }, svg);

  for (const layer of spec.layers || []) drawLayer(plot, layer, scale, c);
  if (spec.after) spec.after(svg, scale, c, el);
  return svg;
}

function drawLayer(g, L, s, c) {
  const { X, Y } = s;
  switch (L.type) {
    case 'bars': {
      const bw = L.barWidth ?? 0.8;
      for (const d of L.data) {
        if (!d.y) continue;
        const xa = X(d.x - bw / 2), xb = X(d.x + bw / 2);
        const ya = Y(Math.max(0, d.y)), yb = Y(Math.min(0, d.y));
        const r = el('rect', { x: xa, y: ya, width: Math.max(0.5, xb - xa), height: Math.max(0, yb - ya), fill: d.color || L.color || c.barAlpha, opacity: L.opacity }, g);
        if (d.title) el('title', {}, r).textContent = d.title;
      }
      break;
    }
    case 'stack': {
      const bw = L.barWidth ?? 0.8;
      for (const d of L.data) {
        let acc = 0;
        for (const p of d.parts) {
          if (!p.y) continue;
          const xa = X(d.x - bw / 2), xb = X(d.x + bw / 2);
          el('rect', { x: xa, y: Y(acc + p.y), width: Math.max(0.5, xb - xa), height: Math.max(0, Y(acc) - Y(acc + p.y)), fill: p.color }, g);
          acc += p.y;
        }
      }
      break;
    }
    case 'line': {
      const pts = L.points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (pts.length < 2) break;
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(2)},${Y(p[1]).toFixed(2)}`).join('');
      el('path', { d, fill: 'none', stroke: L.color || c.text, 'stroke-width': L.width || 2, 'stroke-dasharray': L.dash ? L.dash : undefined, 'stroke-linejoin': 'round', opacity: L.opacity }, g);
      break;
    }
    case 'step': {
      // 막대 윤곽선(여러 실행 비교용)
      const pts = [];
      for (const p of L.points) { pts.push([p[0] - 0.5, p[1]], [p[0] + 0.5, p[1]]); }
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(2)},${Y(p[1]).toFixed(2)}`).join('');
      el('path', { d, fill: 'none', stroke: L.color, 'stroke-width': L.width || 2, 'stroke-dasharray': L.dash }, g);
      break;
    }
    case 'points': {
      const r = L.r ?? 4;
      for (const p of L.points) {
        if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
        const circ = el('circle', {
          cx: X(p[0]), cy: Y(p[1]), r: p[2] ?? r,
          fill: L.hollow ? c.bg : L.color || c.blue,
          stroke: L.hollow ? L.color || c.theory : L.stroke || 'none',
          'stroke-width': L.hollow ? 1.8 : 1, opacity: L.opacity,
        }, g);
        if (p[3]) el('title', {}, circ).textContent = p[3];
      }
      break;
    }
    case 'segments': {
      for (const [a, b, cc, d] of L.segs) {
        el('line', { x1: X(a), y1: Y(b), x2: X(cc), y2: Y(d), stroke: L.color || c.text2, 'stroke-width': L.width || 1.5, opacity: L.opacity }, g);
      }
      break;
    }
    case 'hline': {
      el('line', { x1: s.m.left, x2: s.m.left + s.iw, y1: Y(L.y), y2: Y(L.y), stroke: L.color || c.text2, 'stroke-width': L.width || 1.5, 'stroke-dasharray': L.dash || '6 4' }, g);
      break;
    }
    case 'heat': {
      const max = L.max || Math.max(1, ...L.cells.map((d) => d.v));
      for (const d of L.cells) {
        if (!d.v) continue;
        const t = Math.pow(d.v / max, L.gamma ?? 0.6);
        const r = el('rect', {
          x: X(d.x - 0.5), y: Y(d.y + 0.5), width: X(d.x + 0.5) - X(d.x - 0.5) + 0.3, height: Y(d.y - 0.5) - Y(d.y + 0.5) + 0.3,
          fill: L.colorFn ? L.colorFn(t) : c.blue, opacity: L.colorFn ? 1 : 0.1 + 0.9 * t,
        }, g);
        el('title', {}, r).textContent = d.title || String(d.v);
      }
      break;
    }
    default:
      break;
  }
}

/* ---------------- PNG 내려받기 ---------------- */

export async function downloadPNG(container, filename) {
  const svg = container._svg || container.querySelector('svg');
  if (!svg) return;
  const c = themeColors();
  const clone = svg.cloneNode(true);
  const vb = svg.viewBox.baseVal;
  const W = vb?.width || svg.clientWidth, H = vb?.height || svg.clientHeight;
  clone.setAttribute('width', W);
  clone.setAttribute('height', H);
  clone.setAttribute('xmlns', NS);
  const bg = clone.querySelector('.chart-bg');
  if (bg) bg.setAttribute('fill', c.bg || '#fff');
  // 범례를 그림 아래에 붙인다
  const legendItems = [...container.querySelectorAll('.chart-legend > span')];
  let extra = 0;
  if (legendItems.length) {
    extra = 26;
    clone.setAttribute('height', H + extra);
    clone.setAttribute('viewBox', `0 0 ${W} ${H + extra}`);
    el('rect', { x: 0, y: H, width: W, height: extra, fill: c.bg || '#fff' }, clone);
    let x = 12;
    for (const it of legendItems) {
      const label = it.textContent;
      const sw = it.querySelector('svg');
      if (sw) {
        const g = el('g', { transform: `translate(${x}, ${H + 7})` }, clone);
        g.innerHTML = sw.innerHTML;
        x += Number(sw.getAttribute('width')) + 5;
      }
      const t = el('text', { x, y: H + 16, 'font-size': 11, fill: c.text2, 'font-family': c.font || 'sans-serif' }, clone);
      t.textContent = label;
      x += label.length * 11 + 16;
    }
  }
  const xml = new XMLSerializer().serializeToString(clone);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  const img = new Image();
  const scale = 2;
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const cv = document.createElement('canvas');
  cv.width = W * scale;
  cv.height = (H + extra) * scale;
  const g = cv.getContext('2d');
  g.fillStyle = c.bg || '#fff';
  g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(img, 0, 0, cv.width, cv.height);
  cv.toBlob((b) => b && downloadBlob(filename, b), 'image/png');
}
