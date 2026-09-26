// 저장: 실행 결과는 IndexedDB, 화면 설정은 localStorage
// JSON·CSV 내보내기와 JSON 가져오기

import { SITE_VERSION, binomPmf } from './model.js';
import { RNG_NAME } from './rng.js';

const DB_NAME = 'quincunx-sim';
const DB_VERSION = 1;
const STORE = 'runs';
const EXPORT_FORMAT = 'quincunx-runs';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('이 브라우저는 IndexedDB를 지원하지 않습니다.')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const os = t.objectStore(STORE);
        let result;
        Promise.resolve(fn(os, (v) => (result = v))).catch(reject);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('저장이 취소되었습니다. 저장 공간이 부족할 수 있습니다.'));
      })
  );
}

function newId() {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `run-${Date.now().toString(36)}-${rnd}`;
}

/** 실행 기록 공통 필드를 채워 새 기록을 만든다 */
export function makeRun(type, fields) {
  return {
    id: newId(),
    name: fields.name || defaultName(type, fields.settings),
    createdAt: new Date().toISOString(),
    type,
    version: SITE_VERSION,
    rng: RNG_NAME,
    ...fields,
  };
}

export function defaultName(type, s) {
  if (type === 'single') return `1단계 n=${s.n}, p=${s.p}, N=${s.N}`;
  return `2단계 n₁=${s.n1}, n₂=${s.n2}, p=${s.p1}/${s.p2}, N=${s.N}`;
}

export function saveRun(run) {
  return tx('readwrite', (os) => { os.put(run); }).then(() => run);
}

export function getRun(id) {
  return tx('readonly', (os, done) => {
    const r = os.get(id);
    r.onsuccess = () => done(r.result || null);
  });
}

export function listRuns() {
  return tx('readonly', (os, done) => {
    const r = os.getAll();
    r.onsuccess = () => done((r.result || []).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  });
}

export function deleteRun(id) {
  return tx('readwrite', (os) => { os.delete(id); });
}

export async function renameRun(id, name) {
  const run = await getRun(id);
  if (!run) return null;
  run.name = name;
  await saveRun(run);
  return run;
}

/* ---------------- 설정 (localStorage) ---------------- */

export function loadSettings(key, defaults) {
  try {
    const raw = localStorage.getItem(`quincunx:${key}`);
    if (!raw) return { ...defaults };
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(key, value) {
  try {
    localStorage.setItem(`quincunx:${key}`, JSON.stringify(value));
  } catch {
    /* 저장 불가 환경(사생활 보호 모드 등)에서는 무시 */
  }
}

/* ---------------- 내보내기·가져오기 ---------------- */

const TYPED_FIELDS = ['positions', 'mids', 'finals'];

function toPlain(run) {
  const out = { ...run };
  for (const f of TYPED_FIELDS) if (out[f]) out[f] = Array.from(out[f]);
  return out;
}

function fromPlain(run) {
  const out = { ...run };
  for (const f of TYPED_FIELDS) if (Array.isArray(out[f])) out[f] = Uint8Array.from(out[f]);
  return out;
}

export function runsToJSON(runs) {
  return JSON.stringify(
    { format: EXPORT_FORMAT, version: SITE_VERSION, exportedAt: new Date().toISOString(), runs: runs.map(toPlain) },
    null,
    0
  );
}

function validateRun(r) {
  if (!r || typeof r !== 'object') return false;
  if (r.type === 'single') return Array.isArray(r.counts) && r.settings && Number.isInteger(r.settings.n);
  if (r.type === 'two') return Array.isArray(r.cross) && r.settings && Number.isInteger(r.settings.n1) && Number.isInteger(r.settings.n2);
  return false;
}

/** JSON 문자열을 읽어 실행 기록들을 저장한다. 저장된 개수를 돌려준다. */
export async function importJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON 형식이 올바르지 않습니다.');
  }
  const runs = Array.isArray(data) ? data : data?.runs;
  if (!Array.isArray(runs)) throw new Error('퀸컹스 실행 결과 파일이 아닙니다.');
  const existing = new Set((await listRuns()).map((r) => r.id));
  let saved = 0;
  for (const raw of runs) {
    if (!validateRun(raw)) continue;
    const run = fromPlain(raw);
    if (!run.id || existing.has(run.id)) run.id = newId();
    run.createdAt = run.createdAt || new Date().toISOString();
    run.name = run.name || defaultName(run.type, run.settings);
    await saveRun(run);
    saved++;
  }
  if (!saved) throw new Error('가져올 수 있는 실행 결과가 없습니다.');
  return saved;
}

/** CSV 문자열 (엑셀 한글 호환을 위해 BOM은 다운로드 시 추가) */
export function toCSV(rows) {
  return rows
    .map((row) =>
      row
        .map((v) => {
          const s = v === null || v === undefined ? '' : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(',')
    )
    .join('\r\n');
}

export function runToCSV(run) {
  const s = run.settings;
  if (run.type === 'single') {
    const pmf = binomPmf(s.n, s.p);
    const N = run.counts.reduce((a, b) => a + b, 0);
    const rows = [['칸 k', '관측 도수', '상대도수', '이항 확률', '기대 도수']];
    run.counts.forEach((c, k) => rows.push([k, c, (c / N).toFixed(6), pmf[k].toFixed(8), (pmf[k] * N).toFixed(3)]));
    return toCSV(rows);
  }
  const nY = s.n1 + s.n2 + 1;
  const rows = [['중간 칸 X1', '최종 칸 Y', '도수']];
  for (let x = 0; x <= s.n1; x++) for (let y = 0; y < nY; y++) {
    const c = run.cross[x * nY + y];
    if (c) rows.push([x, y, c]);
  }
  return toCSV(rows);
}

/* ---------------- 파일 내려받기·읽기 ---------------- */

export function downloadText(filename, text, mime = 'text/plain') {
  const bom = mime.startsWith('text/csv') ? '﻿' : '';
  const blob = new Blob([bom + text], { type: `${mime};charset=utf-8` });
  downloadBlob(filename, blob);
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file, 'utf-8');
  });
}

export function safeFilename(name) {
  return String(name).replace(/[\\/:*?"<>|\s]+/g, '_').replace(/[₁₂]/g, (c) => (c === '₁' ? '1' : '2')).slice(0, 80);
}
