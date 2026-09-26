// 결과 분석 페이지: 실행 목록 관리, 1단계·2단계 분석

import { initPage, $, $$, compute, toast, escapeHtml, renderMath } from './common.js';
import { theorySingle, theoryTwo, binPalette, viridis, OKABE_ITO, normalPdf } from './model.js';
import {
  describeCounts, chiSquareTest, frequencyTable, convergencePath, qqPoints, totalVariation,
  crossStats, conditionalMid, conditionalMidMeans, conditionalFinalMeans, fmt, fmtInt, fmtP,
} from './stats.js';
import {
  listRuns, getRun, saveRun, deleteRun, renameRun, makeRun, runsToJSON, importJSON, runToCSV,
  downloadText, readFileText, toCSV, safeFilename,
} from './store.js';
import { chart, downloadPNG, unregister } from './charts.js';
import { ko } from './i18n/ko.js';

initPage();

let runs = [];
let tab = 'single';
const activeId = { single: null, two: null };
const checked = new Set();

/* ---------------- 목록 ---------------- */

async function refreshList() {
  try {
    runs = await listRuns();
  } catch (err) {
    $('#analysis-body').innerHTML = `<div class="panel empty-state">저장소를 열 수 없습니다: ${escapeHtml(err.message)}</div>`;
    return;
  }
  for (const id of [...checked]) if (!runs.some((r) => r.id === id)) checked.delete(id);
  for (const k of ['single', 'two']) if (activeId[k] && !runs.some((r) => r.id === activeId[k])) activeId[k] = null;
  renderList();
}

function metaText(r) {
  const s = r.settings;
  const date = new Date(r.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
  const set = r.type === 'single' ? `n=${s.n}, p=${s.p}` : `n₁=${s.n1}, n₂=${s.n2}, p₁=${s.p1}, p₂=${s.p2}, ${ko.gate[s.gate] || s.gate}`;
  return `${date} · ${set}<br>공 ${fmtInt(r.N)}개 · 시드 ${r.seed} · ${r.mode === 'instant' ? '즉시 계산' : '애니메이션'}`;
}

function renderList() {
  const list = $('#run-list');
  const mine = runs.filter((r) => r.type === tab);
  $('#run-count').textContent = String(mine.length);
  if (!mine.length) {
    list.innerHTML = `<li class="empty-state">${tab === 'single' ? '1단계' : '2단계'} 실행 결과가 없습니다.<br><a href="${tab === 'single' ? 'single.html' : 'two-stage.html'}">시뮬레이션하러 가기 →</a></li>`;
    renderAnalysis(null);
    return;
  }
  if (!activeId[tab] || !mine.some((r) => r.id === activeId[tab])) activeId[tab] = mine[0].id;
  list.innerHTML = mine
    .map(
      (r) => `<li class="run-row${r.id === activeId[tab] ? ' active' : ''}" data-id="${r.id}" tabindex="0" role="button" aria-pressed="${r.id === activeId[tab]}">
        <input type="checkbox" aria-label="${escapeHtml(r.name)} 선택" ${checked.has(r.id) ? 'checked' : ''} />
        <div><div class="run-name">${escapeHtml(r.name)} <span class="badge ${r.type === 'single' ? 'badge-blue' : 'badge-green'}">${r.type === 'single' ? '1단계' : '2단계'}</span></div>
        <div class="run-meta">${metaText(r)}</div></div>
      </li>`
    )
    .join('');
  $$('.run-row', list).forEach((row) => {
    const id = row.dataset.id;
    const cb = row.querySelector('input');
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      cb.checked ? checked.add(id) : checked.delete(id);
      if (tab === 'single') renderCompare();
    });
    const select = () => {
      if (activeId[tab] === id) return;
      activeId[tab] = id;
      history.replaceState(null, '', `#run=${encodeURIComponent(id)}`);
      renderList();
    };
    row.addEventListener('click', select);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
  });
  const run = mine.find((r) => r.id === activeId[tab]);
  if (renderAnalysis._id !== run.id) renderAnalysis(run);
}

function setTab(t) {
  tab = t;
  $('#tab-single').setAttribute('aria-selected', String(t === 'single'));
  $('#tab-two').setAttribute('aria-selected', String(t === 'two'));
  renderAnalysis._id = null;
  renderList();
}
$('#tab-single').addEventListener('click', () => setTab('single'));
$('#tab-two').addEventListener('click', () => setTab('two'));
$('.tab-nav').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    setTab(tab === 'single' ? 'two' : 'single');
    $(tab === 'single' ? '#tab-single' : '#tab-two').focus();
  }
});

/* ---------------- 가져오기·내보내기 ---------------- */

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const n = await importJSON(await readFileText(file));
    toast(`실행 결과 ${n}개를 가져왔습니다.`);
    await refreshList();
  } catch (err) {
    toast(err.message, 4000);
  }
  e.target.value = '';
});
$('#import-label').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#import-file').click(); }
});
$('#btn-export-sel').addEventListener('click', () => {
  const sel = runs.filter((r) => checked.has(r.id));
  if (!sel.length) return toast('내보낼 실행을 체크해 주세요.');
  downloadText(`quincunx-runs-${sel.length}.json`, runsToJSON(sel), 'application/json');
});
$('#btn-export-all').addEventListener('click', () => {
  if (!runs.length) return toast('저장된 실행이 없습니다.');
  downloadText(`quincunx-runs-all.json`, runsToJSON(runs), 'application/json');
});

/* ---------------- 공통 블록 ---------------- */

const charts = [];

function clearCharts() {
  charts.forEach(unregister);
  charts.length = 0;
}

/**
 * 분석 블록: 제목, 본문, PNG·CSV 버튼, 한 줄 해설
 */
