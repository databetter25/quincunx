// 2단계 시뮬레이션 페이지

import { initPage, $, bindRange, logSlider, compute, prefersReducedMotion, toast, themeColors, onThemeChange } from './common.js';
import { GaltonBoard } from './board.js';
import { theoryTwo, binPalette } from './model.js';
import { createRng, randomSeed, parseSeed } from './rng.js';
import { describeCounts, crossStats, conditionalMid, fmt, fmtInt } from './stats.js';
import { loadSettings, saveSettings, makeRun, saveRun } from './store.js';
import { chart, swatch } from './charts.js';
import { ko, t } from './i18n/ko.js';

initPage();

const DEFAULTS = {
  N: 2000, n1: 8, n2: 8, p1: 0.5, p2: 0.5, gate: 'one', speed: 6, ballSize: 4, seed: '',
  mode: prefersReducedMotion() ? 'instant' : 'anim',
  colorByMid: true, showBinom: true, showNormal: false,
};
const S = loadSettings('two', DEFAULTS);

let seedUsed = 0;
let theory = theoryTwo(S.n1, S.p1, S.n2, S.p2);
let mids = null, finals = null, arrivedFlag = null;
let selectedFinal = null;

const persist = () => saveSettings('two', S);

/* ---------------- 입력 ---------------- */

const ctlN = bindRange($('#rg-N'), $('#in-N'), { ...logSlider(1, 50000), onChange: (v) => { S.N = v; persist(); resetRun(); } });
const ctln1 = bindRange($('#rg-n1'), $('#in-n1'), { onChange: (v) => { S.n1 = v; persist(); resetRun(); } });
const ctln2 = bindRange($('#rg-n2'), $('#in-n2'), { onChange: (v) => { S.n2 = v; persist(); resetRun(); } });
const ctlp1 = bindRange($('#rg-p1'), $('#in-p1'), { onChange: (v) => { S.p1 = v; persist(); resetRun(); } });
const ctlp2 = bindRange($('#rg-p2'), $('#in-p2'), { onChange: (v) => { S.p2 = v; persist(); resetRun(); } });
const ctlSpeed = bindRange($('#rg-speed'), $('#in-speed'), { onInput: (v) => { S.speed = v; board.setDisplay({ speed: v }); persist(); } });
const ctlSize = bindRange($('#rg-size'), $('#in-size'), { onInput: (v) => { S.ballSize = v; board.setDisplay({ ballSize: v }); board.resize(); persist(); } });
ctlN.set(S.N); ctln1.set(S.n1); ctln2.set(S.n2); ctlp1.set(S.p1); ctlp2.set(S.p2); ctlSpeed.set(S.speed); ctlSize.set(S.ballSize);

const seedInput = $('#in-seed');
seedInput.value = S.seed;
seedInput.addEventListener('change', () => { S.seed = seedInput.value.trim(); persist(); resetRun(); });
$('#btn-seed-auto').addEventListener('click', () => { seedInput.value = ''; S.seed = ''; persist(); resetRun(); });

document.querySelectorAll('input[name="mode"]').forEach((r) => {
  r.checked = r.value === S.mode;
  r.addEventListener('change', () => { if (r.checked) { S.mode = r.value; persist(); updateButtons(board.state); } });
});
document.querySelectorAll('input[name="gate"]').forEach((r) => {
  r.checked = r.value === S.gate;
  r.addEventListener('change', () => { if (r.checked) { S.gate = r.value; persist(); resetRun(); } });
});

const ckColor = $('#ck-color'), ckBinom = $('#ck-binom'), ckNormal = $('#ck-normal'), ckTrace = $('#ck-trace');
ckColor.checked = S.colorByMid;
ckBinom.checked = S.showBinom;
ckNormal.checked = S.showNormal;
ckColor.addEventListener('change', () => { S.colorByMid = ckColor.checked; board.setDisplay({ colorByMid: S.colorByMid }); persist(); drawMidChart(); drawLegend(); });
ckBinom.addEventListener('change', () => { S.showBinom = ckBinom.checked; board.setDisplay({ showBinom: S.showBinom }); persist(); });
ckNormal.addEventListener('change', () => { S.showNormal = ckNormal.checked; board.setDisplay({ showNormal: S.showNormal }); persist(); });
ckTrace.addEventListener('change', () => {
  board.traceNext = ckTrace.checked;
  if (!ckTrace.checked) { board.trace = null; board.draw(); }
});

