// 1단계 시뮬레이션 페이지

import { initPage, $, bindRange, logSlider, compute, prefersReducedMotion, toast, themeColors, onThemeChange } from './common.js';
import { GaltonBoard } from './board.js';
import { theorySingle, choose, drawPath } from './model.js';
import { createRng, randomSeed, parseSeed } from './rng.js';
import { describeCounts, fmt, fmtInt } from './stats.js';
import { loadSettings, saveSettings, makeRun, saveRun } from './store.js';
import { swatch } from './charts.js';
import { ko, t } from './i18n/ko.js';

initPage();

const DEFAULTS = {
  N: 1000, n: 12, p: 0.5, speed: 5, ballSize: 4, seed: '',
  mode: prefersReducedMotion() ? 'instant' : 'anim',
  showBinom: true, showNormal: true,
};
const S = loadSettings('single', DEFAULTS);
if (prefersReducedMotion() && !localStorage.getItem('quincunx:single')) S.mode = 'instant';

let seedUsed = 0;
let theory = theorySingle(S.n, S.p);
let positions = null; // 공 번호 순서의 도착 칸
let arrivedFlag = null;

/* ---------------- 입력 ---------------- */

const persist = () => saveSettings('single', S);

const ctlN = bindRange($('#rg-N'), $('#in-N'), { ...logSlider(1, 100000), onChange: (v) => { S.N = v; persist(); resetRun(); } });
const ctln = bindRange($('#rg-n'), $('#in-n'), { onChange: (v) => { S.n = v; persist(); resetRun(); }, onInput: (v) => { S.n = v; } });
const ctlp = bindRange($('#rg-p'), $('#in-p'), { onChange: (v) => { S.p = v; persist(); resetRun(); } });
const ctlSpeed = bindRange($('#rg-speed'), $('#in-speed'), { onInput: (v) => { S.speed = v; board.setDisplay({ speed: v }); persist(); } });
const ctlSize = bindRange($('#rg-size'), $('#in-size'), { onInput: (v) => { S.ballSize = v; board.setDisplay({ ballSize: v }); board.resize(); persist(); } });
ctlN.set(S.N); ctln.set(S.n); ctlp.set(S.p); ctlSpeed.set(S.speed); ctlSize.set(S.ballSize);

const seedInput = $('#in-seed');
seedInput.value = S.seed;
seedInput.addEventListener('change', () => { S.seed = seedInput.value.trim(); persist(); resetRun(); });
$('#btn-seed-auto').addEventListener('click', () => { seedInput.value = ''; S.seed = ''; persist(); resetRun(); });

document.querySelectorAll('input[name="mode"]').forEach((r) => {
  r.checked = r.value === S.mode;
  r.addEventListener('change', () => { if (r.checked) { S.mode = r.value; persist(); updateButtons(board.state); } });
});

const ckBinom = $('#ck-binom'), ckNormal = $('#ck-normal'), ckTrace = $('#ck-trace');
ckBinom.checked = S.showBinom;
ckNormal.checked = S.showNormal;
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
  stages: [{ rows: S.n, p: S.p }],
  N: S.N, seed: 1, speed: S.speed, ballSize: S.ballSize,
  showBinom: S.showBinom, showNormal: S.showNormal,
  theory: { pmf: theory.pmf, mean: theory.mean, sd: theory.sd },
  aspect: 0.82, maxHeight: Math.max(420, window.innerHeight * 0.78),
  onArrive: (i, _mid, k) => { positions[i] = k; arrivedFlag[i] = 1; },
  onProgress: throttle(updateStats, 60),
  onStateChange: (s) => { updateButtons(s); if (s === 'done' || s === 'paused') { updateStats(); updateTable(); } },
});

function drawLegend() {
  const c = themeColors();
  $('#board-legend').innerHTML = [
    `<span>${swatch({ kind: 'bar', color: c.barAlpha })}관측 도수 (막대)</span>`,
    `<span>${swatch({ kind: 'point', color: c.theory })}이항 확률 × 도착 공 수 (점)</span>`,
    `<span>${swatch({ kind: 'dash', color: c.normal })}정규 근사 곡선 (점선)</span>`,
    `<span>${swatch({ kind: 'line', color: c.trace })}경로 추적</span>`,
  ].join('');
}
drawLegend();
onThemeChange(drawLegend);

function resetRun() {
  const fixed = parseSeed(S.seed);
  seedUsed = fixed ?? randomSeed();
  theory = theorySingle(S.n, S.p);
  positions = new Uint8Array(S.N);
  arrivedFlag = new Uint8Array(S.N);
  board.configure({
    stages: [{ rows: S.n, p: S.p }], N: S.N, seed: seedUsed,
    theory: { pmf: theory.pmf, mean: theory.mean, sd: theory.sd },
  });
  board.traceNext = ckTrace.checked;
  $('#seed-line').textContent = `${t('seedUsed', seedUsed)}${fixed === null ? ' (자동)' : ' (고정)'}`;
  $('#st-mean-th').textContent = fmt(theory.mean);
  $('#st-sd-th').textContent = fmt(theory.sd);
  $('#st-target').textContent = `/ ${fmtInt(S.N)}`;
  hideTip();
  updateStats();
  updateTable();
}

