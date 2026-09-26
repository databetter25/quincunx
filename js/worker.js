// 즉시 계산용 Web Worker (모듈 워커)
// 메시지: { id, type: 'single' | 'two', params } → { id, result } 또는 { id, error }

import { simulateSingle, simulateTwo } from './model.js';

self.onmessage = (e) => {
  const { id, type, params } = e.data;
  try {
    const t0 = performance.now();
    if (type === 'single') {
      const r = simulateSingle(params);
      self.postMessage({ id, result: { ...r, ms: performance.now() - t0 } }, [r.positions.buffer]);
    } else if (type === 'two') {
      const r = simulateTwo(params);
      self.postMessage({ id, result: { ...r, ms: performance.now() - t0 } }, [r.mids.buffer, r.finals.buffer]);
    } else {
      throw new Error(`알 수 없는 계산 유형: ${type}`);
    }
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