function block(parent, title, { png, csv, csvName, pngName, note } = {}) {
  const sec = document.createElement('section');
  sec.className = 'panel a-block';
  const head = document.createElement('h3');
  head.className = 'panel-title';
  head.innerHTML = `<span>${title}</span><span class="btn-row"></span>`;
  sec.appendChild(head);
  const body = document.createElement('div');
  sec.appendChild(body);
  const btns = head.querySelector('.btn-row');
  if (png) {
    const b = document.createElement('button');
    b.className = 'btn btn-outline sm';
    b.type = 'button';
    b.textContent = 'PNG';
    b.setAttribute('aria-label', `${title} 그림 PNG로 내려받기`);
    b.addEventListener('click', () => {
      const box = typeof png === 'function' ? png() : png;
      if (box) downloadPNG(box, `${pngName || safeFilename(title)}.png`);
    });
    btns.appendChild(b);
  }
  if (csv) {
    const b = document.createElement('button');
    b.className = 'btn btn-outline sm';
    b.type = 'button';
    b.textContent = 'CSV';
    b.setAttribute('aria-label', `${title} 표 CSV로 내려받기`);
    b.addEventListener('click', () => downloadText(`${csvName || safeFilename(title)}.csv`, toCSV(csv()), 'text/csv'));
    btns.appendChild(b);
  }
  parent.appendChild(sec);
  if (note) {
    const p = document.createElement('p');
    p.className = 'small muted';
    p.style.margin = '0 0 10px';
    p.innerHTML = note;
    body.appendChild(p);
  }
  return { sec, body, interpret: (html) => {
    let el = sec.querySelector('.interpret');
    if (!el) { el = document.createElement('p'); el.className = 'interpret'; sec.appendChild(el); }
    el.innerHTML = html;
  } };
}

function chartBox(parent, specFn) {
  const box = document.createElement('div');
  box.className = 'chart';
  parent.appendChild(box);
  chart(box, specFn);
  charts.push(box);
  return box;
}

function table(parent, head, rows, { scroll = false, cls = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `table-wrap${scroll ? ' scroll-y' : ''}`;
  wrap.innerHTML = `<table class="data ${cls}"><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr${r._cls ? ` class="${r._cls}"` : ''}>${r.map((c) => (typeof c === 'object' && c !== null ? `<td class="${c.cls || ''}">${c.v}</td>` : `<td>${c}</td>`)).join('')}</tr>`)
    .join('')}</tbody></table>`;
  parent.appendChild(wrap);
  return wrap;
}

function signCls(v) {
  return v > 0 ? 'pos' : v < 0 ? 'neg' : '';
}

/* ---------------- 실행 머리글 ---------------- */

function renderHeader(root, run) {
  const s = run.settings;
  const sec = document.createElement('section');
  sec.className = 'panel a-block';
  const simHref = run.type === 'single'
    ? `single.html#n=${s.n}&p=${s.p}&N=${run.N}&seed=${run.seed}`
    : `two-stage.html#n1=${s.n1}&n2=${s.n2}&p1=${s.p1}&p2=${s.p2}&N=${run.N}&gate=${s.gate}&seed=${run.seed}`;
  sec.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;align-items:flex-start">
      <div>
        <h2 style="font-size:1.35rem;letter-spacing:-0.3px;margin-bottom:4px">${escapeHtml(run.name)}</h2>
        <p class="small muted" style="margin:0">${metaText(run)} · ${run.rng} · v${run.version}</p>
      </div>
      <div class="btn-row">
        <button class="btn btn-outline sm" data-act="rename" type="button">이름 바꾸기</button>
        <button class="btn btn-outline sm" data-act="json" type="button">JSON</button>
        <button class="btn btn-outline sm" data-act="csv" type="button">CSV</button>
        <button class="btn btn-outline sm" data-act="rerun" type="button" title="같은 시드·설정으로 즉시 계산해 새 실행으로 저장">동일 설정 재실행</button>
        <a class="btn btn-ghost sm" href="${simHref}">시뮬레이션에서 열기</a>
        <button class="btn btn-ghost sm" data-act="delete" type="button" style="color:var(--c-red)">삭제</button>
      </div>
    </div>`;
  sec.querySelector('[data-act="rename"]').addEventListener('click', async () => {
    const name = window.prompt('새 이름을 입력하세요.', run.name);
    if (!name || !name.trim()) return;
    await renameRun(run.id, name.trim());
    renderAnalysis._id = null;
    await refreshList();
  });
  sec.querySelector('[data-act="json"]').addEventListener('click', () => downloadText(`${safeFilename(run.name)}.json`, runsToJSON([run]), 'application/json'));
  sec.querySelector('[data-act="csv"]').addEventListener('click', () => downloadText(`${safeFilename(run.name)}.csv`, runToCSV(run), 'text/csv'));
  sec.querySelector('[data-act="delete"]').addEventListener('click', async () => {
    if (!window.confirm(`"${run.name}" 실행을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    await deleteRun(run.id);
    checked.delete(run.id);
    activeId[tab] = null;
    renderAnalysis._id = null;
    toast('삭제했습니다.');
    await refreshList();
  });
  sec.querySelector('[data-act="rerun"]').addEventListener('click', () => rerun(run));
  root.appendChild(sec);
}

