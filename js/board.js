// 캔버스 보드와 애니메이션 — 1단계(표준형)와 2단계(칸막이 있는 Galton형)를 함께 다룬다.
// 공의 좌/우 경로는 시드 난수로 미리 정해지고, 애니메이션은 그 경로를 부드럽게 그릴 뿐이다.
// 난수 소비 순서(공마다 위 보드 n₁번 → 아래 보드 n₂번)는 model.js의 즉시 계산과 같다.

import { createRng } from './rng.js';
import { binPalette, choose, normalPdf } from './model.js';
import { themeColors, onThemeChange } from './common.js';

const DROP_RATE = [3, 6, 12, 25, 50, 100, 200, 400, 800, 1600]; // 1초당 투입 공 수
const ROW_MS = [230, 190, 155, 125, 100, 80, 64, 50, 40, 32]; // 한 행을 지나는 시간(ms)

export class GaltonBoard {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   *  stages: [{rows, p}] (1개 = 1단계, 2개 = 2단계)
   *  N, seed, speed(1–10), ballSize(px 지름), gate('pass'|'collect'|'one'|'manual')
   *  colorByMid, showBinom, showNormal, showPathCounts
   *  theory: { pmf, mean, sd } 최종 칸 이론 분포(겹침 표시용)
   *  aspect: 높이/너비 비, maxHeight(px)
   *  onArrive(i, mid, final), onProgress(), onStateChange(state), onGate(text)
   */
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = {
      speed: 5, ballSize: 4, gate: 'pass', colorByMid: true,
      showBinom: true, showNormal: true, showPathCounts: false,
      aspect: 0.85, maxHeight: 900, ...opts,
    };
    this.colors = themeColors();
    this.pinLayer = document.createElement('canvas');
    this.highlightInfo = null;
    this._raf = 0;
    this._last = 0;
    this._frame = this._frame.bind(this);

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas.parentElement);
    onThemeChange((c) => { this.colors = c; this._renderPins(); this.draw(); });
    this.reset();
    this.resize();
    this._ready = true;
  }

  /* ---------------- 설정 ---------------- */

  get isTwo() { return this.opts.stages.length > 1; }
  get n1() { return this.opts.stages[0].rows; }
  get n2() { return this.isTwo ? this.opts.stages[1].rows : 0; }
  get rows() { return this.n1 + this.n2; }
  get nMid() { return this.n1 + 1; }
  get nFinal() { return this.rows + 1; }

  /** 모델 설정 변경 → 초기화 */
  configure(opts) {
    Object.assign(this.opts, opts);
    this.reset();
    this.resize();
  }

  /** 표시만 바꾸는 설정 (초기화 없음) */
  setDisplay(opts) {
    const relayout = 'ballSize' in opts || 'showPathCounts' in opts;
    Object.assign(this.opts, opts);
    if (relayout) this._renderPins();
    this.draw();
  }

  reset() {
    this.stop();
    this.rng = createRng(this.opts.seed >>> 0);
    this.balls = [];
    this.dropped = 0;
    this.arrived = 0;
    this.finalCounts = new Array(this.nFinal).fill(0);
    this.midCounts = new Array(this.nMid).fill(0); // 중간 칸 도착(누적)
    this.cross = new Array(this.nMid * this.nFinal).fill(0);
    this.heldCount = new Array(this.nMid).fill(0);
    this.heldQueue = Array.from({ length: this.nMid }, () => []);
    this.gateOpen = new Array(this.nMid).fill(this.opts.gate === 'pass');
    this.upperInFlight = 0;
    this.gatePhase = this.opts.gate === 'pass' ? 'open' : 'closed';
    this.openCursor = -1;
    this.nextOpenAt = 0;
    this.spawnAcc = 0;
    this.state = 'idle';
    this.trace = null;
    this.traceNext = false;
    this.highlightInfo = null;
    this.instant = false;
    this.palette = binPalette(this.nMid);
    this._clock = 0;
    this._emitState();
    this.draw();
  }

  /* ---------------- 배치 ---------------- */

  resize() {
    const parent = this.canvas.parentElement;
    const W = Math.max(240, parent.clientWidth);
    const H = Math.round(Math.min(this.opts.maxHeight, W * this.opts.aspect));
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.W = W; this.H = H; this.dpr = dpr;
    for (const c of [this.canvas, this.pinLayer]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    this.canvas.style.height = `${H}px`;
    this._layout();
    this._renderPins();
    this.draw();
  }

  _layout() {
    const { W, H } = this;
    const B = this.nFinal;
    const dx = W / (B + 1);
    const labelH = 20;
    let dy, top, divH = 0;
    if (!this.isTwo) {
      dy = Math.min(dx * 1.0, (H * 0.56) / (this.rows + 0.8));
      top = Math.max(10, dy * 0.55);
    } else {
      divH = Math.max(30, H * 0.13);
      dy = Math.min(dx * 1.0, (H * 0.64 - divH) / (this.rows + 1.4));
      top = Math.max(10, dy * 0.55);
    }
    const ballR = Math.max(1, Math.min(this.opts.ballSize / 2, dx * 0.42));
    const pinR = Math.max(1, Math.min(dx * 0.11, 3.2));
    const L = { dx, dy, top, divH, labelH, ballR, pinR, cx: W / 2, pinOff: Math.min(dy * 0.42, ballR + pinR + 1.5) };
    L.rowY = (r) => top + r * dy;
    if (this.isTwo) {
      L.divTop = L.rowY(this.n1) + dy * 0.25;
      L.gateY = L.divTop + divH;
      L.holdY = L.gateY - ballR - 1;
      L.lowRowY = (r) => L.gateY + dy * 0.55 + r * dy;
      L.histTop = L.lowRowY(this.n2) + dy * 0.2;
    } else {
      L.histTop = L.rowY(this.n1) + dy * 0.2;
    }
    L.baseline = H - labelH;
    L.histH = Math.max(20, L.baseline - L.histTop - 4);
    L.finalX = (k) => L.cx + (k - this.rows / 2) * dx;
    L.midX = (k) => L.cx + (k - this.n1 / 2) * dx;
    this.L = L;
  }

  _renderPins() {
    if (!this.L) return;
    const g = this.pinLayer.getContext('2d');
    const { L, colors: c } = this;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    g.fillStyle = c.pin;
    const pin = (x, y) => { g.moveTo(x + L.pinR, y); g.arc(x, y, L.pinR, 0, Math.PI * 2); };
    g.beginPath();
    for (let r = 0; r < this.n1; r++) {
      for (let j = 0; j <= r; j++) pin(L.cx + (j - r / 2) * L.dx, L.rowY(r) + L.pinOff);
    }
    if (this.isTwo) {
      for (let r = 0; r < this.n2; r++) {
        const m = this.n1 + r;
        for (let j = 0; j <= m; j++) pin(L.cx + (j - m / 2) * L.dx, L.lowRowY(r) + L.pinOff);
      }
    }
    g.fill();

    // 경로 수 표시 (파스칼 삼각형)
    if (this.opts.showPathCounts && !this.isTwo && L.dx >= 18) {
      g.fillStyle = c.text2;
      g.font = `${Math.min(11, L.dx * 0.34)}px ${c.font || 'sans-serif'}`;
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      for (let r = 0; r < this.n1; r++) {
        for (let j = 0; j <= r; j++) {
          g.fillText(String(choose(r, j)), L.cx + (j - r / 2) * L.dx, L.rowY(r) + L.pinOff - L.pinR - 1);
        }
      }
    }

    // 칸 벽
    g.strokeStyle = c.border;
    g.lineWidth = 1;
    g.beginPath();
    for (let k = 0; k <= this.nFinal; k++) {
      const x = Math.round(L.finalX(k) - L.dx / 2) + 0.5;
      g.moveTo(x, L.histTop + 2);
      g.lineTo(x, L.baseline);
    }
    g.moveTo(L.finalX(0) - L.dx / 2, L.baseline + 0.5);
    g.lineTo(L.finalX(this.rows) + L.dx / 2, L.baseline + 0.5);
    if (this.isTwo) {
      for (let k = 0; k <= this.nMid; k++) {
        const x = Math.round(L.midX(k) - L.dx / 2) + 0.5;
        g.moveTo(x, L.divTop);
        g.lineTo(x, L.gateY);
      }
    }
    g.stroke();

    // 칸 번호
    g.fillStyle = c.text3;
    g.font = `10px ${c.font || 'sans-serif'}`;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    const every = L.dx >= 16 ? 1 : L.dx >= 8 ? 5 : 10;
    for (let k = 0; k < this.nFinal; k++) {
      if (k % every === 0 || k === this.rows) g.fillText(String(k), L.finalX(k), L.baseline + 4);
    }
  }

  /* ---------------- 실행 제어 ---------------- */

  start() {
    if (this.instant) this.reset();
    if (this.state === 'done') this.reset();
    this.state = 'running';
    this._emitState();
    this._kick();
  }

  pause() {
    if (this.state !== 'running' && this.state !== 'stepping') return;
    this.state = 'paused';
    this.stop();
    this._emitState();
  }

  dropOne() {
    if (this.instant || this.state === 'done') this.reset();
    if (this.dropped >= this.opts.N) return;
    this._spawn();
    if (this.state !== 'running') {
      this.state = 'stepping';
      this._emitState();
    }
    this._kick();
  }

  /** 수동 칸막이(소개 페이지): 열기/닫기 */
  setGate(open) {
    for (let k = 0; k < this.nMid; k++) {
      this.gateOpen[k] = open;
      if (open) this._releaseBin(k);
    }
    this.gatePhase = open ? 'open' : 'closed';
    this.opts.onGate?.(open ? 'open' : 'closed');
    if (open && this.state !== 'running' && this.state !== 'done') { this.state = 'stepping'; this._emitState(); }
    if (open) this._kick();
    this.draw();
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  destroy() {
    this.stop();
    this._ro.disconnect();
  }

  _kick() {
    if (this._raf) return;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._frame);
  }

  _emitState() {
    if (this._ready) this.opts.onStateChange?.(this.state);
  }

  /** 즉시 계산 결과를 보드에 반영 (애니메이션 없음) */
  setInstantResult({ finalCounts, midCounts, cross, tracePath }) {
    this.stop();
    this.balls = [];
    this.instant = true;
    this.finalCounts = finalCounts.slice();
    this.midCounts = midCounts ? midCounts.slice() : new Array(this.nMid).fill(0);
    this.cross = cross ? cross.slice() : new Array(this.nMid * this.nFinal).fill(0);
    this.heldCount.fill(0);
    this.arrived = this.dropped = finalCounts.reduce((a, b) => a + b, 0);
    this.gatePhase = 'open';
    this.gateOpen.fill(true);
    this.trace = tracePath ? { path: tracePath, done: true } : null;
    this.state = 'done';
    this._emitState();
    this.draw();
  }

  /* ---------------- 공 ---------------- */

  _spawn() {
    const i = this.dropped++;
    const R = this.rows;
    const pref = new Uint8Array(R + 1);
    const path = new Uint8Array(R);
    const [s1, s2] = this.opts.stages;
    for (let r = 0; r < this.n1; r++) path[r] = this.rng.next() < s1.p ? 1 : 0;
    for (let r = 0; r < this.n2; r++) path[this.n1 + r] = this.rng.next() < s2.p ? 1 : 0;
    for (let r = 0; r < R; r++) pref[r + 1] = pref[r] + path[r];
    const ball = { i, path, pref, mid: pref[this.n1], final: pref[R], seg: 0, t: 0, held: false, releaseAt: 0 };
    if (this.traceNext) { this.trace = { ball, path, done: false }; this.traceNext = false; }
    this.balls.push(ball);
    this.upperInFlight++;
  }

  /** 웨이포인트 수 */
  get _wpCount() {
    return this.isTwo ? this.n1 + this.n2 + 4 : this.n1 + 2;
  }

  /** 공 b의 i번째 웨이포인트 좌표 */
  _wp(pref, i, mid, final) {
    const { L } = this;
    const n1 = this.n1;
    if (i <= n1) return [L.cx + (pref[i] - i / 2) * L.dx, L.rowY(i)];
    if (!this.isTwo) return [L.finalX(final), this._landY(final)];
    if (i === n1 + 1) return [L.midX(mid), L.holdY - Math.min(this._heldHeight(mid), L.divH - L.ballR * 2)];
    const r = i - (n1 + 2);
    if (r <= this.n2) {
      const j = pref[n1 + r] - pref[n1];
      return [L.cx + (mid + j - (n1 + r) / 2) * L.dx, L.lowRowY(r)];
    }
    return [L.finalX(final), this._landY(final)];
  }

  _segKind(s) {
    // 'bounce' = 핀에 맞고 좌/우로, 'fall' = 수직 낙하
    if (s < this.n1) return 'bounce';
    if (!this.isTwo) return 'fall';
    if (s === this.n1 || s === this.n1 + 1) return 'fall';
    if (s < this.n1 + 2 + this.n2) return 'bounce';
    return 'fall';
  }

  _landY(k) {
    const h = this._barHeight(this.finalCounts[k]);
    return this.L.baseline - h - this.L.ballR;
  }

  _scale() {
    const N = Math.max(this.opts.N, this.arrived);
    const pmax = this.opts.theory?.pmf ? Math.max(...this.opts.theory.pmf) : 0.5;
    let cmax = 0;
    for (const c of this.finalCounts) if (c > cmax) cmax = c;
    return Math.max(1, N * pmax * 1.18, cmax * 1.04);
  }

  _barHeight(count) {
    return (count / this._scaleCache) * this.L.histH;
  }

  _heldScale() {
    const n1 = this.n1, p = this.opts.stages[0].p;
    const pmax = p <= 0 || p >= 1 ? 1 : Math.max(0.12, 1 / Math.sqrt(2 * Math.PI * n1 * p * (1 - p) + 1e-9));
    return Math.max(1, this.opts.N * Math.min(1, pmax) * 1.1);
  }

  _heldHeight(k) {
    return (this.heldCount[k] / this._heldScale()) * (this.L.divH - 4);
  }

  _segDuration(s) {
    const rowMs = ROW_MS[this.opts.speed - 1] || 100;
    const kind = this._segKind(s);
    if (kind === 'bounce') return rowMs;
    // 낙하 구간은 거리에 비례
    return rowMs * 1.4;
  }

  _frame(now) {
    this._raf = 0;
    const dt = Math.min(50, now - this._last);
    this._last = now;
    this._clock += dt;
    this._scaleCache = this._scale();

    // 투입
    if (this.state === 'running' && this.dropped < this.opts.N) {
      this.spawnAcc += (dt / 1000) * DROP_RATE[this.opts.speed - 1];
      if (this.dropped === 0 && this.spawnAcc < 1) this.spawnAcc = 1;
      let n = Math.floor(this.spawnAcc);
      this.spawnAcc -= n;
      while (n-- > 0 && this.dropped < this.opts.N) this._spawn();
    }

    // 이동
    const lastSeg = this._wpCount - 2;
    let alive = 0, moving = 0;
    const next = [];
    for (const b of this.balls) {
      if (b.held) {
        if (b.releaseAt) moving++;
        if (b.releaseAt && this._clock >= b.releaseAt) {
          b.held = false;
          b.releaseAt = 0;
          this.heldCount[b.mid]--;
        } else { next.push(b); alive++; continue; }
      }
      b.t += dt;
      let done = false;
      while (b.t >= this._segDuration(b.seg)) {
        b.t -= this._segDuration(b.seg);
        b.seg++;
        if (this.isTwo && b.seg === this.n1 + 1) {
          // 중간 칸 도착
          this.upperInFlight--;
          this.midCounts[b.mid]++;
          if (!this.gateOpen[b.mid]) {
            b.held = true;
            b.t = 0;
            this.heldCount[b.mid]++;
            this.heldQueue[b.mid].push(b);
            break;
          }
        }
        if (b.seg > lastSeg) {
          done = true;
          break;
        }
      }
      if (b.held) { next.push(b); alive++; continue; }
      if (done) {
        if (!this.isTwo) this.upperInFlight--;
        this._arrive(b);
      } else {
        next.push(b);
        alive++;
        moving++;
      }
    }
    this.balls = next;

    if (this.isTwo) this._updateGate();

    this.draw();
    this.opts.onProgress?.();

    const allDropped = this.dropped >= this.opts.N;
    if (allDropped && alive === 0) {
      this.state = 'done';
      this._emitState();
      return;
    }
    if (this.state === 'stepping' && alive === 0) {
      this.state = 'paused';
      this._emitState();
      return;
    }
    // 수동 칸막이가 닫힌 채 모든 공이 대기 중이면 칸막이를 열 때까지 쉰다
    if (this.opts.gate === 'manual' && allDropped && moving === 0) return;
    if (this.state === 'running' || this.state === 'stepping') this._raf = requestAnimationFrame(this._frame);
  }

  _arrive(b) {
    this.arrived++;
    this.finalCounts[b.final]++;
    this.cross[b.mid * this.nFinal + b.final]++;
    if (!this.isTwo) this.midCounts[b.mid]++;
    if (this.trace && this.trace.ball === b) this.trace.done = true;
    this.opts.onArrive?.(b.i, this.isTwo ? b.mid : null, b.final);
  }

  _releaseBin(k) {
    const q = this.heldQueue[k].filter((b) => b.held && !b.releaseAt);
    const rowMs = ROW_MS[this.opts.speed - 1] || 100;
    const interval = Math.min(rowMs * 0.45, 2400 / Math.max(1, q.length));
    q.forEach((b, j) => { b.releaseAt = this._clock + 1 + j * interval; });
    this.heldQueue[k] = [];
  }

  _updateGate() {
    const mode = this.opts.gate;
    if (mode === 'pass' || mode === 'manual') return;
    const collected = this.dropped >= this.opts.N && this.upperInFlight === 0;
    if (this.gatePhase === 'closed') {
      if (!collected) return;
      if (mode === 'collect') {
        for (let k = 0; k < this.nMid; k++) { this.gateOpen[k] = true; this._releaseBin(k); }
        this.gatePhase = 'open';
        this.opts.onGate?.('open');
      } else {
        this.gatePhase = 'opening';
        this.openCursor = -1;
        this.nextOpenAt = this._clock;
      }
    }
    if (this.gatePhase === 'opening') {
      const cur = this.openCursor;
      const curEmpty = cur < 0 || this.heldCount[cur] === 0;
      if (curEmpty && this._clock >= this.nextOpenAt) {
        // 다음 비어 있지 않은 칸
        let k = cur + 1;
        while (k < this.nMid && this.heldCount[k] === 0) { this.gateOpen[k] = true; k++; }
        if (k >= this.nMid) {
          this.gatePhase = 'open';
          this.opts.onGate?.('open');
          return;
        }
        this.openCursor = k;
        this.gateOpen[k] = true;
        this._releaseBin(k);
        this.opts.onGate?.('opening', k);
      } else if (!curEmpty) {
        this.nextOpenAt = this._clock + (ROW_MS[this.opts.speed - 1] || 100) * 1.5;
      }
    }
  }

  /* ---------------- 그리기 ---------------- */

  draw() {
    if (!this.L) return;
    const { ctx: g } = this;
    this._scaleCache = this._scale();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.pinLayer, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this._drawHistogram(g);
    if (this.isTwo) this._drawDivider(g);
    this._drawOverlays(g);
    this._drawHighlight(g);
    this._drawTrace(g);
    this._drawBalls(g);
  }

  _drawHistogram(g) {
    const { L, colors: c } = this;
    const w = Math.max(1, L.dx - Math.max(1, L.dx * 0.12));
    const stacked = this.isTwo && this.opts.colorByMid;
    for (let k = 0; k < this.nFinal; k++) {
      const x = L.finalX(k) - w / 2;
      if (!stacked) {
        const h = this._barHeight(this.finalCounts[k]);
        if (h <= 0) continue;
        g.fillStyle = c.barAlpha;
        g.fillRect(x, L.baseline - h, w, h);
      } else {
        let y = L.baseline;
        for (let m = 0; m < this.nMid; m++) {
          const cnt = this.cross[m * this.nFinal + k];
          if (!cnt) continue;
          const h = this._barHeight(cnt);
          g.fillStyle = this.palette[m];
          g.fillRect(x, y - h, w, h);
          y -= h;
        }
      }
    }
  }

  _drawDivider(g) {
    const { L, colors: c } = this;
    const w = Math.max(1, L.dx - Math.max(1, L.dx * 0.12));
    // 모인 공 더미
    for (let k = 0; k < this.nMid; k++) {
      const hc = this.heldCount[k];
      if (hc <= 0) continue;
      const h = Math.min(L.divH - 2, this._heldHeight(k));
      g.fillStyle = this.opts.colorByMid ? this.palette[k] : c.barAlpha;
      g.fillRect(L.midX(k) - w / 2, L.gateY - h, w, h);
    }
    // 칸막이(문)
    g.lineWidth = 2.5;
    for (let k = 0; k < this.nMid; k++) {
      const x0 = L.midX(k) - L.dx / 2, x1 = L.midX(k) + L.dx / 2;
      if (this.gateOpen[k]) {
        g.strokeStyle = c.borderLt;
        g.setLineDash([2, 4]);
      } else {
        g.strokeStyle = c.text2;
        g.setLineDash([]);
      }
      g.beginPath();
      g.moveTo(x0 + 1, L.gateY + 1);
      g.lineTo(x1 - 1, L.gateY + 1);
      g.stroke();
    }
    g.setLineDash([]);
    g.lineWidth = 1;
    // 중간 칸 색 띠
    if (this.opts.colorByMid) {
      for (let k = 0; k < this.nMid; k++) {
        g.fillStyle = this.palette[k];
        g.fillRect(L.midX(k) - w / 2, L.divTop - 3, w, 3);
      }
    }
  }

  _drawOverlays(g) {
    const { L, colors: c } = this;
    const th = this.opts.theory;
    const n = this.arrived;
    if (!th || n <= 0) return;
    if (this.opts.showNormal && th.sd > 0) {
      g.strokeStyle = c.normal;
      g.lineWidth = 1.6;
      g.setLineDash([6, 4]);
      g.beginPath();
      const steps = Math.max(80, this.nFinal * 8);
      for (let i = 0; i <= steps; i++) {
        const xk = -0.5 + (i / steps) * this.nFinal;
        const yv = (n * normalPdf((xk - th.mean) / th.sd)) / th.sd;
        const X = L.finalX(xk), Y = L.baseline - this._barHeight(yv);
        i ? g.lineTo(X, Y) : g.moveTo(X, Y);
      }
      g.stroke();
      g.setLineDash([]);
    }
    if (this.opts.showBinom && th.pmf) {
      const r = Math.max(2, Math.min(4.5, L.dx * 0.22));
      g.lineWidth = 1.6;
      g.strokeStyle = c.theory;
      g.fillStyle = c.bg;
      g.beginPath();
      for (let k = 0; k < this.nFinal; k++) {
        const e = th.pmf[k] * n;
        if (e < 1e-3 * n) continue;
        const X = L.finalX(k), Y = L.baseline - this._barHeight(e);
        g.moveTo(X + r, Y);
        g.arc(X, Y, r, 0, Math.PI * 2);
      }
      g.fill();
      g.stroke();
    }
  }

  _drawHighlight(g) {
    const hi = this.highlightInfo;
    if (!hi) return;
    const { L, colors: c } = this;
    // 선택한 최종 칸 테두리
    const x = L.finalX(hi.final) - L.dx / 2;
    g.strokeStyle = c.trace;
    g.lineWidth = 2;
    g.strokeRect(x + 1, L.histTop, L.dx - 2, L.baseline - L.histTop);
    if (!this.isTwo || !hi.dist) return;
    // 중간 칸 조건부 분포(칸막이 영역에 윤곽 막대)
    const max = Math.max(1, ...hi.dist);
    const w = Math.max(1, L.dx * 0.7);
    g.fillStyle = c.trace;
    g.globalAlpha = 0.55;
    for (let k = 0; k < this.nMid; k++) {
      const h = (hi.dist[k] / max) * (L.divH - 6);
      if (h > 0) g.fillRect(L.midX(k) - w / 2, L.gateY - h, w, h);
    }
    g.globalAlpha = 1;
    // 조건부 평균 표시와 최종 칸 → 중간 칸 대응 위치 비교
    const drawMarker = (xv, color, dashed) => {
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.setLineDash(dashed ? [4, 3] : []);
      g.beginPath();
      g.moveTo(xv, L.divTop - 6);
      g.lineTo(xv, L.gateY + 4);
      g.stroke();
      g.setLineDash([]);
    };
    if (Number.isFinite(hi.mean)) drawMarker(L.midX(hi.mean), c.text, false);
    if (Number.isFinite(hi.naive)) drawMarker(L.midX(hi.naive), c.red, true);
  }

  _drawTrace(g) {
    const tr = this.trace;
    if (!tr) return;
    const { L, colors: c } = this;
    const pref = new Uint8Array(this.rows + 1);
    for (let r = 0; r < this.rows; r++) pref[r + 1] = pref[r] + tr.path[r];
    const mid = pref[this.n1], fin = pref[this.rows];
    const lastWp = this._wpCount - 1;
    let upto = lastWp;
    let cur = null;
    if (!tr.done && tr.ball) {
      upto = tr.ball.seg;
      cur = this._ballPos(tr.ball);
    }
    g.strokeStyle = c.trace;
    g.lineWidth = 2.5;
    g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i <= Math.min(upto, lastWp); i++) {
      let [x, y] = this._wp(pref, i, mid, fin);
      if (i === lastWp) y = L.baseline - 2;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    if (cur) g.lineTo(cur[0], cur[1]);
    g.stroke();
  }

  _ballPos(b) {
    const a = this._wp(b.pref, b.seg, b.mid, b.final);
    if (b.held) return a;
    const z = this._wp(b.pref, b.seg + 1, b.mid, b.final);
    const u = Math.min(1, b.t / this._segDuration(b.seg));
    if (this._segKind(b.seg) === 'bounce') {
      const e = u * u * (3 - 2 * u);
      return [a[0] + (z[0] - a[0]) * e, a[1] + (z[1] - a[1]) * u - Math.sin(Math.PI * u) * this.L.dy * 0.28];
    }
    return [a[0] + (z[0] - a[0]) * u, a[1] + (z[1] - a[1]) * u * u];
  }

  _drawBalls(g) {
    const { L, colors: c } = this;
    if (!this.balls.length) return;
    const r = L.ballR;
    const byColor = new Map();
    const useMid = this.isTwo && this.opts.colorByMid;
    for (const b of this.balls) {
      if (b.held) continue;
      const pastMid = useMid && b.seg >= this.n1;
      const col = pastMid ? this.palette[b.mid] : c.ball;
      let list = byColor.get(col);
      if (!list) byColor.set(col, (list = []));
      list.push(this._ballPos(b));
    }
    const many = this.balls.length > 1500 || r < 1.6;
    for (const [col, pts] of byColor) {
      g.fillStyle = col;
      if (many) {
        for (const [x, y] of pts) g.fillRect(x - r, y - r, r * 2, r * 2);
      } else {
        g.beginPath();
        for (const [x, y] of pts) { g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); }
        g.fill();
      }
    }
  }

  /* ---------------- 좌표 → 칸 ---------------- */

  /** 이벤트 좌표로부터 칸을 찾는다: {zone: 'final'|'mid', k, x, y} */
  hitTest(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    const { L } = this;
    if (y >= L.histTop - 4 && y <= this.H) {
      const k = Math.round((x - L.cx) / L.dx + this.rows / 2);
      if (k >= 0 && k < this.nFinal) return { zone: 'final', k, x, y };
    }
    if (this.isTwo && y >= L.divTop - 6 && y <= L.gateY + 6) {
      const k = Math.round((x - L.cx) / L.dx + this.n1 / 2);
      if (k >= 0 && k < this.nMid) return { zone: 'mid', k, x, y };
    }
    return null;
  }

  setHighlight(info) {
    this.highlightInfo = info;
    this.draw();
  }
}
