// 홈: 장식용 갈톤 보드 애니메이션

import { initPage, $, prefersReducedMotion } from './common.js';
import { GaltonBoard } from './board.js';
import { theorySingle, simulateSingle } from './model.js';
import { randomSeed } from './rng.js';

initPage();

const n = 10, p = 0.5, N = 700;
const th = theorySingle(n, p);
const board = new GaltonBoard($('#hero-board'), {
  stages: [{ rows: n, p }], N, seed: randomSeed(), speed: 7, ballSize: 5,
  showBinom: false, showNormal: true,
  theory: { pmf: th.pmf, mean: th.mean, sd: th.sd },
  aspect: 0.72, maxHeight: 420,
  onStateChange: (s) => {
    if (s === 'done') setTimeout(() => { board.configure({ seed: randomSeed() }); if (visible) board.start(); }, 2500);
  },
});

let visible = true;
if (prefersReducedMotion()) {
  const r = simulateSingle({ n, p, N, seed: 20260926 });
  board.setInstantResult({ finalCounts: r.counts });
} else {
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && board.state !== 'running' && board.state !== 'done') board.start();
    else if (!visible && board.state === 'running') board.pause();
  }).observe($('#hero-board'));
}