if (window.matchMedia('(max-width: 1023px)').matches) $('#settings-box').open = false;

/* ---------------- 보드 ---------------- */

const btnStart = $('#btn-start'), btnPause = $('#btn-pause'), btnOne = $('#btn-one'), btnReset = $('#btn-reset'), btnSend = $('#btn-send');

const board = new GaltonBoard($('#board'), {
  stages: [{ rows: S.n1, p: S.p1 }, { rows: S.n2, p: S.p2 }],
  N: S.N, seed: 1, speed: S.speed, ballSize: S.ballSize, gate: S.gate,
  colorByMid: S.colorByMid, showBinom: S.showBinom, showNormal: S.showNormal,
  theory: boardTheory(),
  aspect: 1.15, maxHeight: Math.max(520, window.innerHeight * 0.9),
  onArrive: (i, mid, fin) => { mids[i] = mid; finals[i] = fin; arrivedFlag[i] = 1; },
  onStateChange: (s) => { updateButtons(s); if (s !== 'running') refreshAll(); },
  onGate: (phase, k) => {
    $('#gate-status').textContent = phase === 'open' ? ko.gateOpen : phase === 'opening' ? t('gateOpening', k) : ko.gateClosed;
  },
});
const slowRefresh = throttle(refreshAll, 400);
board.opts.onProgress = throttle(() => { updateStats(); slowRefresh(); }, 80);

function boardTheory() {
  return { pmf: theory.pmfY, mean: theory.meanY, sd: theory.sdY };
}

function drawLegend() {
  const c = themeColors();
  const baseLabel = S.p1 === S.p2 ? `1단계 Bin(${S.n1 + S.n2}, ${S.p1}) × 도착 수 (점)` : `Y의 이론 분포 × 도착 수 (점, p₁≠p₂)`;
  $('#board-legend').innerHTML = [
    `<span>${swatch({ kind: 'bar', color: S.colorByMid ? binPalette(S.n1 + 1)[Math.floor(S.n1 / 2)] : c.barAlpha })}최종 도수 (${S.colorByMid ? '중간 칸 색 누적 막대' : '막대'})</span>`,
    `<span>${swatch({ kind: 'point', color: c.theory })}${baseLabel}</span>`,
    `<span>${swatch({ kind: 'dash', color: c.normal })}정규 근사 (점선)</span>`,
    `<span>${swatch({ kind: 'line', color: c.trace })}역추적·경로 추적</span>`,
  ].join('');
}
onThemeChange(drawLegend);

function resetRun() {
  const fixed = parseSeed(S.seed);
  seedUsed = fixed ?? randomSeed();
  theory = theoryTwo(S.n1, S.p1, S.n2, S.p2);
  mids = new Uint8Array(S.N);
  finals = new Uint8Array(S.N);
  arrivedFlag = new Uint8Array(S.N);
  selectedFinal = null;
  board.configure({
    stages: [{ rows: S.n1, p: S.p1 }, { rows: S.n2, p: S.p2 }],
    N: S.N, seed: seedUsed, gate: S.gate, theory: boardTheory(),
  });
  board.traceNext = ckTrace.checked;
  $('#seed-badge').textContent = `시드 ${seedUsed}${fixed === null ? ' (자동)' : ''}`;
  $('#st-mean-th').textContent = fmt(theory.meanY);
  $('#st-sd-th').textContent = fmt(theory.sdY);
  $('#st-target').textContent = `/ ${fmtInt(S.N)}`;
  $('#gate-status').textContent = S.gate === 'pass' ? '칸막이 방식: 통과 (칸막이가 열려 있음)' : ko.gateClosed;
  $('#bt-body').innerHTML = '<p class="small muted" style="margin:0">실행 후 최종 칸을 눌러 보세요.</p>';
  hideTip();
  drawLegend();
  refreshAll();
}

/* ---------------- 버튼 ---------------- */