async function rerun(run) {
  const s = run.settings;
  toast('같은 시드로 다시 계산하는 중…');
  const params = run.type === 'single'
    ? { n: s.n, p: s.p, N: run.N, seed: run.seed }
    : { n1: s.n1, n2: s.n2, p1: s.p1, p2: s.p2, N: run.N, seed: run.seed };
  const res = await compute(run.type, params);
  let next, same;
  if (run.type === 'single') {
    same = res.counts.join() === run.counts.join();
    next = makeRun('single', { name: `${run.name} (재실행)`, seed: run.seed, mode: 'instant', settings: { ...s, N: run.N }, N: run.N, counts: res.counts, positions: res.positions });
  } else {
    same = res.cross.join() === run.cross.join();
    next = makeRun('two', {
      name: `${run.name} (재실행)`, seed: run.seed, mode: 'instant', settings: { ...s, N: run.N }, N: run.N,
      midCounts: res.midCounts, finalCounts: res.finalCounts, cross: res.cross, mids: res.mids, finals: res.finals,
    });
  }
  await saveRun(next);
  activeId[tab] = next.id;
  renderAnalysis._id = null;
  await refreshList();
  toast(same ? '재실행 완료: 원래 결과와 도수가 완전히 같습니다.' : '재실행 완료: 원래 실행이 중간에 멈춘 실행이라 도수가 일부 다를 수 있습니다.', 4200);
}

/* ---------------- 분석 본문 ---------------- */

async function renderAnalysis(runLite) {
  const root = $('#analysis-body');
  clearCharts();
  renderAnalysis._id = runLite?.id || null;
  if (!runLite) {
    root.innerHTML = `<div class="panel empty-state">분석할 실행이 없습니다. 시뮬레이션 페이지에서 <b>분석으로 보내기</b>를 눌러 결과를 저장하거나, JSON 파일을 가져오세요.</div>`;
    return;
  }
  const run = (await getRun(runLite.id)) || runLite;
  root.innerHTML = '';
  renderHeader(root, run);
  if (run.type === 'single') renderSingle(root, run);
  else renderTwo(root, run);
  renderMath(root);
}

/* ======================= 1단계 ======================= */

