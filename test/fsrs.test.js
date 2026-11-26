// 기대값 출처
// - ts-fsrs(MIT) 공개 테스트 packages/fsrs/src/legacy/__tests__/FSRS-6.test.ts 의 숫자(ivl_history, first repeat, retrievability)
// - fsrs-rs 공개 테스트 src/inference.rs 의 기억 상태(53.62691 / 53.335106, 6.3574867)
// ts-fsrs 는 실행하지 않았다. 숫자만 옮겨 와 이 엔진 결과와 맞춰 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createScheduler, createCard, stepMemory, forgettingCurve, intervalFromStability, nextDifficulty,
  initDifficulty, DEFAULT_WEIGHTS as w, Rating, State, elapsedDays, stepToMinutes,
} from '../src/fsrs.js';

const UTC = { utcOffsetMinutes: 0 };
const T0 = Date.UTC(2022, 11, 29, 3, 30); // 2022-12-29 12:30 KST
const DAY = 86400000;
const close = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('ts-fsrs 와 같은 평가 순서에서 다음 간격이 같다 (ivl_history)', () => {
  const f = createScheduler(UTC);
  let card = createCard('x', T0);
  let now = T0;
  const got = [];
  for (const g of [3, 3, 3, 3, 3, 3, 1, 1, 3, 3, 3, 3, 3]) {
    card = f.review(card, g, now).card;
    got.push(card.scheduledDays);
    now = card.due;
  }
  assert.deepEqual(got, [0, 2, 11, 46, 163, 498, 0, 0, 2, 4, 7, 12, 21]);
});

test('첫 평가: 안정도·난이도·간격·상태', () => {
  const f = createScheduler(UTC);
  const p = f.preview(createCard('x', T0), T0);
  assert.deepEqual([1, 2, 3, 4].map((g) => p[g].stability), [0.212, 1.2931, 2.3065, 8.2956]);
  assert.deepEqual([1, 2, 3, 4].map((g) => p[g].difficulty), [6.4133, 5.11217071, 2.11810397, 1]);
  assert.deepEqual([1, 2, 3, 4].map((g) => p[g].scheduledDays), [0, 0, 0, 8]);
  assert.deepEqual([1, 2, 3, 4].map((g) => p[g].state), [State.Learning, State.Learning, State.Learning, State.Review]);
  // 학습 단계 1m·10m: 다시 1분, 어려움 5.5분, 알맞음 10분
  assert.deepEqual([1, 2, 3].map((g) => (p[g].due - T0) / 60000), [1, 5.5, 10]);
});

test('fsrs-rs 기억 상태: 같은 날 반영(short-term) 켬·끔', () => {
  const ratings = [1, 3, 3, 3, 3, 3];
  const days = [0, 0, 1, 3, 8, 21];
  for (const [enableShortTerm, s] of [[true, 53.62691], [false, 53.335106]]) {
    let m = null;
    ratings.forEach((g, i) => { m = stepMemory(w, m, days[i], g, { enableShortTerm }); });
    close(m.stability, s);
    close(m.difficulty, 6.3574867);
  }
});

test('예상 유지율: 쉬움 첫 평가 카드의 복습일 R = 0.9024733', () => {
  const f = createScheduler(UTC);
  const easy = f.review(createCard('x', T0), Rating.Easy, T0).card;
  close(f.retrievability(easy, easy.due), 0.9024733, 1e-7);
  assert.equal(f.retrievability(createCard('y', T0), T0), 0);
});

test('공식: t = S 일 때 R = 0.9, 목표 유지율 0.9 의 간격 = round(S)', () => {
  for (const s of [0.5, 2.3065, 8.2956, 37.4, 300]) {
    close(forgettingCurve(w, s, s), 0.9, 1e-12);
    assert.equal(intervalFromStability(w, s, 0.9), Math.max(1, Math.round(s)));
  }
  // 목표 유지율을 올리면 간격이 짧아진다
  assert.ok(intervalFromStability(w, 100, 0.95) < intervalFromStability(w, 100, 0.9));
  assert.ok(intervalFromStability(w, 100, 0.8) > intervalFromStability(w, 100, 0.9));
  // 직접 푼 값: S=100, r=0.8 → 100/F·(0.8^(-1/w20)-1)
  const F = Math.pow(0.9, -1 / w[20]) - 1;
  assert.equal(intervalFromStability(w, 100, 0.8), Math.round((100 / F) * (Math.pow(0.8, -1 / w[20]) - 1)));
  assert.throws(() => intervalFromStability(w, 1, 0));
});

