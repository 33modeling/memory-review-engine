# ts-fsrs 분석과 복습 엔진 (REA, 2026-11-26)

## 요약

- 간격 반복 라이브러리 ts-fsrs(open-spaced-repetition/ts-fsrs, MIT)의 FSRS 스케줄러를 REA(`rea-agents` 6.8.0)로 정적 분석했다. 코드는 내려받아 읽기만 했고 `pnpm install`·빌드·실행은 하지 않았다.
- 분석으로 확인한 동작을 바탕으로 암기 랩들이 함께 쓸 엔진을 새로 작성했다. ts-fsrs 코드는 옮기지 않았다. 공식은 공개 위키 "The Algorithm"(FSRS-6 절)의 식을 따랐다.
  1. `src/fsrs.js`: 카드 상태, 평가(다시·어려움·알맞음·쉬움) 뒤 다음 복습일, 오늘 복습할 카드, 예상 기억 유지율·7일 예보. 의존성 없는 ES 모듈.
  2. `src/store.js`: 랩 이름(deck)과 카드 id 목록만 받는 localStorage 저장 어댑터. 저장소를 못 쓰면 메모리로 계속 동작한다.
  3. `demo/`: 카드 6장으로 복습 흐름과 통계를 보여 주는 한국어 데모. `dist/memory-review.js` 한 줄로 붙인다.
- 같은 입력에서 ts-fsrs·fsrs-rs 공개 테스트의 숫자와 결과가 같다(아래 '검증'). 공개 값은 그대로 옮겨 적었고 ts-fsrs 를 실행해서 얻은 값은 없다.

## 분석 대상과 방법

| 항목 | 내용 |
|---|---|
| 대상 | <https://github.com/open-spaced-repetition/ts-fsrs> (MIT, `LICENSE` 확인), commit `c64b9617e61a` (2026-11-25), 패키지 `ts-fsrs` 6.0.1 |
| 고른 이유 | 브라우저에서 바로 돌릴 수 있는 TypeScript FSRS 구현 가운데 기준 구현이다. Anki 의 FSRS 와 같은 가중치·공식을 쓰고, 기대값이 공개 테스트에 들어 있다 |
| 받은 범위 | 저장소 전체 얕은 clone(7.4 MB, 파일 356개). 분석은 `packages/fsrs` 만 |
| 도구 | REA 6.8.0을 `npx -y rea-agents@6.8.0` 으로 그때그때 실행(전역 설치·MCP 설정 없음), Node 22.23.4 |
| 재현 | `docs/rea/scripts/run-rea.sh <작업 폴더>`(명령 전체, 약 25초), 증거 정리는 `docs/rea/scripts/summarize.py` |

### 실행한 REA 명령

| 명령 | 입력 | 결과 | 남긴 파일 |
|---|---|---|---|
| `import-reference-source` | `packages/fsrs` 전체 | 항목 212개(TypeScript 171), import 관계 691개(내부 302·외부 389) | 요약만: `reference-source.summary.json` |
| `analyze-javascript-application` | 스케줄링 파일 12개(`selection.json`) | 파싱 실패 0, AST 노드 6,190. 구조 그래프 424 노드·479 간선, 의미 그래프 3,592 노드·3,085 관계, 함수 지문 71, 모르는 것 3,200. 결과 9.4 MB | 요약만: `app-analysis.summary-view.json`, 파일별 함수: `feature-facts.json` |
| `inspect-analysis-view` ×2 | 위 결과 | summary, modules(참조 목록) | `app-analysis.*-view.json` |
| `trace-application-feature` | 모듈 `src/models/fsrs-6/algorithm.ts`, 양방향 | 시드 5, 노드 424·간선 479(contains 350·imports 92·exposes 37). 시드 주변은 `@/help.js`·`@/error.js`·`srs-kit` import, export `FSRS6Algorithm`·`forgetting_curve`·`computeDecayFactor` | `trace-feature-algorithm.summary.json` |
| `trace-javascript-semantics` ×4 | 함수 지문 `next_interval`·`calculateScheduleDays`·`calculateLearningSteps`·`forgetting_curve` 의 호출자 | 넷 다 호출 관계 0, unknown(dynamic-call) 3~7 (아래 한계) | `trace-semantics-*-callers.json` |

