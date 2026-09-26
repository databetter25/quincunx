// 시드 기반 의사난수 생성기 — xoshiro128** (시드 확장은 splitmix32)
// 같은 시드이면 어느 브라우저에서나 같은 수열을 만든다.

export const RNG_NAME = 'xoshiro128**';

function splitmix32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

const rotl = (x, k) => (x << k) | (x >>> (32 - k));

/**
 * @param {number} seed 32비트 정수 시드
 * @returns {{ next: () => number, nextU32: () => number, seed: number }}
 */
export function createRng(seed) {
  const sm = splitmix32(seed);
  let a = sm(), b = sm(), c = sm(), d = sm();
  if ((a | b | c | d) === 0) a = 1;

  function nextU32() {
    const result = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0;
    const t = b << 9;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = rotl(d, 11);
    return result;
  }

  return {
    seed: seed >>> 0,
    nextU32,
    /** [0, 1) 균등 난수 */
    next: () => nextU32() / 4294967296,
  };
}

/** 자동 시드: 1 이상 2^31 미만의 정수 (입력·표시가 쉬운 범위) */
export function randomSeed() {
  const buf = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(buf);
  else buf[0] = Math.floor(Math.random() * 4294967296);
  return (buf[0] % 2147483646) + 1;
}

/** 사용자 입력을 시드로 변환. 비어 있거나 잘못되면 null (= 자동) */
export function parseSeed(text) {
  const s = String(text ?? '').trim();
  if (s === '') return null;
  if (!/^-?\d+$/.test(s)) return null;
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  return Math.abs(Math.trunc(v)) % 4294967296;
}
