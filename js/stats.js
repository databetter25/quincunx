// 기술통계, 카이제곱 적합도 검정, 회귀, 상관

import { normalQuantile } from './model.js';

/* ---------------- 도수 배열 기반 기술통계 ---------------- */

/**
 * 칸별 도수(counts[k] = 칸 k에 도착한 공 수)로부터 기술통계를 구한다.
 * 분산은 표본분산(n−1 분모), 왜도·첨도는 적률 기반(첨도는 초과첨도).
 */
export function describeCounts(counts) {
  let N = 0, s1 = 0;
  for (let k = 0; k < counts.length; k++) { N += counts[k]; s1 += k * counts[k]; }
  if (N === 0) return { N: 0, mean: NaN, variance: NaN, sd: NaN, skewness: NaN, exKurtosis: NaN, mode: NaN, median: NaN, min: NaN, max: NaN };
  const mean = s1 / N;
  let m2 = 0, m3 = 0, m4 = 0;
  let mode = 0, modeCount = -1, min = -1, max = -1;
  for (let k = 0; k < counts.length; k++) {
    const c = counts[k];
    if (!c) continue;
    const d = k - mean;
    m2 += c * d * d;
    m3 += c * d * d * d;
    m4 += c * d * d * d * d;
    if (c > modeCount) { modeCount = c; mode = k; }
    if (min < 0) min = k;
    max = k;
  }
  const popVar = m2 / N;
  const variance = N > 1 ? m2 / (N - 1) : 0;
  const skewness = popVar > 0 ? m3 / N / Math.pow(popVar, 1.5) : 0;
  const exKurtosis = popVar > 0 ? m4 / N / (popVar * popVar) - 3 : 0;
  // 중앙값: 누적 도수가 N/2를 넘는 첫 칸 (N 짝수면 두 가운데 값의 평균)
  const medianAt = (rank) => {
    let cum = 0;
    for (let k = 0; k < counts.length; k++) { cum += counts[k]; if (cum >= rank) return k; }
    return counts.length - 1;
  };
  const median = N % 2 ? medianAt((N + 1) / 2) : (medianAt(N / 2) + medianAt(N / 2 + 1)) / 2;
  return { N, mean, variance, sd: Math.sqrt(variance), popVariance: popVar, skewness, exKurtosis, mode, median, min, max };
}

/** 값 배열의 평균·분산(표본) */
export function meanVar(values) {
  const n = values.length;
  if (!n) return { mean: NaN, variance: NaN };
  let s = 0;
  for (let i = 0; i < n; i++) s += values[i];
  const mean = s / n;
  let ss = 0;
  for (let i = 0; i < n; i++) { const d = values[i] - mean; ss += d * d; }
  return { mean, variance: n > 1 ? ss / (n - 1) : 0 };
}

/* ---------------- 감마·카이제곱 ---------------- */

export function lnGamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** 정규화 상부 불완전 감마 Q(a, x) */
export function gammaQ(a, x) {
  if (x <= 0) return 1;
  if (x < a + 1) {
    // 급수 전개로 P를 구한 뒤 1 − P
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return Math.max(0, 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a)));
  }
  // 연분수 (Lentz)
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

export function chiSquarePValue(stat, df) {
  if (df <= 0) return NaN;
  return gammaQ(df / 2, stat / 2);
}

/**
 * 카이제곱 적합도 검정. 기대 도수가 5 미만인 칸은 이웃 칸과 병합한다
 * (양 끝에서 안쪽으로 병합, 남은 작은 묶음은 이웃 묶음에 합침).
 * @param {number[]} observed 칸별 관측 도수
 * @param {number[]} probs 칸별 이론 확률
 * @param {number} [estimatedParams=0] 자료로 추정한 모수 수
 */