function renderSingle(root, run) {
  const { n, p } = run.settings;
  const counts = run.counts;
  const th = theorySingle(n, p);
  const d = describeCounts(counts);
  const N = d.N;

  // 1. 기술통계
  {
    const b = block(root, '기술통계', {
      csv: () => [['항목', '관측', '이론'], ...descRows().map((r) => [r[0], r[1], r[2]])],
      csvName: `${safeFilename(run.name)}_기술통계`,
    });
    const descRows = () => [
      ['공 수 N', fmtInt(N), '—'],
      ['평균', fmt(d.mean, 4), fmt(th.mean, 4)],
      ['분산', fmt(d.variance, 4), fmt(th.variance, 4)],
      ['표준편차', fmt(d.sd, 4), fmt(th.sd, 4)],
      ['왜도 (skewness)', fmt(d.skewness, 4), fmt(th.skewness, 4)],
      ['초과첨도 (excess kurtosis)', fmt(d.exKurtosis, 4), fmt(th.exKurtosis, 4)],
      ['최빈값', d.mode, th.mode],
      ['중앙값', d.median, th.median],
      ['최솟값 / 최댓값', `${d.min} / ${d.max}`, `0 / ${n}`],
    ];
    table(b.body, ['항목', '관측', '이론 Bin(n, p)'], descRows());
    const se = th.sd / Math.sqrt(N);
    const z = se > 0 ? (d.mean - th.mean) / se : 0;
    b.interpret(
      `관측 평균 ${fmt(d.mean, 3)}은 이론 평균 np = ${fmt(th.mean, 3)}에서 표준오차 ${fmt(se, 4)}의 ${fmt(Math.abs(z), 2)}배 떨어져 있습니다${Math.abs(z) < 1.96 ? ' — 우연 변동 범위 안입니다.' : ' — 우연으로 보기엔 다소 큽니다.'}`
    );
  }

  // 2. 분포 비교
  {
    const b = block(root, '분포 비교 그림', { png: () => box, pngName: `${safeFilename(run.name)}_분포` });
    const ymax = Math.max(...counts, ...th.pmf.map((q) => q * N)) * 1.12;
    const box = chartBox(b.body, (c) => ({
      title: '관측 히스토그램과 이항·정규 분포', height: 330,
      x: { domain: [-0.6, n + 0.6], integer: true, label: ko.axisBin },
      y: { domain: [0, ymax], label: ko.axisCount },
      layers: [
        { type: 'bars', data: counts.map((y, x) => ({ x, y, title: `칸 ${x}: ${y}` })), color: c.barAlpha },
        { type: 'line', points: curve(th.mean, th.sd, N, -0.6, n + 0.6), color: c.normal, dash: '6 4', width: 1.8 },
        { type: 'points', hollow: true, color: c.theory, points: th.pmf.map((q, x) => [x, q * N, 4, `이항 기대 ${fmt(q * N, 2)}`]) },
      ],
      legend: [
        { kind: 'bar', color: c.barAlpha, label: ko.legendObs },
        { kind: 'point', color: c.theory, label: ko.legendBinom },
        { kind: 'dash', color: c.normal, label: ko.legendNormal },
      ],
    }));
  }

  // 3. 적합도 검정
  {
    const chi = chiSquareTest(counts, th.pmf);
    const b = block(root, '카이제곱 적합도 검정', {
      csv: () => [['칸 범위', '관측', '기대', '(O−E)²/E'], ...chi.groups.map((g) => [g.from === g.to ? g.from : `${g.from}–${g.to}`, g.o, g.e.toFixed(3), g.contrib.toFixed(4)])],
      csvName: `${safeFilename(run.name)}_카이제곱`,
      note: '귀무가설: 도착 칸이 \\(\\mathrm{Bin}(n,p)\\)를 따른다. 기대 도수가 5 미만인 칸은 이웃 칸과 병합했습니다.',
    });
    const sr = document.createElement('div');
    sr.className = 'stats-row';
    sr.style.marginBottom = '12px';
    sr.innerHTML = `
      <div class="stat-box"><div class="stat-label">통계량 χ²</div><div class="stat-num">${fmt(chi.stat, 3)}</div></div>
      <div class="stat-box"><div class="stat-label">자유도</div><div class="stat-num">${chi.df}</div></div>
      <div class="stat-box"><div class="stat-label">p값</div><div class="stat-num">${fmtP(chi.p)}</div></div>`;
    b.body.appendChild(sr);
    table(b.body, ['칸 범위', '관측 O', '기대 E', '(O−E)²/E'],
      chi.groups.map((g) => { const r = [g.from === g.to ? String(g.from) : `${g.from}–${g.to} (병합)`, fmtInt(g.o), fmt(g.e, 2), fmt(g.contrib, 4)]; if (g.to > g.from) r._cls = 'merged'; return r; }),
      { scroll: true });
    b.interpret(chi.df > 0 ? ko.interpretChi(chi.p, chi.df) : ko.interpretChiNA);
  }

  // 4. 도수표
  {
    const ft = frequencyTable(counts, th.pmf);
    const b = block(root, '도수표', {
      csv: () => [['칸 k', '관측 도수', '상대도수', '이항 확률', '기대 도수', '잔차', '표준화 잔차'], ...ft.map((r) => [r.k, r.o, r.rel.toFixed(6), r.p.toFixed(8), r.e.toFixed(3), r.resid.toFixed(3), Number.isFinite(r.stdResid) ? r.stdResid.toFixed(3) : ''])],
      csvName: `${safeFilename(run.name)}_도수표`,
      note: '표준화 잔차 = (관측 − 기대) / √(N·P(k)(1−P(k))). 절댓값이 2를 넘는 칸은 굵게 표시합니다.',
    });
    table(b.body, ['칸 k', '관측', '상대도수', '이항 확률', '기대', '잔차', '표준화 잔차'],
      ft.map((r) => [r.k, fmtInt(r.o), fmt(r.rel, 4), fmt(r.p, 5), fmt(r.e, 2), { v: fmt(r.resid, 2), cls: signCls(r.resid) }, { v: fmt(r.stdResid, 2), cls: `${signCls(r.stdResid)}${Math.abs(r.stdResid) > 2 ? ' hi' : ''}` }]),
      { scroll: true });
    const big = ft.filter((r) => Math.abs(r.stdResid) > 2).length;
    b.interpret(`표준화 잔차의 절댓값이 2를 넘는 칸: ${big}개 (칸 ${ft.length}개 중 약 5%는 우연히 넘을 수 있습니다).`);
  }

  // 5. 수렴 그림
  {
    const b = block(root, '수렴 그림', { png: () => boxMean, pngName: `${safeFilename(run.name)}_수렴_평균`, note: '공이 늘어날수록 누적 평균·분산이 이론값(점선)에 가까워집니다(큰수의 법칙). 가로축은 로그 눈금입니다.' });
    const pos = run.positions;
    let boxMean = null;
    if (!pos || pos.length < 2) {
      b.body.insertAdjacentHTML('beforeend', '<p class="small muted">공별 도착 기록이 없어 수렴 그림을 그릴 수 없습니다.</p>');
    } else {
      const path = convergencePath(pos);
      const g = document.createElement('div');
      g.className = 'two-col';
      b.body.appendChild(g);
      const c1 = document.createElement('div'), c2 = document.createElement('div');
      g.append(c1, c2);
      const mvals = path.map((q) => q.mean), vvals = path.slice(1).map((q) => q.variance);
      const mr = Math.max(th.sd * 1.2, ...mvals.map((v) => Math.abs(v - th.mean))) * 1.05 || 1;
      boxMean = chartBox(c1, (c) => ({
        title: '누적 평균', width: 380, height: 280,
        x: { domain: [1, pos.length], log: true, label: ko.axisBalls, format: (v) => fmtInt(v) },
        y: { domain: [th.mean - mr, th.mean + mr], label: ko.axisMean },
        layers: [
          { type: 'hline', y: th.mean, color: c.theory },
          { type: 'line', points: path.map((q) => [q.n, q.mean]), color: c.blue, width: 1.8 },
        ],
        legend: [{ kind: 'line', color: c.blue, label: '누적 평균' }, { kind: 'dash', color: c.theory, label: `이론 np = ${fmt(th.mean, 3)}` }],
      }));
      const vmax = Math.max(th.variance * 2, ...vvals) * 1.05 || 1;
      const boxVar = chartBox(c2, (c) => ({
        title: '누적 분산', width: 380, height: 280,
        x: { domain: [1, pos.length], log: true, label: ko.axisBalls, format: (v) => fmtInt(v) },
        y: { domain: [0, vmax], label: ko.axisVar },
        layers: [
          { type: 'hline', y: th.variance, color: c.theory },
          { type: 'line', points: path.slice(1).map((q) => [q.n, q.variance]), color: c.green, width: 1.8 },
        ],
        legend: [{ kind: 'line', color: c.green, label: '누적 분산' }, { kind: 'dash', color: c.theory, label: `이론 np(1−p) = ${fmt(th.variance, 3)}` }],
      }));
      const pngVar = document.createElement('button');
      pngVar.className = 'btn btn-outline sm';
      pngVar.type = 'button';
      pngVar.textContent = 'PNG (분산)';
      pngVar.addEventListener('click', () => downloadPNG(boxVar, `${safeFilename(run.name)}_수렴_분산.png`));
      b.sec.querySelector('.btn-row').appendChild(pngVar);
      const last = path[path.length - 1];
      b.interpret(`공 ${fmtInt(last.n)}개에서 누적 평균 ${fmt(last.mean, 4)} (이론 ${fmt(th.mean, 4)}), 누적 분산 ${fmt(last.variance, 4)} (이론 ${fmt(th.variance, 4)}).`);
    }
  }

  // 6. 정규 Q-Q
  {
    const b = block(root, '정규 Q-Q 그림', { png: () => box, pngName: `${safeFilename(run.name)}_QQ`, note: '가로축은 이론 정규 분위수, 세로축은 표준화한 도착 위치 (k − 평균)/표준편차. 도착 위치가 정수라 칸마다 가로 선분(같은 값의 순위 범위)으로 표시됩니다.' });
    const qq = qqPoints(counts, d.mean, d.sd);
    const lim = Math.max(3, ...qq.map((q) => Math.max(Math.abs(q.theoLo), Math.abs(q.theoHi), Math.abs(q.obs)))) * 1.05;
    const box = chartBox(b.body, (c) => ({
      title: '정규 Q-Q 그림', height: 340, width: 560,
      x: { domain: [-lim, lim], label: ko.axisTheoQ },
      y: { domain: [-lim, lim], label: ko.axisObsQ },
      layers: [
        { type: 'line', points: [[-lim, -lim], [lim, lim]], color: c.theory, dash: '6 4', width: 1.5 },
        { type: 'segments', segs: qq.map((q) => [q.theoLo, q.obs, q.theoHi, q.obs]), color: c.blue, width: 2, opacity: 0.5 },
        { type: 'points', color: c.blue, points: qq.map((q) => [q.theo, q.obs, 3.5, `칸 ${q.k}: ${q.n}개`]) },
      ],
      legend: [{ kind: 'dot', color: c.blue, label: '칸별 가운데 순위' }, { kind: 'line', color: c.blue, label: '같은 값의 순위 범위' }, { kind: 'dash', color: c.theory, label: 'y = x (정규분포)' }],
    }));
    b.interpret(`점들이 대각선 y = x에 가까울수록 정규분포에 가깝습니다. 왜도 ${fmt(d.skewness, 3)}, 초과첨도 ${fmt(d.exKurtosis, 3)}.`);
  }

  // 7. 정규 근사 오차
  {
    const diff = th.pmf.map((q, k) => q - th.normal[k]);
    const tv = totalVariation(th.pmf, th.normal);
    const b = block(root, '정규 근사 오차', {
      png: () => box, pngName: `${safeFilename(run.name)}_정규근사오차`,
      csv: () => [['칸 k', '이항 확률', '정규 근사(연속성 보정)', '차이'], ...th.pmf.map((q, k) => [k, q.toFixed(8), th.normal[k].toFixed(8), diff[k].toFixed(8)])],
      csvName: `${safeFilename(run.name)}_정규근사오차`,
      note: '칸 k의 정규 근사 확률 = Φ((k+0.5−np)/σ) − Φ((k−0.5−np)/σ). 막대는 이항 확률 − 정규 근사 확률입니다.',
    });
    const m = Math.max(1e-6, ...diff.map(Math.abs)) * 1.15;
    const box = chartBox(b.body, (c) => ({
      title: '정규 근사 오차', height: 260,
      x: { domain: [-0.6, n + 0.6], integer: true, label: ko.axisBin },
      y: { domain: [-m, m], label: ko.axisDiff },
      layers: [{ type: 'bars', data: diff.map((y, x) => ({ x, y, color: y >= 0 ? c.blue : c.red, title: `칸 ${x}: ${y.toExponential(2)}` })) }],
    }));
    b.interpret(`총변동거리 TV = ½Σ|이항 − 정규| = ${fmt(tv, 5)}. ${tv < 0.01 ? '정규 근사가 매우 정확합니다.' : tv < 0.05 ? '정규 근사가 대체로 잘 맞습니다.' : 'n이 작거나 p가 한쪽으로 치우쳐 정규 근사 오차가 큽니다.'}`);
  }

  // 8. 여러 실행 비교
  {
    const b = block(root, '여러 실행 비교', { png: () => b.body.querySelector('.chart'), pngName: '여러실행비교', note: '목록에서 1단계 실행을 두 개 이상 체크하면 상대도수 분포를 한 그림에 겹쳐 봅니다 (선택한 실행 중 최대 8개).' });
    b.body.id = 'compare-body';
    renderCompare._block = b;
    renderCompare();
  }
}

