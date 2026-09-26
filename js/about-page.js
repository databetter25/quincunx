// 소개 페이지의 작은 인터랙티브 그림들

import { initPage, $, bindRange, prefersReducedMotion } from './common.js';
import { chart } from './charts.js';
import { GaltonBoard } from './board.js';
import { binomPmf, choose, normalPdf, theorySingle } from './model.js';
import { randomSeed, createRng } from './rng.js';
import { totalVariation, fmt } from './stats.js';
import { ko } from './i18n/ko.js';

initPage();

const svgNS = 'http://www.w3.org/2000/svg';
const V = (name) => `var(${name})`;

/* ---------------- 1. 이름의 유래 ---------------- */
{
  const box = $('#fig-name');
  const W = 600, H = 230;
  const s = 34; // 핀 간격
  let pins = '';
  const rows = 6, cols = 9;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - (r % 2); c++) {
      const x = 250 + c * s + (r % 2) * (s / 2), y = 30 + r * s;
      pins += `<circle class="qx-pin" data-r="${r}" data-c="${c}" cx="${x}" cy="${y}" r="5.5" style="fill:${V('--c-pin')};cursor:pointer" tabindex="0" aria-label="핀 ${r + 1}행 ${c + 1}번째"></circle>`;
    }
  }
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="주사위 5의 눈과 퀸컹스 핀 배열">
    <rect x="30" y="45" width="140" height="140" rx="22" style="fill:${V('--c-bg-alt')};stroke:${V('--c-border')}"/>
    ${[[62, 77], [138, 77], [100, 115], [62, 153], [138, 153]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="13" style="fill:${V('--c-blue')}"/>`).join('')}
    <text x="100" y="212" text-anchor="middle" font-size="13" style="fill:${V('--c-text-secondary')}">quincunx = 다섯 점</text>
    <path d="M190 115 h36" style="stroke:${V('--c-text-tertiary')}" stroke-width="2" marker-end="url(#arr)"/>
    <defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" style="fill:${V('--c-text-tertiary')}"/></marker></defs>
    <g id="qx-hi"></g>
    ${pins}
  </svg>`;
  const hi = box.querySelector('#qx-hi');
  const highlight = (el) => {
    const x = +el.getAttribute('cx'), y = +el.getAttribute('cy');
    const pts = [[x, y], [x - s / 2, y - s], [x + s / 2, y - s], [x - s / 2, y + s], [x + s / 2, y + s]];
    hi.innerHTML =
      `<path d="M${x - s / 2} ${y - s} L${x + s / 2} ${y + s} M${x + s / 2} ${y - s} L${x - s / 2} ${y + s}" style="stroke:${V('--c-blue')};opacity:.35" stroke-width="2"/>` +
      pts.map(([px, py]) => `<circle cx="${px}" cy="${py}" r="11" style="fill:${V('--c-blue')};opacity:.18"/>`).join('') +
      '';
  };
  box.querySelectorAll('.qx-pin').forEach((el) => {
    el.addEventListener('mouseenter', () => highlight(el));
    el.addEventListener('focus', () => highlight(el));
    el.addEventListener('click', () => highlight(el));
  });
  highlight(box.querySelector('.qx-pin[data-r="2"][data-c="4"]'));
}

/* ---------------- 3. 한 개의 공, 여러 번의 동전 ---------------- */
{
  const n = 6;
  const box = $('#fig-coin');
  const W = 420, H = 300, dx = W / (n + 2), dy = 34, top = 26;
  let rng = createRng(randomSeed());
  let path = [];
  const pinsSvg = () => {
    let s = '';
    for (let r = 0; r < n; r++) for (let j = 0; j <= r; j++) {
      s += `<circle cx="${W / 2 + (j - r / 2) * dx}" cy="${top + r * dy + 12}" r="4" style="fill:${V('--c-pin')}"/>`;
    }
    for (let k = 0; k <= n + 1; k++) {
      const x = W / 2 + (k - 0.5 - n / 2) * dx;
      s += `<line x1="${x}" y1="${top + n * dy + 10}" x2="${x}" y2="${H - 22}" style="stroke:${V('--c-border')}"/>`;
    }
    for (let k = 0; k <= n; k++) s += `<text x="${W / 2 + (k - n / 2) * dx}" y="${H - 6}" text-anchor="middle" font-size="12" style="fill:${V('--c-text-tertiary')}">${k}</text>`;
    return s;
  };
  const pos = (r, rights) => [W / 2 + (rights - r / 2) * dx, top + r * dy];
  const draw = () => {
    let rights = 0;
    const pts = [pos(0, 0)];
    path.forEach((b, r) => { rights += b; pts.push(pos(r + 1, rights)); });
    const [bx, by] = pts[pts.length - 1];
    const done = path.length === n;
    const landY = H - 34;
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="공 하나가 한 행씩 내려가는 그림">
      ${pinsSvg()}
      <polyline points="${pts.map((p) => p.join(',')).join(' ')}${done ? ` ${bx},${landY}` : ''}" fill="none" style="stroke:${V('--c-trace')}" stroke-width="3" stroke-linejoin="round"/>
      ${done ? `<rect x="${bx - dx / 2 + 3}" y="${landY - 8}" width="${dx - 6}" height="${H - 22 - landY + 8}" rx="3" style="fill:${V('--c-blue-bg')}"/>` : ''}
      <circle cx="${bx}" cy="${done ? landY : by}" r="8" style="fill:${V('--c-blue')}"/>
    </svg>`;
    const log = $('#coin-log');
    if (!path.length) log.textContent = '출발! 버튼을 눌러 한 행씩 내려가 보세요.';
    else {
      const seq = path.map((b) => (b ? '오른쪽(1)' : '왼쪽(0)')).join(' → ');
      log.textContent = done ? `${seq}  ⇒  1의 개수 = ${rights} → 칸 ${rights}에 도착` : `${seq}  (지금까지 오른쪽 ${rights}번)`;
    }
    $('#coin-step').disabled = done;
  };
  $('#coin-step').addEventListener('click', () => { if (path.length < n) { path.push(rng.next() < 0.5 ? 1 : 0); draw(); } });
  $('#coin-new').addEventListener('click', () => { path = []; rng = createRng(randomSeed()); draw(); });
  draw();
}

/* ---------------- 4. 파스칼 삼각형 ---------------- */
{
  const box = $('#fig-pascal');
  let n = 7;
  const draw = () => {
    const show = $('#pascal-toggle').checked;
    const W = 560, dx = W / (n + 2), dy = Math.min(44, 300 / n), top = 24;
    const histTop = top + n * dy + 10, histH = 110, H = histTop + histH + 26;
    let s = '';
    for (let r = 0; r <= n - 1; r++) for (let j = 0; j <= r; j++) {
      const x = W / 2 + (j - r / 2) * dx, y = top + r * dy;
      s += `<circle cx="${x}" cy="${y}" r="${show ? 12 : 4}" style="fill:${show ? V('--c-blue-bg') : V('--c-pin')};stroke:${show ? V('--c-blue') : 'none'}"/>`;
      if (show) s += `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="${choose(r, j) > 99 ? 9 : 11}" font-weight="600" style="fill:${V('--c-blue')}">${choose(r, j)}</text>`;
    }
    const maxC = choose(n, Math.floor(n / 2));
    for (let k = 0; k <= n; k++) {
      const x = W / 2 + (k - n / 2) * dx, c = choose(n, k), h = (c / maxC) * histH;
      s += `<rect x="${x - dx * 0.38}" y="${histTop + histH - h}" width="${dx * 0.76}" height="${h}" rx="3" style="fill:${V('--c-bar-alpha')}"><title>칸 ${k}: 경로 ${c}가지</title></rect>`;
      s += `<text x="${x}" y="${histTop + histH - h - 4}" text-anchor="middle" font-size="11" style="fill:${V('--c-text-secondary')}">${c}</text>`;
      s += `<text x="${x}" y="${H - 6}" text-anchor="middle" font-size="11" style="fill:${V('--c-text-tertiary')}">k=${k}</text>`;
    }
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="파스칼 삼각형과 칸별 경로 수">${s}</svg>`;
  };
  bindRange($('#rg-pascal'), $('#in-pascal'), { onInput: (v) => { n = v; draw(); }, onChange: (v) => { n = v; draw(); } });
  $('#pascal-toggle').addEventListener('change', draw);
  draw();
}

/* ---------------- 5. 종 모양 ---------------- */
{
  const box = $('#fig-bell');
  let n = 4;
  const render = chart(box, (c) => {
    const th = theorySingle(n, 0.5);
    const pts = [];
    for (let i = 0; i <= 200; i++) { const x = -0.6 + ((n + 1.2) * i) / 200; pts.push([x, normalPdf((x - th.mean) / th.sd) / th.sd]); }
    const ymax = Math.max(...th.pmf, ...pts.map((q) => q[1])) * 1.12;
    return {
      title: '이항분포와 정규 곡선', height: 300,
      x: { domain: [-0.6, n + 0.6], integer: true, label: ko.axisBin },
      y: { domain: [0, ymax], label: ko.axisProb },
      layers: [
        { type: 'bars', data: th.pmf.map((y, x) => ({ x, y, title: `P(K=${x}) = ${y.toFixed(4)}` })), color: c.barAlpha },
        { type: 'line', points: pts, color: c.normal, dash: '6 4', width: 2 },
      ],
      legend: [{ kind: 'bar', color: c.barAlpha, label: `Bin(${n}, 0.5)` }, { kind: 'dash', color: c.normal, label: `정규 곡선 N(${fmt(th.mean, 1)}, ${fmt(th.variance, 2)})` }],
    };
  });
  const cap = () => {
    const th = theorySingle(n, 0.5);
    $('#bell-caption').textContent = `n = ${n}: 평균 ${fmt(th.mean, 1)}, 표준편차 ${fmt(th.sd, 3)}. 이항분포와 (연속성 보정) 정규 근사의 총변동거리 ${fmt(totalVariation(th.pmf, th.normal), 4)} — n이 커질수록 0에 가까워집니다.`;
  };
  bindRange($('#rg-bell'), $('#in-bell'), { onInput: (v) => { n = v; render(); cap(); }, onChange: (v) => { n = v; render(); cap(); } });
  cap();
}

/* ---------------- 6. 편향된 보드 ---------------- */
{
  const box = $('#fig-bias');
  const n = 20;
  let p = 0.7;
  const base = binomPmf(n, 0.5);
  const render = chart(box, (c) => {
    const pmf = binomPmf(n, p);
    const ymax = Math.max(...pmf, ...base) * 1.12;
    return {
      title: '편향된 보드의 분포', height: 300,
      x: { domain: [-0.6, n + 0.6], integer: true, label: ko.axisBin },
      y: { domain: [0, Math.min(1.05, ymax)], label: ko.axisProb },
      layers: [
        { type: 'bars', data: pmf.map((y, x) => ({ x, y })), color: c.barAlpha },
        { type: 'step', points: base.map((y, x) => [x, y]), color: c.text3, width: 1.5, dash: '4 3' },
        { type: 'line', points: [[n * p, 0], [n * p, Math.min(1.05, ymax)]], color: c.theory, width: 2, dash: '6 4' },
      ],
      legend: [{ kind: 'bar', color: c.barAlpha, label: `Bin(${n}, ${p})` }, { kind: 'dash', color: c.text3, label: 'p = 0.5 (비교)' }, { kind: 'dash', color: c.theory, label: '평균 np' }],
    };
  });
  const cap = () => {
    const th = theorySingle(n, p);
    $('#bias-caption').textContent = `n = ${n}, p = ${p}: 평균 np = ${fmt(th.mean, 2)}, 분산 np(1−p) = ${fmt(th.variance, 3)}, 왜도 ${fmt(th.skewness, 3)}.`;
  };
  bindRange($('#rg-bias'), $('#in-bias'), { onInput: (v) => { p = v; render(); cap(); }, onChange: (v) => { p = v; render(); cap(); } });
  cap();
}

/* ---------------- 7. 2단계 퀸컹스 ---------------- */
{
  const btnDrop = $('#two-drop'), btnGate = $('#two-gate'), btnReset = $('#two-reset');
  let open = false;
  const setGateBtn = () => {
    btnGate.textContent = open ? '칸막이 닫기' : '칸막이 열기';
    btnGate.setAttribute('aria-pressed', String(open));
  };
  const board = new GaltonBoard($('#fig-two'), {
    stages: [{ rows: 6, p: 0.5 }, { rows: 6, p: 0.5 }],
    N: 400, seed: randomSeed(), speed: 8, ballSize: 5, gate: 'manual', colorByMid: true,
    showBinom: false, showNormal: false, aspect: 1.0, maxHeight: 560,
    onStateChange: (s) => { btnDrop.disabled = s === 'running'; },
  });
  btnDrop.addEventListener('click', () => {
    if (board.state === 'done' || board.dropped >= 400) { board.configure({ seed: randomSeed() }); open = false; setGateBtn(); }
    if (prefersReducedMotion()) board.setDisplay({ speed: 10 });
    board.start();
  });
  btnGate.addEventListener('click', () => { open = !open; board.setGate(open); setGateBtn(); });
  btnReset.addEventListener('click', () => { board.configure({ seed: randomSeed() }); open = false; setGateBtn(); });
  setGateBtn();
}
