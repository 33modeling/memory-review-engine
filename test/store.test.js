import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReviewStore, attach } from '../src/store.js';
import { State, Rating } from '../src/fsrs.js';

function fakeStorage() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const T0 = Date.UTC(2025, 0, 1, 0, 0);
const opts = { schedulerOptions: { utcOffsetMinutes: 0 } };

test('id 목록으로 카드를 만들고 평가를 저장·다시 읽는다', () => {
  const storage = fakeStorage();
  const a = createReviewStore({ deck: 'lab', ids: ['w1', 'w2', 'w3'], storage, now: T0, ...opts });
  assert.equal(a.all().length, 3);
  assert.equal(a.due(T0).length, 3);
  const c = a.grade('w1', 'Easy', T0);
  assert.equal(c.state, State.Review);
  assert.equal(c.scheduledDays, 8);
  const b = createReviewStore({ deck: 'lab', ids: ['w1', 'w2', 'w3'], storage, now: T0, ...opts });
  assert.equal(b.get('w1').scheduledDays, 8);
  assert.equal(b.logs().length, 1);
  assert.deepEqual(b.due(T0).map((x) => x.id), ['w2', 'w3']);
  assert.ok(storage.m.has('memory-review:lab'));
});

test('목록에서 빠진 카드는 숨기되 기록은 남기고, 새 id 는 추가한다', () => {
  const storage = fakeStorage();
  const a = createReviewStore({ deck: 'lab', ids: ['a', 'b'], storage, now: T0, ...opts });
  a.grade('a', Rating.Good, T0);
  assert.equal(a.sync(['b', 'c'], T0), 1);
  assert.deepEqual(a.all().map((x) => x.id), ['b', 'c']);
  a.sync(['a', 'b', 'c'], T0);
  assert.equal(a.get('a').reps, 1);
});

test('저장소가 망가져도(예외·깨진 JSON) 메모리로 계속 동작한다', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() {} };
  const a = createReviewStore({ deck: 'x', ids: ['a'], storage: broken, now: T0, ...opts });
  assert.equal(a.grade('a', 3, T0).reps, 1);
  const bad = fakeStorage();
  bad.setItem('memory-review:x', '{not json');
  const b = createReviewStore({ deck: 'x', ids: ['a'], storage: bad, now: T0, ...opts });
  assert.equal(b.get('a').state, State.New);
});

test('localStorage 가 없는 환경에서는 메모리 저장소를 쓴다', () => {
  const a = attach('nolocal', ['q'], { now: T0, ...opts });
  assert.equal(a.get('q').state, State.New);
});

test('통계·초기화·내보내기/가져오기', () => {
  const storage = fakeStorage();
  const a = createReviewStore({ deck: 'lab', ids: ['a', 'b'], storage, now: T0, ...opts });
  a.grade('a', 'Easy', T0);
  const s = a.stats(T0 + 86400000);
  assert.equal(s.review, 1);
  assert.equal(s.new, 1);
  assert.ok(s.averageRetention > 0.98);
  const dump = a.export();
  a.reset('a', T0);
  assert.equal(a.get('a').state, State.New);
  a.import(dump);
  assert.equal(a.get('a').state, State.Review);
  assert.throws(() => a.import('{"v":99}'));
  let calls = 0;
  const off = a.subscribe(() => calls++);
  a.grade('b', 'Good', T0);
  off();
  a.grade('b', 'Good', T0 + 600000);
  assert.equal(calls, 1);
  a.reset(null, T0);
  assert.equal(a.stats(T0).new, 2);
  assert.equal(a.logs().length, 0);
});
