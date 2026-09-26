// 1단계·2단계 퀸컹스 확률 모델과 이론값 계산
// 공의 움직임 = 행마다 독립인 베르누이 시행 (오른쪽 = 1, 왼쪽 = 0)

import { createRng } from './rng.js';

export const SITE_VERSION = '1.0.0';

/* ---------------- 조합·분포 ---------------- */

const LOG_FACT = [0];
for (let i = 1; i <= 200; i++) LOG_FACT[i] = LOG_FACT[i - 1] + Math.log(i);

/** 이항계수 C(n, k) — 경로 수 */
export function choose(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/** Bin(n, p)의 확률질량함수 배열 (길이 n+1) */
export function binomPmf(n, p) {
  const out = new Array(n + 1).fill(0);
  if (p <= 0) { out[0] = 1; return out; }
  if (p >= 1) { out[n] = 1; return out; }
  const lp = Math.log(p), lq = Math.log(1 - p);
  for (let k = 0; k <= n; k++) {
    out[k] = Math.exp(LOG_FACT[n] - LOG_FACT[k] - LOG_FACT[n - k] + k * lp + (n - k) * lq);
  }
  return out;
}

/** 두 확률질량함수의 합성곱 (독립 합의 분포) */
export function convolve(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  }
  return out;
}

/** 표준정규 누적분포 Φ(z) — erfc 근사 (상대오차 < 1.2e-7) */
export function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * x);
  const erfc =
    t *
    Math.exp(
      -x * x - 1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
        t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    );
  return z >= 0 ? 1 - erfc / 2 : erfc / 2;
}

/** 표준정규 밀도 φ(z) */
export function normalPdf(z) {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/** 표준정규 분위수 Φ⁻¹(q) — Acklam 근사 */
export function normalQuantile(q) {
  if (q <= 0) return -Infinity;
  if (q >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425, hi = 1 - lo;
  let x;
  if (q < lo) {
    const r = Math.sqrt(-2 * Math.log(q));
    x = (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
  } else if (q <= hi) {
    const r = q - 0.5, s = r * r;
    x = ((((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r) / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
  } else {
    const r = Math.sqrt(-2 * Math.log(1 - q));
    x = -(((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
  }
  return x;
}

/**
 * 연속성 보정 정규 근사: 칸 k의 확률 = Φ((k+0.5−μ)/σ) − Φ((k−0.5−μ)/σ)
 * @returns {number[]} 길이 bins
 */
export function normalBinProbs(bins, mean, sd) {
  const out = new Array(bins).fill(0);
  if (!(sd > 0)) {
    const k = Math.round(mean);
    if (k >= 0 && k < bins) out[k] = 1;
    return out;
  }
  for (let k = 0; k < bins; k++) {
    out[k] = normalCdf((k + 0.5 - mean) / sd) - normalCdf((k - 0.5 - mean) / sd);
  }
  return out;
}

/* ---------------- 이론값 ---------------- */

export function theorySingle(n, p) {
  const mean = n * p;
  const variance = n * p * (1 - p);
  const sd = Math.sqrt(variance);
  return {
    mean, variance, sd,
    skewness: sd > 0 ? (1 - 2 * p) / sd : 0,
    exKurtosis: variance > 0 ? (1 - 6 * p * (1 - p)) / variance : 0,
    pmf: binomPmf(n, p),
    normal: normalBinProbs(n + 1, mean, sd),
    mode: Math.min(n, Math.floor((n + 1) * p)),
    median: Math.round(mean),
  };
}

export function theoryTwo(n1, p1, n2, p2) {
  const mean1 = n1 * p1, var1 = n1 * p1 * (1 - p1);
  const mean2 = n2 * p2, var2 = n2 * p2 * (1 - p2);
  const meanY = mean1 + mean2, varY = var1 + var2;
  const pmf1 = binomPmf(n1, p1), pmf2 = binomPmf(n2, p2);
  const pmfY = convolve(pmf1, pmf2);
  const slopeXonY = varY > 0 ? var1 / varY : 0;
  return {
    mean1, var1, sd1: Math.sqrt(var1),
    mean2, var2, sd2: Math.sqrt(var2),
    meanY, varY, sdY: Math.sqrt(varY),
    pmf1, pmf2, pmfY,
    normalY: normalBinProbs(n1 + n2 + 1, meanY, Math.sqrt(varY)),
    rho: varY > 0 ? Math.sqrt(var1 / varY) : 0,
    // Y를 X₁로 회귀: E[Y|X₁] = X₁ + n₂p₂
    slopeYonX: 1,
    interceptYonX: mean2,
    // X₁을 Y로 회귀: E[X₁|Y] ≈ E[X₁] + σ₁²/σ² (Y − E[Y])
    slopeXonY,
    interceptXonY: mean1 - slopeXonY * meanY,
    samePBinomial: p1 === p2,
  };
}

/* ---------------- 시뮬레이션 ---------------- */

/**
 * 1단계 보드 즉시 계산. 공마다 n번의 좌/우 선택을 차례로 뽑는다
 * (애니메이션 모드와 같은 난수 소비 순서 → 같은 시드면 같은 결과).
 */
export function simulateSingle({ n, p, N, seed }) {
  const rng = createRng(seed);
  const counts = new Array(n + 1).fill(0);
  const positions = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0;
    for (let r = 0; r < n; r++) if (rng.next() < p) k++;
    positions[i] = k;
    counts[k]++;
  }
  return { counts, positions };
}

/** 2단계 보드 즉시 계산: 공마다 위 보드 n₁번, 아래 보드 n₂번 */
export function simulateTwo({ n1, n2, p1, p2, N, seed }) {
  const rng = createRng(seed);
  const nMid = n1 + 1, nFin = n1 + n2 + 1;
  const mids = new Uint8Array(N);
  const finals = new Uint8Array(N);
  const midCounts = new Array(nMid).fill(0);
  const finalCounts = new Array(nFin).fill(0);
  const cross = new Array(nMid * nFin).fill(0);
  for (let i = 0; i < N; i++) {
    let x1 = 0;
    for (let r = 0; r < n1; r++) if (rng.next() < p1) x1++;
    let x2 = 0;
    for (let r = 0; r < n2; r++) if (rng.next() < p2) x2++;
    const y = x1 + x2;
    mids[i] = x1;
    finals[i] = y;
    midCounts[x1]++;
    finalCounts[y]++;
    cross[x1 * nFin + y]++;
  }
  return { mids, finals, midCounts, finalCounts, cross };
}

/** 한 공의 경로(좌 0 / 우 1 배열)를 rng에서 뽑는다 — 애니메이션용 */
export function drawPath(rng, rows, p, out) {
  const path = out || new Uint8Array(rows);
  for (let r = 0; r < rows; r++) path[r] = rng.next() < p ? 1 : 0;
  return path;
}

/* ---------------- 색상 ---------------- */

/** 색각 이상에 안전한 Okabe–Ito 8색 (검정 대신 회색) */
export const OKABE_ITO = ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#999999'];

const VIRIDIS = [
  [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142],
  [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37],
];

export function viridis(t) {
  t = Math.min(1, Math.max(0, t));
  const x = t * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(x));
  const f = x - i;
  const c = VIRIDIS[i].map((v, j) => Math.round(v + (VIRIDIS[i + 1][j] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** 중간 칸 색상표: 8칸 이하 Okabe–Ito, 초과 시 viridis */
export function binPalette(count) {
  if (count <= OKABE_ITO.length) return OKABE_ITO.slice(0, count);
  return Array.from({ length: count }, (_, i) => viridis(count === 1 ? 0.5 : i / (count - 1)));
}