btnStart.addEventListener('click', () => {
  if (S.mode === 'instant') return runInstant();
  if (board.state === 'done' || board.instant) resetRun();
  if (S.N > 5000 && board.dropped === 0) {
    if (window.confirm(t('animLimit', S.N))) return runInstant();
  }
  board.start();
});
btnPause.addEventListener('click', () => board.pause());
btnOne.addEventListener('click', () => {
  if (board.state === 'done' || board.instant) resetRun();
  board.traceNext = ckTrace.checked;
  board.dropOne();
});
btnReset.addEventListener('click', () => resetRun());
btnSend.addEventListener('click', sendToAnalysis);

async function runInstant() {
  if (board.dropped > 0 || board.instant) resetRun();
  setStatus(ko.computing);
  btnStart.disabled = true;
  const res = await compute('two', { n1: S.n1, n2: S.n2, p1: S.p1, p2: S.p2, N: S.N, seed: seedUsed });
  mids = res.mids;
  finals = res.finals;
  arrivedFlag = null;
  let tracePath = null;
  if (ckTrace.checked) {
    const rng = createRng(seedUsed);
    const R = S.n1 + S.n2;
    tracePath = new Uint8Array(R);
    for (let i = 0; i < S.N; i++) {
      for (let r = 0; r < S.n1; r++) tracePath[r] = rng.next() < S.p1 ? 1 : 0;
      for (let r = 0; r < S.n2; r++) tracePath[S.n1 + r] = rng.next() < S.p2 ? 1 : 0;
    }
  }
  board.setInstantResult({ finalCounts: res.finalCounts, midCounts: res.midCounts, cross: res.cross, tracePath });
  $('#gate-status').textContent = '즉시 계산: 모든 공이 두 보드를 통과했습니다.';
  refreshAll();
  setStatus(t('instantDone', S.N, res.ms));
}

function updateButtons(state) {
  const running = state === 'running';
  btnStart.disabled = running;
  btnStart.textContent = state === 'paused' ? ko.resume : state === 'done' ? '다시 실행' : ko.start;
  btnPause.disabled = !(running || state === 'stepping');
  btnOne.disabled = S.mode === 'instant' || running;
  btnSend.disabled = board.arrived === 0 || running || state === 'stepping';
  if (!(state === 'done' && board.instant)) {
    setStatus(`${{ idle: ko.ready, running: ko.running, paused: ko.paused, stepping: ko.running, done: ko.done }[state]} · ${t('arrived', board.arrived, S.N)}`);
  }
}

function setStatus(s) {
  $('#status').textContent = s;
}

/* ---------------- 통계 ---------------- */

function updateStats() {
  const d = describeCounts(board.finalCounts);
  $('#st-arrived').textContent = fmtInt(board.arrived);
  $('#st-mean').textContent = d.N ? fmt(d.mean) : '—';
  $('#st-sd').textContent = d.N > 1 ? fmt(d.sd) : '—';
  if (board.state === 'running') setStatus(`${ko.running} · ${t('arrived', board.arrived, S.N)} · 중간 칸 도착 ${fmtInt(board.midCounts.reduce((a, b) => a + b, 0))}`);
}

function refreshAll() {
  updateStats();
  drawMidChart();
  updateVarTable();
  updateTables();
  if (selectedFinal !== null) showBacktrack(selectedFinal);
}

function drawMidChart() {
  const box = $('#mid-chart');
  const counts = board.midCounts;
  const n = counts.reduce((a, b) => a + b, 0);
  const pal = binPalette(S.n1 + 1);
  const ymax = Math.max(1, ...counts, ...theory.pmf1.map((p) => p * Math.max(n, 1))) * 1.12;
  chart(box, (c) => ({
    width: 460, height: 180, margin: { left: 48, bottom: 36, top: 8, right: 8 },
    title: '중간 칸 분포',
    x: { domain: [-0.6, S.n1 + 0.6], integer: true, label: ko.axisMid },
    y: { domain: [0, ymax], label: ko.axisCount, tickCount: 3 },
    layers: [
      { type: 'bars', data: counts.map((y, x) => ({ x, y, color: S.colorByMid ? pal[x] : c.barAlpha, title: `중간 칸 ${x}: ${y}` })) },
      n ? { type: 'points', hollow: true, color: c.theory, r: 3.2, points: theory.pmf1.map((p, x) => [x, p * n]) } : null,
    ].filter(Boolean),
  }));
}