function curve(mean, sd, N, x0, x1) {
  if (!(sd > 0)) return [];
  const pts = [];
  for (let i = 0; i <= 200; i++) {
    const x = x0 + ((x1 - x0) * i) / 200;
    pts.push([x, (N * normalPdf((x - mean) / sd)) / sd]);
  }
  return pts;
}

async function renderCompare() {
  const b = renderCompare._block;
  if (!b || !document.body.contains(b.sec)) return;
  const old = b.body.querySelector('.chart');
  if (old) { unregister(old); old.remove(); }
  b.body.querySelector('.cmp-msg')?.remove();
  const sel = runs.filter((r) => r.type === 'single' && checked.has(r.id)).slice(0, 8);
  if (sel.length < 2) {
    b.body.insertAdjacentHTML('beforeend', '<p class="small muted cmp-msg">비교할 실행을 두 개 이상 체크해 주세요.</p>');
    b.sec.querySelector('.interpret')?.remove();
    return;
  }
  const full = await Promise.all(sel.map((r) => getRun(r.id)));
  const maxN = Math.max(...full.map((r) => r.settings.n));
  let ymax = 0;
  const series = full.map((r) => {
    const tot = r.counts.reduce((a, c) => a + c, 0);
    const rel = r.counts.map((c, k) => [k, c / tot]);
    ymax = Math.max(ymax, ...rel.map((q) => q[1]));
    return { r, rel };
  });
  chartBox(b.body, (c) => ({
    title: '여러 실행 비교', height: 330,
    x: { domain: [-0.6, maxN + 0.6], integer: true, label: ko.axisBin },
    y: { domain: [0, ymax * 1.12], label: ko.axisRel },
    layers: series.map((s, i) => ({ type: 'step', points: s.rel, color: OKABE_ITO[i % 8], width: 2, dash: i % 2 ? '5 3' : undefined })),
    legend: series.map((s, i) => ({ kind: i % 2 ? 'dash' : 'line', color: OKABE_ITO[i % 8], label: `n=${s.r.settings.n}, p=${s.r.settings.p} (N=${fmtInt(s.r.N)})` })),
  }));
  const desc = series.map((s) => { const d = describeCounts(s.r.counts); return `n=${s.r.settings.n}, p=${s.r.settings.p}: 평균 ${fmt(d.mean, 2)}, 표준편차 ${fmt(d.sd, 2)}`; });
  b.interpret(desc.join(' · '));
}

