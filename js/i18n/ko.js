// 한국어 문자열 모음 — 다국어 확장 시 같은 키로 en.js 등을 추가한다.

export const ko = {
  siteName: '퀸컹스 실험실',
  nav: [
    { href: 'index.html', label: '홈' },
    { href: 'about.html', label: '퀸컹스란?' },
    { href: 'single.html', label: '1단계 시뮬레이션' },
    { href: 'two-stage.html', label: '2단계 시뮬레이션' },
    { href: 'analysis.html', label: '결과 분석' },
    { href: 'help.html', label: '도움말' },
  ],
  menuOpen: '메뉴 열기',
  menuClose: '메뉴 닫기',
  skip: '본문 바로가기',
  footer: '퀸컹스(Galton board) 교육용 시뮬레이션 · 모든 계산은 브라우저 안에서만 이루어집니다.',

  // 버튼·상태
  start: '시작',
  resume: '계속',
  pause: '일시정지',
  dropOne: '한 개씩 떨어뜨리기',
  reset: '초기화',
  sendToAnalysis: '분석으로 보내기',
  running: '실행 중',
  paused: '일시정지됨',
  done: '완료',
  ready: '준비',
  computing: '계산 중…',
  seedUsed: (s) => `사용된 시드: ${s}`,
  seedAuto: '자동',
  arrived: (a, N) => `도착 ${a.toLocaleString('ko-KR')} / ${N.toLocaleString('ko-KR')}개`,
  instantDone: (N, ms) => `즉시 계산 완료: 공 ${N.toLocaleString('ko-KR')}개, ${ms.toFixed(0)}ms`,
  animLimit: (N) =>
    `애니메이션은 공 5,000개까지 권장합니다. 현재 ${N.toLocaleString('ko-KR')}개입니다.\n\n[확인] 즉시 계산으로 실행\n[취소] 그래도 애니메이션으로 실행`,
  noResult: '아직 도착한 공이 없습니다. 먼저 실행해 주세요.',
  saved: '실행 결과를 저장했습니다. 분석 페이지로 이동합니다…',
  saveFail: (m) => `저장에 실패했습니다: ${m}`,

  // 툴팁
  tipBin: (k) => `칸 ${k}`,
  tipObs: '관측 도수',
  tipExp: '기대 도수',
  tipPaths: '경로 수 C(n,k)',
  tipProb: '이항 확률',

  // 칸막이
  gate: { pass: '통과', collect: '모두 모은 뒤 열기', one: '한 칸씩 열기' },
  gateClosed: '칸막이 닫힘 — 공을 모으는 중',
  gateOpening: (k) => `칸막이 열림: 중간 칸 ${k}`,
  gateOpen: '칸막이 열림',

  // 축 이름
  axisBin: '칸 번호 k (오른쪽으로 간 횟수)',
  axisFinal: '최종 칸 Y',
  axisMid: '중간 칸 X₁',
  axisCount: '도수',
  axisProb: '확률',
  axisRel: '상대도수',
  axisBalls: '공 수 (로그 눈금)',
  axisMean: '누적 평균',
  axisVar: '누적 분산',
  axisTheoQ: '이론 정규 분위수',
  axisObsQ: '표준화한 도착 위치',
  axisDiff: '이항 − 정규 근사',

  // 범례
  legendObs: '관측 도수 (막대)',
  legendBinom: '이항 확률 × N (점)',
  legendNormal: '정규 근사 (점선)',
  legendTheory: '이론값 (점선)',
  legendBaseline: '같은 총 행 수 1단계 이항분포 (점)',
  legendTheoryY: 'Y의 이론 분포 (점)',

  // 분석 해설
  interpretChi: (p, df) =>
    p >= 0.05
      ? `p값 ${p.toFixed(3)} (자유도 ${df}) — 유의수준 5%에서 이론 분포와 다르다고 볼 근거가 없습니다.`
      : `p값 ${p < 0.0001 ? '< 0.0001' : p.toFixed(4)} (자유도 ${df}) — 유의수준 5%에서 이론 분포와 다르다고 판단합니다. 설정이나 표본을 확인해 보세요.`,
  interpretChiNA: '병합 후 칸이 너무 적어 카이제곱 검정을 할 수 없습니다. 공 수를 늘려 보세요.',
};

export function t(key, ...args) {
  const v = ko[key];
  return typeof v === 'function' ? v(...args) : v ?? key;
}