개별 명령 시간은 따로 재지 않았다(스크립트 전체 24초). 큰 결과 3개는 저장소에 넣지 않고 `rea-runs.json` 에 크기·SHA-256 만 적었다.

### REA로 하지 못한 것

- **다른 파일에서 부른 함수**: 의미 추적이 파일 밖 호출을 따라가지 않아 네 함수 모두 호출자가 0개였다(unknown 사유 dynamic-call). `next_interval` 은 `model.ts` 의 `nextInterval` 이, 그것은 `basic_scheduler.ts` 의 `scheduler_next_interval` 이 부른다는 것은 `feature-facts.json` 의 함수 목록과 소스 읽기로 이었다.
- **`@/` 별칭 import**: 분석기 import 간선이 `@/help.js` 같은 별칭을 소스 파일로 잇지 못했다. `import-reference-source` 의 내부 관계(302개)와 `tsconfig` 로 보완했다.
- **모르는 것 3,200개**: incomplete-module 1,908 · ambiguous-target 518 · unknown-value 472 · dynamic-call 280 · dynamic-property 22. 클래스 메서드(`this.model.step(...)`) 호출이 대부분 여기에 들어갔다.
- **수식의 의미**: REA는 구조와 호출 관계만 보인다. 식 자체(안정도 갱신, 망각 곡선 상수)는 위키 공식과 소스를 직접 읽어 맞췄다.
- **실행 관찰 없음**: 라이브러리라 띄울 화면이 없고, 규칙상 실행하지 않았다. 기대값은 공개 테스트 파일의 숫자다.

## ts-fsrs 스케줄러 구조 (REA 결과 기준)

| 파일 | 함수(의미 그래프) | 하는 일 |
|---|---|---|
| `models/fsrs-6/algorithm.ts` | 16 (`init_stability`, `init_difficulty`, `next_interval`, `next_difficulty`, `mean_reversion`, `next_recall_stability`, `next_forget_stability`, `next_short_term_stability`, `next_state` 등) | FSRS-6 공식. 상태 = 안정도·난이도 |
| `models/fsrs-6/model.ts` | 7 (`step`, `nextInterval`, `forgettingCurve`) | 공식을 모델 인터페이스로 감쌈 |
| `legacy/impl/basic_scheduler.ts` | 11 (`newState`, `learningState`, `reviewState`, `applyLearningSteps`, `next_interval`) | 상태별로 네 평가 결과를 미리 계산 |
| `middlewares/learning-steps/core.ts` | 2 (`calculateLearningSteps`, `ConvertStepUnitToMinutes`) | 1m·10m 같은 학습 단계 |
| `middlewares/monotonic-interval/core.ts` | 3 (`calculateScheduleDays`) | 어려움 < 알맞음 < 쉬움 간격 보장 |
| `middlewares/fuzzing/core.ts` | 6 (`getFuzzRange`, `withFuzzing`) | 간격을 조금 흔들어 몰림 방지 |

## 기능 목록