/* ======================= 2단계 ======================= */

function renderTwo(root, run) {
  const { n1, n2, p1, p2 } = run.settings;
  const nX = n1 + 1, nY = n1 + n2 + 1;
  const th = theoryTwo(n1, p1, n2, p2);
  const cross = run.cross;
  const cs = crossStats(cross, nX, nY);
  const finalCounts = run.finalCounts;
  const N = cs.N;

  // 1. 분산 분해
  {
    const cov12 = cs.cov - cs.varX;
    const rows = [
      ['E[X₁] 중간 위치 평균', cs.meanX, th.mean1],
      ['E[X₂] 아래 보드 이동 평균', cs.mean2, th.mean2],
      ['E[Y] 최종 위치 평균', cs.meanY, th.meanY],
      ['Var(X₁)', cs.varX, th.var1],
      ['Var(X₂)', cs.var2, th.var2],
      ['Var(X₁) + Var(X₂)', cs.varX + cs.var2, th.var1 + th.var2],
      ['Var(Y)', cs.varY, th.varY],
      ['2·Cov(X₁, X₂)', 2 * cov12, 0],
    ];
    const b = block(root, '분산 분해', {
      csv: () => [['항목', '관측', '이론'], ...rows.map((r) => [r[0], r[1].toFixed(6), r[2].toFixed(6)])],
      csvName: `${safeFilename(run.name)}_분산분해`,
      note: '\\(\\mathrm{Var}(Y)=\\mathrm{Var}(X_1)+\\mathrm{Var}(X_2)+2\\,\\mathrm{Cov}(X_1,X_2)\\). 두 보드가 독립이면 공분산은 0이므로 분산이 더해집니다.',
    });
    table(b.body, ['항목', '관측', '이론'], rows.map((r) => [r[0], fmt(r[1], 4), fmt(r[2], 4)]));
    const rel = th.varY > 0 ? Math.abs(cs.varX + cs.var2 - cs.varY) / th.varY : 0;
    b.interpret(`관측 Var(X₁) + Var(X₂) = ${fmt(cs.varX + cs.var2, 3)}, 관측 Var(Y) = ${fmt(cs.varY, 3)}, 이론 ${fmt(th.varY, 3)}. 차이 ${fmt(rel * 100, 2)}%는 표본 공분산 ${fmt(cov12, 4)} 때문입니다.`);
  }

  // 2. 상관·회귀
  {
    const rows = [
      ['상관계수 r(X₁, Y)', cs.r, th.rho],
      ['Y를 X₁로 회귀: 기울기', cs.yOnX.slope, th.slopeYonX],
      ['Y를 X₁로 회귀: 절편', cs.yOnX.intercept, th.interceptYonX],
      ['X₁을 Y로 회귀: 기울기', cs.xOnY.slope, th.slopeXonY],
      ['X₁을 Y로 회귀: 절편', cs.xOnY.intercept, th.interceptXonY],
      ['결정계수 r²', cs.r * cs.r, th.rho * th.rho],
    ];
    const b = block(root, '상관계수와 회귀', {
      csv: () => [['항목', '관측', '이론'], ...rows.map((r) => [r[0], r[1].toFixed(6), r[2].toFixed(6)])],
      csvName: `${safeFilename(run.name)}_회귀`,
      note: '이론: \\(\\rho=\\sigma_1/\\sqrt{\\sigma_1^2+\\sigma_2^2}\\), \\(E[Y\\mid X_1]=X_1+n_2p_2\\) (기울기 1), \\(E[X_1\\mid Y]\\approx E[X_1]+\\frac{\\sigma_1^2}{\\sigma^2}(Y-E[Y])\\).',
    });
    table(b.body, ['항목', '관측', '이론'], rows.map((r) => [r[0], fmt(r[1], 4), fmt(r[2], 4)]));
    // Fisher z 95% 신뢰구간
    const z = Math.atanh(cs.r), se = 1 / Math.sqrt(Math.max(1, N - 3));
    const lo = Math.tanh(z - 1.96 * se), hi = Math.tanh(z + 1.96 * se);
    const inside = th.rho >= lo && th.rho <= hi;
    b.interpret(`관측 r = ${fmt(cs.r, 3)} (95% 신뢰구간 ${fmt(lo, 3)}–${fmt(hi, 3)}), 이론 ρ = ${fmt(th.rho, 3)}${inside ? ' — 구간 안에 있습니다.' : ' — 구간 밖입니다.'} X₁을 Y로 회귀한 기울기 ${fmt(cs.xOnY.slope, 3)}가 1보다 작아, 최종 위치로 중간 위치를 예측하면 중앙 쪽으로 당겨집니다(평균으로의 회귀).`);
  }

  // 3. 결합 분포 열지도 + 회귀선
  {
    const b = block(root, '결합 분포와 회귀선', {
      png: () => box, pngName: `${safeFilename(run.name)}_결합분포`,
      note: '가로축 = 중간 칸 X₁, 세로축 = 최종 칸 Y. 칸의 색이 진할수록 공이 많습니다. 점은 Galton처럼 최종 칸별 X₁의 조건부 평균입니다.',
    });
    const cells = [];
    let max = 1;
    for (let x = 0; x < nX; x++) for (let y = 0; y < nY; y++) {
      const v = cross[x * nY + y];
      if (v) { cells.push({ x, y, v, title: `X₁=${x}, Y=${y}: ${v}` }); max = Math.max(max, v); }
    }
    const rowMeans = conditionalMidMeans(cross, nX, nY).filter((q) => q.n >= 5);
    const colMeans = conditionalFinalMeans(cross, nX, nY).filter((q) => q.n >= 5);
    const lineX = (f) => [[-0.5, f(-0.5)], [n1 + 0.5, f(n1 + 0.5)]];
    const lineY = (g) => [[g(-0.5), -0.5], [g(nY - 0.5), nY - 0.5]];
    const box = chartBox(b.body, (c) => ({
      title: '결합 분포 열지도', height: 460, width: 640, margin: { right: 16 },
      x: { domain: [-0.5, n1 + 0.5], integer: true, label: ko.axisMid },
      y: { domain: [-0.5, nY - 0.5], label: ko.axisFinal },
      layers: [
        { type: 'heat', cells, max, colorFn: (t) => viridis(1 - t * 0.92) , gamma: 0.55 },
        { type: 'line', points: lineX((x) => cs.yOnX.intercept + cs.yOnX.slope * x), color: c.red, width: 2.4 },
        { type: 'line', points: lineX((x) => th.interceptYonX + th.slopeYonX * x), color: c.red, width: 1.6, dash: '6 4' },
        { type: 'line', points: lineY((y) => cs.xOnY.intercept + cs.xOnY.slope * y), color: c.text, width: 2.4 },
        { type: 'line', points: lineY((y) => th.interceptXonY + th.slopeXonY * y), color: c.text, width: 1.6, dash: '6 4' },
        { type: 'points', color: c.bg, stroke: c.text, points: rowMeans.map((q) => [q.mean, q.y, 3.4, `Y=${q.y}: X₁ 평균 ${fmt(q.mean, 2)}`]) },
        { type: 'points', color: c.red, points: colMeans.map((q) => [q.x, q.mean, 3.4, `X₁=${q.x}: Y 평균 ${fmt(q.mean, 2)}`]) },
      ],
      legend: [
        { kind: 'line', color: c.red, label: `Y를 X₁로 회귀 (관측 기울기 ${fmt(cs.yOnX.slope, 3)})` },
        { kind: 'line', color: c.text, label: `X₁을 Y로 회귀 (관측 기울기 ${fmt(cs.xOnY.slope, 3)})` },
        { kind: 'dash', color: c.text2, label: '이론 회귀선' },
        { kind: 'dot', color: c.red, label: 'X₁별 Y 평균' },
        { kind: 'point', color: c.text, label: 'Y별 X₁ 평균' },
      ],
    }));
    b.interpret(`두 회귀선이 서로 다릅니다. X₁이 1 늘면 Y는 평균 ${fmt(cs.yOnX.slope, 2)}만큼 늘지만, Y가 1 늘면 X₁은 평균 ${fmt(cs.xOnY.slope, 2)}만큼만 늡니다.`);
  }

  // 4. 교차표
  {
    const b = block(root, '교차표 (중간 칸 × 최종 칸)', {
      csv: () => [['X1 \\ Y', ...Array.from({ length: nY }, (_, y) => y), '합계'], ...Array.from({ length: nX }, (_, x) => [x, ...Array.from({ length: nY }, (_, y) => cross[x * nY + y]), run.midCounts?.[x] ?? rowSum(x)]), ['합계', ...finalCounts, N]],
      csvName: `${safeFilename(run.name)}_교차표`,
    });
    const rowSum = (x) => { let s = 0; for (let y = 0; y < nY; y++) s += cross[x * nY + y]; return s; };
    const head = ['X₁ \\ Y', ...Array.from({ length: nY }, (_, y) => String(y)), '합계'];
    const rows = Array.from({ length: nX }, (_, x) => [x, ...Array.from({ length: nY }, (_, y) => cross[x * nY + y] || ''), { v: fmtInt(rowSum(x)), cls: 'hi' }]);
    rows.push([{ v: '합계', cls: 'hi' }, ...finalCounts.map((v) => ({ v: fmtInt(v), cls: 'hi' })), { v: fmtInt(N), cls: 'hi' }]);
    table(b.body, head, rows, { scroll: true });
  }

  // 5. 혼합 분해 그림
  {
    const b = block(root, '혼합 분해 그림', { png: () => box, pngName: `${safeFilename(run.name)}_혼합분해`, note: '최종 분포를 중간 칸별 성분으로 나눠 누적했습니다. 각 색은 한 중간 칸에서 출발한 작은 종 모양입니다.' });
    const pal = binPalette(nX);
    const ymax = Math.max(...finalCounts, ...th.pmfY.map((q) => q * N)) * 1.12;
    const box = chartBox(b.body, (c) => ({
      title: '혼합 분해', height: 340,
      x: { domain: [-0.6, nY - 0.4], integer: true, label: ko.axisFinal },
      y: { domain: [0, ymax], label: ko.axisCount },
      layers: [
        { type: 'stack', data: Array.from({ length: nY }, (_, y) => ({ x: y, parts: Array.from({ length: nX }, (_, x) => ({ y: cross[x * nY + y], color: pal[x] })) })) },
        { type: 'points', hollow: true, color: c.theory, points: th.pmfY.map((q, y) => [y, q * N, 4]) },
        { type: 'line', points: curve(th.meanY, th.sdY, N, -0.6, nY - 0.4), color: c.normal, dash: '6 4', width: 1.6 },
      ],
      legend: [
        ...pal.slice(0, Math.min(nX, 9)).map((col, x) => ({ kind: 'bar', color: col, label: `X₁=${x}` })),
        ...(nX > 9 ? [{ kind: 'bar', color: pal[nX - 1], label: `… X₁=${nX - 1}` }] : []),
        { kind: 'point', color: c.theory, label: th.samePBinomial ? `Bin(${n1 + n2}, ${p1}) × N` : 'Y의 이론 분포 × N' },
        { kind: 'dash', color: c.normal, label: '정규 근사' },
      ],
    }));
  }

  // 6. 최종 분포 적합도
  {
    const chi = chiSquareTest(finalCounts, th.pmfY);
    const b = block(root, '최종 분포 적합도 검정', {
      csv: () => [['칸 범위', '관측', '기대', '(O−E)²/E'], ...chi.groups.map((g) => [g.from === g.to ? g.from : `${g.from}–${g.to}`, g.o, g.e.toFixed(3), g.contrib.toFixed(4)])],
      csvName: `${safeFilename(run.name)}_최종카이제곱`,
      note: th.samePBinomial
        ? `귀무가설: 최종 위치 Y가 같은 총 행 수의 1단계 이항분포 \\(\\mathrm{Bin}(${n1 + n2},\\,${p1})\\)를 따른다.`
        : '귀무가설: 최종 위치 Y가 \\(\\mathrm{Bin}(n_1,p_1)\\)과 \\(\\mathrm{Bin}(n_2,p_2)\\)의 합성곱 분포를 따른다.',
    });
    const sr = document.createElement('div');
    sr.className = 'stats-row';
    sr.innerHTML = `
      <div class="stat-box"><div class="stat-label">통계량 χ²</div><div class="stat-num">${fmt(chi.stat, 3)}</div></div>
      <div class="stat-box"><div class="stat-label">자유도</div><div class="stat-num">${chi.df}</div></div>
      <div class="stat-box"><div class="stat-label">p값</div><div class="stat-num">${fmtP(chi.p)}</div></div>`;
    b.body.appendChild(sr);
    b.interpret(chi.df > 0 ? ko.interpretChi(chi.p, chi.df) : ko.interpretChiNA);
  }

  // 7. 조건부 분포
  {
    const b = block(root, '조건부 분포 (역추적)', { png: () => b.body.querySelector('.chart'), pngName: `${safeFilename(run.name)}_조건부분포`, note: '최종 칸을 고르면 그 칸에 도착한 공들의 중간 위치 분포와 조건부 평균을 보여 줍니다.' });
    const ctl = document.createElement('div');
    ctl.className = 'field';
    ctl.style.maxWidth = '260px';
    const def = finalCounts.reduce((best, c, y) => (y > th.meanY && c >= 10 ? y : best), Math.round(th.meanY));
    ctl.innerHTML = `<label for="cond-y">최종 칸 Y</label><select id="cond-y">${finalCounts.map((c, y) => `<option value="${y}"${y === def ? ' selected' : ''}>Y = ${y} (공 ${fmtInt(c)}개)</option>`).join('')}</select>`;
    b.body.appendChild(ctl);
    const holder = document.createElement('div');
    b.body.appendChild(holder);
    const draw = (y) => {
      holder.querySelectorAll('.chart').forEach((el) => { unregister(el); el.remove(); });
      const cm = conditionalMid(cross, nX, nY, y);
      const naive = y - th.mean2;
      const pred = th.interceptXonY + th.slopeXonY * y;
      const ymax = Math.max(1, ...cm.dist) * 1.15;
      chartBox(holder, (c) => ({
        title: `Y=${y}의 중간 칸 조건부 분포`, height: 280,
        x: { domain: [-0.6, n1 + 0.6], integer: true, label: ko.axisMid },
        y: { domain: [0, ymax], label: ko.axisCount },
        layers: [
          { type: 'bars', data: cm.dist.map((v, x) => ({ x, y: v, title: `X₁=${x}: ${v}` })), color: c.barAlpha },
          { type: 'segments', segs: [[cm.mean, 0, cm.mean, ymax]], color: c.text, width: 2.4 },
          { type: 'line', points: [[naive, 0], [naive, ymax]], color: c.red, dash: '6 4', width: 2 },
          { type: 'line', points: [[th.mean1, 0], [th.mean1, ymax]], color: c.text3, dash: '2 3', width: 1.5 },
        ],
        legend: [
          { kind: 'line', color: c.text, label: `조건부 평균 ${fmt(cm.mean, 3)}` },
          { kind: 'dash', color: c.red, label: `단순 역산 Y − n₂p₂ = ${fmt(naive, 3)}` },
          { kind: 'dash', color: c.text3, label: `E[X₁] = ${fmt(th.mean1, 3)}` },
        ],
      }));
      b.interpret(cm.n
        ? `Y = ${y}에 도착한 공 ${fmtInt(cm.n)}개의 중간 위치 평균은 ${fmt(cm.mean, 3)}로, 단순 역산값 ${fmt(naive, 3)}보다 전체 평균 ${fmt(th.mean1, 2)} 쪽에 있습니다 (이론 회귀 예측 ${fmt(pred, 3)}).`
        : `Y = ${y}에 도착한 공이 없습니다.`);
    };
    ctl.querySelector('select').addEventListener('change', (e) => draw(Number(e.target.value)));
    draw(def);
  }
}

/* ---------------- 시작 ---------------- */

(async () => {
  await refreshList();
  const hp = new URLSearchParams(location.hash.slice(1));
  const id = hp.get('run');
  if (id) {
    const r = runs.find((q) => q.id === id);
    if (r) {
      activeId[r.type] = r.id;
      checked.add(r.id);
      setTab(r.type);
      return;
    }
  }
  // 1단계 실행이 없고 2단계만 있으면 2단계 탭으로
  if (!runs.some((r) => r.type === 'single') && runs.some((r) => r.type === 'two')) setTab('two');
})();
