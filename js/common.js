// 공통: 메뉴·바닥글, 테마 색, 수식 렌더링, 슬라이더-숫자 칸 연동, 워커 호출

import { ko } from './i18n/ko.js';
import { simulateSingle, simulateTwo } from './model.js';

const LOGO = `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="12" cy="4" r="1.6"/><circle cx="8" cy="9" r="1.6"/><circle cx="16" cy="9" r="1.6"/><circle cx="12" cy="14" r="1.6"/><circle cx="4" cy="14" r="1.6"/><circle cx="20" cy="14" r="1.6"/></g><path d="M3 21h18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

export function initPage() {
  const page = location.pathname.split('/').pop() || 'index.html';
  const header = document.getElementById('site-nav');
  if (header) {
    header.className = 'site-nav';
    header.innerHTML = `
      <a class="skip-link" href="#main">${ko.skip}</a>
      <div class="nav-inner">
        <a class="brand" href="index.html" style="color:var(--c-text-primary)"><span style="color:var(--c-blue);display:flex">${LOGO}</span>${ko.siteName}</a>
        <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-links" aria-label="${ko.menuOpen}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
        <ul class="nav-links" id="nav-links">
          ${ko.nav
            .map((n) => `<li><a href="${n.href}"${n.href === page ? ' aria-current="page"' : ''}>${n.label}</a></li>`)
            .join('')}
        </ul>
      </div>`;
    const btn = header.querySelector('.nav-toggle');
    const links = header.querySelector('.nav-links');
    btn.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? ko.menuClose : ko.menuOpen);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && links.classList.contains('open')) {
        links.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        btn.focus();
      }
    });
  }
  const footer = document.getElementById('site-footer');
  if (footer) {
    footer.className = 'site-footer';
    footer.innerHTML = `<div class="container wide"><span>${ko.footer}</span><span>참고: Galton, F. (1889). <i>Natural Inheritance</i>.</span></div>`;
  }
  renderMath(document.body);
  initReveal();
}

/* ---------------- 수식 (KaTeX, 없으면 원문 유지) ---------------- */

export function renderMath(el) {
  const run = () => {
    if (typeof window.renderMathInElement !== 'function') return false;
    window.renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
    });
    return true;
  };
  if (!run()) window.addEventListener('load', run, { once: true });
}

/* ---------------- 스크롤 진입 효과 ---------------- */

function initReveal() {
  const els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || prefersReducedMotion()) {
    els.forEach((e) => e.classList.add('vis'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const delay = +e.target.dataset.delay || 0;
        setTimeout(() => e.target.classList.add('vis'), delay);
        io.unobserve(e.target);
      });
    },
    { threshold: 0.12 }
  );
  els.forEach((el, i) => {
    if (!el.dataset.delay) el.dataset.delay = String((i % 5) * 90);
    io.observe(el);
  });
}

/* ---------------- 테마 ---------------- */

export function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    bg: v('--c-bg'),
    bgAlt: v('--c-bg-alt'),
    text: v('--c-text-primary'),
    text2: v('--c-text-secondary'),
    text3: v('--c-text-tertiary'),
    border: v('--c-border'),
    borderLt: v('--c-border-lt'),
    blue: v('--c-blue'),
    green: v('--c-green'),
    red: v('--c-red'),
    pin: v('--c-pin'),
    ball: v('--c-ball'),
    bar: v('--c-bar'),
    barAlpha: v('--c-bar-alpha'),
    theory: v('--c-theory'),
    normal: v('--c-normal'),
    trace: v('--c-trace'),
    font: v('--font'),
    dark: window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  };
}

export function onThemeChange(cb) {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => cb(themeColors()));
}

/* ---------------- 입력 연동 ---------------- */

/**
 * 슬라이더와 숫자 입력 칸을 연동한다. 숫자 칸 값이 슬라이더 범위를 넘으면
 * (예: 공 개수) 숫자 칸 범위(min/max)로 제한하고 슬라이더는 끝에 둔다.
 */
export function bindRange(range, number, { onInput, onChange, toSlider = (v) => v, fromSlider = (v) => v } = {}) {
  const min = Number(number.min), max = Number(number.max);
  const step = Number(number.step) || 1;
  const clamp = (v) => {
    if (!Number.isFinite(v)) v = Number(number.defaultValue) || min;
    v = Math.min(max, Math.max(min, v));
    v = Math.round(v / step) * step;
    return Number(v.toFixed(6));
  };
  const setFromNumber = (fire) => {
    const v = clamp(Number(number.value));
    number.value = String(v);
    range.value = String(toSlider(v));
    if (fire) (onChange || onInput)?.(v);
    return v;
  };
  range.addEventListener('input', () => {
    const v = clamp(fromSlider(Number(range.value)));
    number.value = String(v);
    onInput?.(v);
  });
  range.addEventListener('change', () => onChange?.(clamp(Number(number.value))));
  number.addEventListener('change', () => setFromNumber(true));
  number.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); setFromNumber(true); }
  });
  return {
    get value() { return clamp(Number(number.value)); },
    set(v) { number.value = String(clamp(v)); range.value = String(toSlider(clamp(v))); },
  };
}

/** 공 개수처럼 넓은 범위는 로그 눈금 슬라이더(0–1000)로 */
export function logSlider(min, max) {
  const lmin = Math.log(min), lmax = Math.log(max);
  return {
    toSlider: (v) => Math.round(((Math.log(Math.max(min, v)) - lmin) / (lmax - lmin)) * 1000),
    fromSlider: (s) => {
      const v = Math.exp(lmin + (s / 1000) * (lmax - lmin));
      // 보기 좋은 값으로 반올림
      const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1));
      return Math.round(v / mag) * mag;
    },
  };
}

/* ---------------- 알림 ---------------- */

let toastTimer = null;
export function toast(message, ms = 2600) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = message;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------------- 워커 즉시 계산 ---------------- */

let worker = null;
let workerFailed = false;
let msgId = 0;
const pending = new Map();

function getWorker() {
  if (workerFailed) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, result, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      error ? p.reject(new Error(error)) : p.resolve(result);
    };
    worker.onerror = () => {
      workerFailed = true;
      for (const [id, p] of pending) { pending.delete(id); p.fallback(); }
    };
  } catch {
    workerFailed = true;
    worker = null;
  }
  return worker;
}

function computeLocal(type, params) {
  const t0 = performance.now();
  const r = type === 'single' ? simulateSingle(params) : simulateTwo(params);
  return { ...r, ms: performance.now() - t0 };
}

/** 워커로 즉시 계산. 워커를 쓸 수 없으면 메인 스레드에서 계산한다. */
export function compute(type, params) {
  const w = getWorker();
  if (!w) return Promise.resolve(computeLocal(type, params));
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject, fallback: () => resolve(computeLocal(type, params)) });
    w.postMessage({ id, type, params });
  });
}

/* ---------------- 기타 ---------------- */

export function $(sel, root = document) {
  return root.querySelector(sel);
}
export function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