export function chiSquareTest(observed, probs, estimatedParams = 0, minExpected = 5) {
  const N = observed.reduce((a, b) => a + b, 0);
  const K = observed.length;
  const expected = probs.map((p) => p * N);
  // 병합: 왼쪽 끝에서부터 묶음 만들기
  const groups = [];
  let cur = null;
  for (let k = 0; k < K; k++) {
    if (!cur) cur = { from: k, to: k, o: 0, e: 0 };
    cur.to = k;
    cur.o += observed[k];
    cur.e += expected[k];
    if (cur.e >= minExpected) { groups.push(cur); cur = null; }
  }
  if (cur) {
    if (groups.length) {
      const last = groups[groups.length - 1];
      last.to = cur.to; last.o += cur.o; last.e += cur.e;
    } else groups.push(cur);
  }
  // 이론 확률 0인데 관측이 있는 경우 대비: e=0 묶음은 이웃과 합침
  for (let i = groups.length - 1; i >= 0 && groups.length > 1; i--) {
    if (groups[i].e <= 0) {
      const j = i > 0 ? i - 1 : i + 1;
      const [a, b] = j < i ? [groups[j], groups[i]] : [groups[i], groups[j]];
      const merged = { from: a.from, to: b.to, o: a.o + b.o, e: a.e + b.e };
      groups.splice(Math.min(i, j), 2, merged);
    }
  }
  let stat = 0;
  for (const g of groups) {
    g.resid = g.o - g.e;
    g.contrib = g.e > 0 ? (g.resid * g.resid) / g.e : g.o > 0 ? Infinity : 0;
    stat += g.contrib;
  }
  const df = groups.length - 1 - estimatedParams;
  const p = df > 0 ? chiSquarePValue(stat, df) : NaN;
  return { N, stat, df, p, groups, merged: groups.some((g) => g.to > g.from) };
}

/* ---------------- 도수표 ---------------- */

export function frequencyTable(counts, probs) {
  const N = counts.reduce((a, b) => a + b, 0);
  return counts.map((o, k) => {
    const e = probs[k] * N;
    const resid = o - e;
    const sdE = Math.sqrt(N * probs[k] * (1 - probs[k]));
    return { k, o, rel: N ? o / N : 0, p: probs[k], e, resid, stdResid: sdE > 0 ? resid / sdE : NaN };
  });
}

/* ---------------- 회귀·상관 (교차표 가중) ---------------- */

/**
 * 교차표 cross[x * nY + y] (x = 중간 칸 X₁, y = 최종 칸 Y)에서
 * 평균, 분산, 공분산, 상관계수, 두 회귀선을 구한다.
 */
export function crossStats(cross, nX, nY) {
  let N = 0, sx = 0, sy = 0;
  for (let x = 0; x < nX; x++) for (let y = 0; y < nY; y++) {
    const c = cross[x * nY + y];
    if (!c) continue;
    N += c; sx += c * x; sy += c * y;
  }
  const mx = sx / N, my = sy / N;
  let sxx = 0, syy = 0, sxy = 0, sdd = 0, sd2 = 0;
  for (let x = 0; x < nX; x++) for (let y = 0; y < nY; y++) {
    const c = cross[x * nY + y];
    if (!c) continue;
    const dx = x - mx, dy = y - my;
    sxx += c * dx * dx; syy += c * dy * dy; sxy += c * dx * dy;
    sd2 += c * (y - x);
  }
  const m2 = sd2 / N; // X₂ = Y − X₁ 평균
  for (let x = 0; x < nX; x++) for (let y = 0; y < nY; y++) {
    const c = cross[x * nY + y];
    if (!c) continue;
    const d = y - x - m2;
    sdd += c * d * d;
  }
  const den = N > 1 ? N - 1 : 1;
  const varX = sxx / den, varY = syy / den, cov = sxy / den, var2 = sdd / den;
  const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
  const bYonX = sxx > 0 ? sxy / sxx : NaN;
  const bXonY = syy > 0 ? sxy / syy : NaN;
  return {
    N, meanX: mx, meanY: my, mean2: m2, varX, varY, var2, cov, r,
    yOnX: { slope: bYonX, intercept: my - bYonX * mx },
    xOnY: { slope: bXonY, intercept: mx - bXonY * my },
  };
}