/* ---------------- 버튼 ---------------- */


btnStart.addEventListener('click', async () => {
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
  const res = await compute('single', { n: S.n, p: S.p, N: S.N, seed: seedUsed });
  positions = res.positions;
  arrivedFlag = null;
  // 경로 추적: 마지막 공의 경로를 같은 난수열에서 다시 뽑는다
  let tracePath = null;
  if (ckTrace.checked) {
    const rng = createRng(seedUsed);
    const path = new Uint8Array(S.n);
    for (let i = 0; i < S.N; i++) drawPath(rng, S.n, S.p, path);
    tracePath = path;
  }
  board.setInstantResult({ finalCounts: res.counts, tracePath });
  updateStats();
  updateTable();
  setStatus(t('instantDone', S.N, res.ms));
}

function updateButtons(state) {
  const running = state === 'running';
  btnStart.disabled = running;
  btnStart.textContent = state === 'paused' ? ko.resume : state === 'done' ? '다시 실행' : ko.start;
  btnPause.disabled = !(running || state === 'stepping');
  btnOne.disabled = S.mode === 'instant' || running;
  btnSend.disabled = board.arrived === 0 || running || state === 'stepping';
  if (state !== 'done' || !board.instant) {
    setStatus(
      `${{ idle: ko.ready, running: ko.running, paused: ko.paused, stepping: ko.running, done: ko.done }[state]} · ${t('arrived', board.arrived, S.N)}`
    );
  }
}

function setStatus(s) {
  $('#status').textContent = s;
}

/* ---------------- 통계·도수표 ---------------- */

function updateStats() {
  const d = describeCounts(board.finalCounts);
  $('#st-arrived').textContent = fmtInt(board.arrived);
  $('#st-mean').textContent = d.N ? fmt(d.mean) : '—';
  $('#st-sd').textContent = d.N > 1 ? fmt(d.sd) : '—';
  if (board.state === 'running') setStatus(`${ko.running} · ${t('arrived', board.arrived, S.N)}`);
}

function updateTable() {
  const tb = $('#freq-table tbody');
  const n = board.arrived;
  tb.innerHTML = board.finalCounts
    .map((o, k) => `<tr><td>${k}</td><td>${fmtInt(o)}</td><td>${fmt(theory.pmf[k] * n, 2)}</td><td>${fmt(theory.pmf[k], 5)}</td><td>${fmtInt(choose(S.n, k))}</td></tr>`)
    .join('');
}

/* ---------------- 칸 툴팁 ---------------- */

const tip = $('#tooltip');
function hideTip() { tip.hidden = true; }
$('#board').addEventListener('click', (e) => {
  const hit = board.hitTest(e.clientX, e.clientY);
  if (!hit || hit.zone !== 'final') return hideTip();
  const k = hit.k, n = board.arrived;
  tip.innerHTML = `<b>${t('tipBin', k)}</b><br>${ko.tipObs}: ${fmtInt(board.finalCounts[k])}<br>${ko.tipExp}: ${fmt(theory.pmf[k] * n, 2)}<br>${ko.tipProb}: ${fmt(theory.pmf[k], 5)}<br>${ko.tipPaths}: ${fmtInt(choose(S.n, k))}`;
  tip.hidden = false;
  const wrap = $('.board-wrap').getBoundingClientRect();
  const left = Math.min(Math.max(4, hit.x + 12), wrap.width - tip.offsetWidth - 4);
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(4, hit.y - tip.offsetHeight - 10)}px`;
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });

/* ---------------- 분석으로 보내기 ---------------- */

async function sendToAnalysis() {
  if (!board.arrived) return toast(ko.noResult);
  let pos;
  if (arrivedFlag) {
    const idx = [];
    for (let i = 0; i < arrivedFlag.length; i++) if (arrivedFlag[i]) idx.push(positions[i]);
    pos = Uint8Array.from(idx);
  } else pos = positions;
  const run = makeRun('single', {
    seed: seedUsed,
    mode: board.instant ? 'instant' : 'animation',
    settings: { n: S.n, p: S.p, N: S.N },
    N: board.arrived,
    counts: board.finalCounts.slice(),
    positions: pos,
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

// 분석 페이지의 "동일 설정 재실행" 링크: single.html#n=..&p=..&N=..&seed=..
const hp = new URLSearchParams(location.hash.slice(1));
if (hp.has('n')) {
  S.n = Math.min(40, Math.max(1, +hp.get('n') || S.n));
  if (hp.has('p')) S.p = Math.min(1, Math.max(0, Number(hp.get('p')) || 0));
  S.N = Math.min(100000, Math.max(1, +hp.get('N') || S.N));
  S.seed = hp.get('seed') || '';
  ctlN.set(S.N); ctln.set(S.n); ctlp.set(S.p); seedInput.value = S.seed;
  persist();
}
resetRun();