| 기능 | ts-fsrs 방식 | 이 엔진 | 상태 |
|---|---|---|---|
| 기억 상태 | 안정도 S(일), 난이도 D(1~10), 가중치 21개(FSRS-6 기본값) | 같은 공식·기본 가중치 | 구현 |
| 망각 곡선·예상 유지율 | R = (1 + F·t/S)^(-w20), t = S 일 때 0.9 | `forgettingCurve`, `retrievability`, 통계의 평균 유지율·7일 뒤 유지율 | 구현 |
| 목표 유지율 간격 | 위 식을 t 로 풀고 반올림, 1일~최대 간격 | `intervalFromStability`(기본 0.9, 바꿀 수 있음) | 구현 |
| 첫 평가 | S0 = w[G-1], D0 = w4 - e^(w5(G-1)) + 1 | 같음 | 구현 |
| 난이도 갱신 | ΔD = -w6(G-3), 선형 감쇠 (10-D)/9, 쉬움 초깃값으로 평균 회귀 | 같음 | 구현 |
| 기억 성공·잊음 안정도 | 성공은 e^w8·(11-D)·S^-w9·(e^(w10(1-R))-1), 잊음은 w11·D^-w12·((S+1)^w13-1)·e^(w14(1-R)) 와 S/e^(w17w18) 중 작은 값 | 같음 | 구현 |
| 같은 날 다시 본 것 | S·S^-w19·e^(w17(G-3+w18)), 어려움 이상은 줄지 않음 | `enableShortTerm`(기본 켬) | 구현 |
| 학습·재학습 단계 | 1m·10m / 10m, 어려움 = 두 단계 평균, 쉬움은 바로 졸업 | `learningSteps`·`relearningSteps` | 구현 |
| 간격 순서 보장 | 어려움 < 알맞음 < 쉬움, 최대 간격에서 멈춤 | 같음 | 구현 |
| 오늘 복습할 카드 | (라이브러리 밖, 앱이 정함) | `dueCards`: 익히는 중 → 복습(기억 낮은 순) → 새 카드(한도) | 새로 작성 |
| 통계·예보 | (없음) | `stats`: 상태별 수, 오늘 남은 수, 평균 유지율, 7일 예보 | 새로 작성 |
| 저장 | (없음, 앱 몫) | `store.js` localStorage, try/catch, 내보내기·가져오기 | 새로 작성 |
| 간격 흔들기(fuzz) | 2.5일 이상 간격을 5~15% 범위에서 씨앗 난수로 흔듦 | 없음(같은 날 몰림이 문제 될 만큼 카드가 많을 때 추가) | 보류 |
| 가중치 학습 | Rust 바인딩(`packages/binding/src/train.rs`)으로 복습 기록에서 최적화 | 없음. 기본 가중치만 | 보류 |
| 되돌리기·다시 계산 | `rollback`, `reschedule`(기록으로 다시 계산) | 없음. 기록은 `logs()` 에 남김 | 보류 |
| 장기 전용 스케줄러 | `enable_short_term: false` 면 학습 단계 없이 바로 간격 | `enableShortTerm: false` + `learningSteps: []` 로 비슷하게 | 보류 |
| FSRS-3~5·7 모델 | 모델별 폴더 | FSRS-6 만 | 보류 |

## 검증

`test/fsrs.test.js` 에서 아래 공개 숫자와 맞춘다(ts-fsrs 는 실행하지 않음).

| 내용 | 기대값 출처 | 결과 |
|---|---|---|
| 알맞음 6번 → 다시 2번 → 알맞음 5번의 간격 | ts-fsrs `legacy/__tests__/FSRS-6.test.ts` ivl_history `[0,2,11,46,163,498,0,0,2,4,7,12,21]` | 같음 |
| 첫 평가 S·D·간격·상태 | 같은 파일 first repeat | 같음 |
| 다시·알맞음×5(0,0,1,3,8,21일) 뒤 기억 상태 | fsrs-rs `inference.rs` S 53.62691(같은 날 반영)·53.335106(끔), D 6.3574867 | 소수 4자리까지 같음 |
| 쉬움 첫 평가 카드의 복습일 유지율 | 같은 파일 get retrievability 0.9024733 | 같음 |
| R(S, S) = 0.9, 유지율 0.9 간격 = round(S), 0.8 간격은 식으로 계산한 값 | 공식 | 같음 |

시간대(UTC·LA·인도·키리바시)를 바꿔도 테스트가 통과한다.

## 다음 후보

1. 간격 흔들기(fuzz): 같은 날 들어온 카드가 같은 날 몰리지 않게.
2. 기록으로 가중치 맞추기: 복습 기록이 쌓인 랩부터. 브라우저에서 돌릴 수 있는 크기인지 먼저 확인.
3. 랩별 적용: 각 랩 저장소에서 따로 작업(이 저장소에서는 다른 랩을 건드리지 않음).