function updateVarTable() {
  const tb = $('#var-table tbody');
  const nX = S.n1 + 1, nY = S.n1 + S.n2 + 1;
  const cs = board.arrived > 1 ? crossStats(board.cross, nX, nY) : null;
  const cov12 = cs ? cs.cov - cs.varX : NaN;
  const rows = [
    ['Var(X₁) 중간 위치', cs?.varX, theory.var1],
    ['Var(X₂) 아래 보드 이동', cs?.var2, theory.var2],
    ['Var(X₁) + Var(X₂)', cs ? cs.varX + cs.var2 : NaN, theory.var1 + theory.var2],
    ['Var(Y) 최종 위치', cs?.varY, theory.varY],
    ['2·Cov(X₁, X₂)', cs ? 2 * cov12 : NaN, 0],
    ['상관계수 r(X₁, Y)', cs?.r, theory.rho],
  ];
  tb.innerHTML = rows.map(([k, o, th]) => `<tr><td>${k}</td><td>${fmt(o)}</td><td>${fmt(th)}</td></tr>`).join('');
}

function updateTables() {
  const nMid = board.midCounts.reduce((a, b) => a + b, 0);
  $('#mid-table tbody').innerHTML = board.midCounts.map((o, k) => `<tr><td>${k}</td><td>${fmtInt(o)}</td><td>${fmt(theory.pmf1[k] * nMid, 2)}</td></tr>`).join('');
  $('#final-table tbody').innerHTML = board.finalCounts.map((o, k) => `<tr><td>${k}</td><td>${fmtInt(o)}</td><td>${fmt(theory.pmfY[k] * board.arrived, 2)}</td></tr>`).join('');
}

/* ---------------- 역추적 ---------------- */

function showBacktrack(y) {
  const nX = S.n1 + 1, nY = S.n1 + S.n2 + 1;
  const cm = conditionalMid(board.cross, nX, nY, y);
  const naive = y - theory.mean2; // E[Y|X₁] = X₁ + n₂p₂를 거꾸로 푼 값
  const pred = theory.interceptXonY + theory.slopeXonY * y;
  board.setHighlight({ final: y, dist: cm.dist, mean: cm.mean, naive });
  const body = $('#bt-body');
  if (!cm.n) {
    body.innerHTML = `<p class="small" style="margin:0">최종 칸 ${y}에 도착한 공이 아직 없습니다.</p>`;
    return;
  }
  const pull = cm.mean - naive;
  const dir = Math.abs(y - theory.meanY) < 0.5 ? '가운데 칸이라 당겨짐이 거의 없습니다.' :
    `단순 역산값보다 중앙 쪽(E[X₁] = ${fmt(theory.mean1, 2)})으로 ${fmt(Math.abs(pull), 2)}칸 당겨졌습니다.`;
  body.innerHTML = `
    <dl class="kv">
      <dt>선택한 최종 칸 Y</dt><dd>${y} (공 ${fmtInt(cm.n)}개)</dd>
      <dt>중간 칸 조건부 평균</dt><dd><b>${fmt(cm.mean, 3)}</b> (검은 실선)</dd>
      <dt>단순 역산 Y − n₂p₂</dt><dd>${fmt(naive, 3)} (빨간 점선)</dd>
      <dt>이론 회귀 예측</dt><dd>${fmt(pred, 3)} = ${fmt(theory.interceptXonY, 3)} + ${fmt(theory.slopeXonY, 3)}·Y</dd>
    </dl>
    <p class="interpret">${dir} 회귀 기울기 σ₁²/σ² = ${fmt(theory.slopeXonY, 3)} &lt; 1 이기 때문입니다.</p>`;
}

/* ---------------- 툴팁·클릭 ---------------- */

