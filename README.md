# memory-review-engine

암기 랩들이 함께 쓰는 간격 반복 복습 엔진입니다. FSRS-6 공식(안정도·난이도·떠올릴 확률, 평가 4단계, 목표 유지율)을 의존성 없이 구현했습니다.

- `src/fsrs.js`: 카드 상태, 평가 뒤 다음 복습일, 오늘 복습할 카드, 예상 기억 유지율·7일 예보
- `src/store.js`: localStorage 저장(못 쓰면 메모리로 동작)
- `demo/`: 카드 6장 데모(복습 흐름·통계)
- 분석 기록: `docs/rea/ts-fsrs-analysis.md` (ts-fsrs, MIT. 코드는 옮기지 않고 공식으로 새로 작성)

## 기존 랩에 붙이기

`dist/memory-review.js` 를 랩에 복사하고, 스크립트 한 줄과 카드 id 목록을 넘깁니다.

```html
<script src="memory-review.js"></script>
<script>
  const review = MemoryReview.attach('opic-words', cards.map((c) => c.id)); // 랩 이름, 카드 id 목록
  const today = review.due();              // 오늘 볼 카드 [{ id, state, due, ... }]
  review.grade(today[0].id, 'Good');       // 'Again' | 'Hard' | 'Good' | 'Easy' (또는 1~4)
  review.preview(id)[3].due;               // 평가별 다음 복습 시각(단추에 '10분', '2일' 표시용)
  review.stats();                          // { dueToday, new, review, averageRetention, retentionIn7Days, forecast }
</script>
```

- 기록은 `localStorage` 의 `memory-review:<랩 이름>` 한 곳에 둡니다. 랩마다 이름을 다르게 주세요.
- 카드 id 목록이 바뀌면 새 id 는 새 카드가 되고, 빠진 id 는 기록을 지우지 않고 숨깁니다.
- 번들러를 쓰는 랩은 `import { attach } from 'memory-review-engine/src/index.js'` 로도 됩니다.
- 설정: `attach(deck, ids, { schedulerOptions: { requestRetention: 0.9, learningSteps: ['1m', '10m'], maximumInterval: 36500 } })`

## 명령

```bash
npm test         # node --test (공개 기대값 비교 포함)
npm run build    # dist/memory-review.js(전역), dist/memory-review.mjs, 데모
npm run dev      # 빌드 후 http://localhost:4321 에서 데모
```

MIT