/** 최종 칸 y에 도착한 공들의 중간 칸 조건부 분포 */
export function conditionalMid(cross, nX, nY, y) {
  const dist = new Array(nX).fill(0);
  let n = 0, s = 0;
  for (let x = 0; x < nX; x++) {
    const c = cross[x * nY + y];
    dist[x] = c; n += c; s += c * x;
  }
  let ss = 0;
  const mean = n ? s / n : NaN;
  for (let x = 0; x < nX; x++) ss += dist[x] * (x - mean) ** 2;
  return { dist, n, mean, sd: n > 1 ? Math.sqrt(ss / (n - 1)) : NaN };
}

/** 중간 칸 x에서 출발한 공들의 최종 칸 조건부 평균 */
export function conditionalFinalMeans(cross, nX, nY) {
  const out = [];
  for (let x = 0; x < nX; x++) {
    let n = 0, s = 0;
    for (let y = 0; y < nY; y++) { const c = cross[x * nY + y]; n += c; s += c * y; }
    out.push({ x, n, mean: n ? s / n : NaN });
  }
  return out;
}

/** 최종 칸 y별 중간 칸 조건부 평균 */
export function conditionalMidMeans(cross, nX, nY) {
  const out = [];
  for (let y = 0; y < nY; y++) {
    const c = conditionalMid(cross, nX, nY, y);
    out.push({ y, n: c.n, mean: c.mean });
  }
  return out;
}

/* ---------------- 수렴·Q-Q·근사 오차 ---------------- */

/** 공 수가 늘어날 때 누적 평균·분산 경로 (로그 간격 표본점) */
export function convergencePath(positions, points = 240) {
  const N = positions.length;
  const out = [];
  if (!N) return out;
  const marks = new Set();
  for (let i = 0; i < points; i++) {
    marks.add(Math.max(1, Math.round(Math.exp((Math.log(N) * i) / (points - 1)))));
  }
  marks.add(N);
  // Welford
  let mean = 0, m2 = 0;
  for (let i = 0; i < N; i++) {
    const x = positions[i];
    const n = i + 1;
    const d = x - mean;
    mean += d / n;
    m2 += d * (x - mean);
    if (marks.has(n)) out.push({ n, mean, variance: n > 1 ? m2 / (n - 1) : 0 });
  }
  return out;
}

/**
 * 도수 배열에서 정규 Q-Q 점을 만든다. 칸 k에 속한 순위 구간의 가운데
 * 누적확률을 이론 분위수로 바꾸고, 관측값은 (k − 평균)/표준편차로 표준화.
 */
export function qqPoints(counts, mean, sd) {
  const N = counts.reduce((a, b) => a + b, 0);
  const pts = [];
  let cum = 0;
  for (let k = 0; k < counts.length; k++) {
    const c = counts[k];
    if (!c) continue;
    const lo = (cum + 0.5) / N, hi = (cum + c - 0.5) / N;
    const mid = (cum + c / 2) / N;
    pts.push({
      k, n: c,
      theo: normalQuantile(Math.min(1 - 1e-9, Math.max(1e-9, mid))),
      theoLo: normalQuantile(Math.max(1e-9, lo)),
      theoHi: normalQuantile(Math.min(1 - 1e-9, hi)),
      obs: sd > 0 ? (k - mean) / sd : 0,
    });
    cum += c;
  }
  return pts;
}

/** 총변동거리 TV = ½ Σ|p − q| */
export function totalVariation(p, q) {
  let s = 0;
  for (let i = 0; i < Math.max(p.length, q.length); i++) s += Math.abs((p[i] || 0) - (q[i] || 0));
  return s / 2;
}

/* ---------------- 서식 ---------------- */

export function fmt(x, digits = 3) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞';
  const s = x.toFixed(digits);
  return (s.startsWith('-') && Number(s) === 0 ? s.slice(1) : s).replace('-', '−');
}

export function fmtInt(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return Math.round(x).toLocaleString('ko-KR');
}

export function fmtP(p) {
  if (Number.isNaN(p) || p === undefined) return '—';
  if (p < 0.0001) return '< 0.0001';
  return p.toFixed(4);
}