const tip = $('#tooltip');
function hideTip() { tip.hidden = true; }
$('#board').addEventListener('click', (e) => {
  const hit = board.hitTest(e.clientX, e.clientY);
  if (!hit) { hideTip(); return; }
  let html;
  if (hit.zone === 'final') {
    const k = hit.k;
    selectedFinal = k;
    showBacktrack(k);
    html = `<b>최종 칸 ${k}</b><br>${ko.tipObs}: ${fmtInt(board.finalCounts[k])}<br>${ko.tipExp}: ${fmt(theory.pmfY[k] * board.arrived, 2)}<br>이론 확률: ${fmt(theory.pmfY[k], 5)}`;
  } else {
    const k = hit.k;
    const n = board.midCounts.reduce((a, b) => a + b, 0);
    html = `<b>중간 칸 ${k}</b><br>도착 누적: ${fmtInt(board.midCounts[k])}<br>기대: ${fmt(theory.pmf1[k] * n, 2)}<br>현재 대기: ${fmtInt(board.heldCount[k])}`;
  }
  tip.innerHTML = html;
  tip.hidden = false;
  const wrap = $('.board-wrap').getBoundingClientRect();
  tip.style.left = `${Math.min(Math.max(4, hit.x + 12), wrap.width - tip.offsetWidth - 4)}px`;
  tip.style.top = `${Math.max(4, hit.y - tip.offsetHeight - 10)}px`;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideTip(); selectedFinal = null; board.setHighlight(null); }
});

/* ---------------- 분석으로 보내기 ---------------- */

async function sendToAnalysis() {
  if (!board.arrived) return toast(ko.noResult);
  let m = mids, f = finals;
  if (arrivedFlag) {
    const a = [], b = [];
    for (let i = 0; i < arrivedFlag.length; i++) if (arrivedFlag[i]) { a.push(mids[i]); b.push(finals[i]); }
    m = Uint8Array.from(a);
    f = Uint8Array.from(b);
  }
  const nX = S.n1 + 1, nY = S.n1 + S.n2 + 1;
  const midCounts = new Array(nX).fill(0);
  for (let x = 0; x < nX; x++) for (let y = 0; y < nY; y++) midCounts[x] += board.cross[x * nY + y];
  const run = makeRun('two', {
    seed: seedUsed,
    mode: board.instant ? 'instant' : 'animation',
    settings: { n1: S.n1, n2: S.n2, p1: S.p1, p2: S.p2, N: S.N, gate: S.gate },
    N: board.arrived,
    midCounts,
    finalCounts: board.finalCounts.slice(),
    cross: board.cross.slice(),
    mids: m,
    finals: f,
  });
  try {
    await saveRun(run);
    toast(ko.saved);
    setTimeout(() => (location.href = `analysis.html#run=${encodeURIComponent(run.id)}`), 500);
  } catch (err) {
    toast(t('saveFail', err.message), 4000);
  }
}

function throttle(fn, ms) {
  let last = 0, timer = 0;
  return () => {
    const now = performance.now();
    if (now - last >= ms) { last = now; fn(); }
    else if (!timer) timer = setTimeout(() => { timer = 0; last = performance.now(); fn(); }, ms);
  };
}

/* ---------------- 시작 ---------------- */

const hp = new URLSearchParams(location.hash.slice(1));
if (hp.has('n1')) {
  const num = (k, d, lo, hi) => (hp.has(k) && Number.isFinite(Number(hp.get(k))) ? Math.min(hi, Math.max(lo, Number(hp.get(k)))) : d);
  S.n1 = num('n1', S.n1, 1, 30); S.n2 = num('n2', S.n2, 1, 30);
  S.p1 = num('p1', S.p1, 0, 1); S.p2 = num('p2', S.p2, 0, 1);
  S.N = num('N', S.N, 1, 50000);
  if (hp.has('gate')) S.gate = hp.get('gate');
  S.seed = hp.get('seed') || '';
  ctlN.set(S.N); ctln1.set(S.n1); ctln2.set(S.n2); ctlp1.set(S.p1); ctlp2.set(S.p2); seedInput.value = S.seed;
  document.querySelectorAll('input[name="gate"]').forEach((r) => (r.checked = r.value === S.gate));
  persist();
}
resetRun();