test('난이도: 1~10 안, 다시는 오르고 쉬움은 내린다', () => {
  const d = initDifficulty(w, Rating.Good);
  assert.ok(nextDifficulty(w, d, Rating.Again) > d);
  assert.ok(nextDifficulty(w, d, Rating.Easy) < d);
  const top = nextDifficulty(w, 10, Rating.Again);
  assert.ok(top <= 10 && top > 9.9); // 평균 회귀(w7)로 10 에서 아주 조금 내려온다
  assert.ok(nextDifficulty(w, 1, Rating.Easy) >= 1);
});

test('복습 단계에서 어려움 < 알맞음 < 쉬움, 다시는 잊음 횟수 +1', () => {
  const f = createScheduler(UTC);
  let c = f.review(createCard('x', T0), Rating.Good, T0).card;
  c = f.review(c, Rating.Good, c.due).card;
  assert.equal(c.state, State.Review);
  const t = c.due;
  const p = f.preview(c, t);
  assert.ok(p[2].scheduledDays < p[3].scheduledDays && p[3].scheduledDays < p[4].scheduledDays);
  assert.equal(p[1].state, State.Relearning);
  assert.equal(p[1].lapses, c.lapses + 1);
  assert.equal(p[1].due - t, 10 * 60000);
  assert.equal(p[3].due - t, p[3].scheduledDays * DAY);
});

test('최대 간격을 넘지 않는다', () => {
  const f = createScheduler({ ...UTC, maximumInterval: 30 });
  let c = createCard('x', T0);
  let now = T0;
  for (let i = 0; i < 10; i++) { c = f.review(c, Rating.Easy, now).card; now = c.due; }
  assert.equal(c.scheduledDays, 30);
});

test('오늘 복습할 카드: 익히는 중 → 복습(기억 낮은 순) → 새 카드(한도까지)', () => {
  const f = createScheduler(UTC);
  const fresh = [1, 2, 3].map((i) => createCard('n' + i, T0));
  const learning = f.review(createCard('l', T0), Rating.Again, T0).card; // 1분 뒤
  const r1 = { ...f.review(createCard('r1', T0 - 10 * DAY), Rating.Easy, T0 - 10 * DAY).card }; // 2일 지남
  const r2 = { ...f.review(createCard('r2', T0 - 8 * DAY), Rating.Easy, T0 - 8 * DAY).card };   // 오늘
  const later = f.review(createCard('z', T0), Rating.Easy, T0).card; // 8일 뒤
  const list = f.dueCards([...fresh, later, r2, learning, r1], T0 + 60000, { newLimit: 2 });
  assert.deepEqual(list.map((c) => c.id), ['l', 'r1', 'r2', 'n1', 'n2']);
  const s = f.stats([...fresh, later, r2, learning, r1], T0 + 60000);
  assert.equal(s.total, 7);
  assert.equal(s.new, 3);
  assert.equal(s.dueToday, 3);
  assert.ok(s.averageRetention > 0.8 && s.averageRetention <= 1);
  assert.ok(s.retentionIn7Days < s.averageRetention);
  assert.equal(s.forecast.length, 7);
});

test('날짜 나누기와 단계 형식', () => {
  assert.equal(elapsedDays(Date.UTC(2024, 0, 1, 23, 0), Date.UTC(2024, 0, 2, 1, 0), 0), 1);
  // KST(+540분): UTC 14:00(KST 23:00) → 16:00(KST 다음 날 01:00) 은 하루, UTC 16:00 → 23:00 은 같은 날
  assert.equal(elapsedDays(Date.UTC(2024, 0, 1, 14, 0), Date.UTC(2024, 0, 1, 16, 0), 540), 1);
  assert.equal(elapsedDays(Date.UTC(2024, 0, 1, 16, 0), Date.UTC(2024, 0, 1, 23, 0), 540), 0);
  assert.deepEqual(['1m', '10m', '1h', '1.5d'].map(stepToMinutes), [1, 10, 60, 2160]);
  assert.throws(() => stepToMinutes('10s'));
  assert.throws(() => createScheduler().review(createCard('x'), 5));
});
