# 퀸컹스 실험실 (Quincunx Simulation)

갈톤의 퀸컹스(Galton board)를 **1단계(표준형)**와 **2단계(Galton의 2단 퀸컹스)**로 시뮬레이션하고, 결과를 통계적으로 분석하는 한국어 교육용 정적 웹사이트입니다. 빌드 도구 없이 HTML + CSS + 바닐라 JavaScript(ES 모듈)로 만들었습니다.

## 페이지

| 메뉴 | 파일 | 내용 |
| --- | --- | --- |
| 홈 | `index.html` | 소개와 체험 경로 |
| 퀸컹스란? | `about.html` | 역사·원리·수학, 인터랙티브 그림 |
| 1단계 시뮬레이션 | `single.html` | 표준 갈톤 보드 |
| 2단계 시뮬레이션 | `two-stage.html` | 중간 칸막이가 있는 2단 보드 |
| 결과 분석 | `analysis.html` | 저장된 실행의 통계 분석·비교 |
| 도움말 | `help.html` | 사용법, 용어, 참고문헌 |

## 파일 구조

```
css/style.css        공통 스타일 (라이트·다크 테마)
js/rng.js            시드 난수 생성기 (xoshiro128**)
js/model.js          1단계·2단계 확률 모델, 이론값
js/board.js          캔버스 보드와 애니메이션
js/stats.js          기술통계, 카이제곱, 회귀, 상관
js/store.js          IndexedDB 저장, JSON/CSV 입출력
js/worker.js         즉시 계산용 Web Worker
js/charts.js         SVG 차트, PNG 내보내기
js/common.js         메뉴, 수식 렌더링, 입력 연동
js/i18n/ko.js        한국어 문자열
js/*-page.js         페이지별 스크립트
```

## 로컬에서 실행

ES 모듈과 Web Worker는 `file://`에서 동작하지 않으므로 간단한 로컬 서버로 엽니다.

```bash
python -m http.server 8000
```

브라우저에서 <http://localhost:8000> 을 엽니다.

## GitHub Pages로 게시

1. 이 폴더를 GitHub 저장소에 올립니다.
2. 저장소 **Settings → Pages → Build and deployment**에서 Source를 **Deploy from a branch**, 브랜치를 `main`, 폴더를 `/ (root)`로 정합니다.
3. 잠시 뒤 `https://<사용자명>.github.io/<저장소명>/` 에서 열립니다.

`.nojekyll` 파일이 있어 Jekyll 처리 없이 그대로 게시됩니다. 모든 경로가 상대 경로라 저장소 하위 경로에서도 동작합니다.

## 재현성

- 난수 생성기: xoshiro128** (splitmix32로 시드 확장)
- 공마다 위 보드 n₁번 → 아래 보드 n₂번 순서로 난수를 쓰므로, 같은 시드·설정이면 애니메이션과 즉시 계산의 결과가 같습니다.
- 실행 기록에는 시드, 생성기 이름, 사이트 버전이 함께 저장됩니다.

## 외부 의존성

수식 렌더링용 KaTeX만 jsDelivr CDN에서 불러옵니다. 오프라인에서는 수식이 TeX 원문으로 보이고, 나머지 기능은 모두 동작합니다.
