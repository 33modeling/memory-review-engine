// 빌드한 한 파일 스크립트(dist/memory-review.js)를 브라우저처럼 불러 같은 값을 내는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

test('dist/memory-review.js 가 전역 MemoryReview 를 만든다', () => {
  const url = new URL('../dist/memory-review.js', import.meta.url);
  if (!existsSync(url)) execFileSync(process.execPath, [new URL('../scripts/build.mjs', import.meta.url).pathname]);
  const store = new Map();
  const window = { localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
  window.window = window;
  vm.runInNewContext(readFileSync(url, 'utf8'), { window, globalThis: window, Date, Math, JSON, Map, Set, Object, Array, Number, String, RangeError, Error });
  const MR = window.MemoryReview;
  assert.equal(typeof MR.attach, 'function');
  const review = MR.attach('lab', ['a', 'b'], { now: 0, schedulerOptions: { utcOffsetMinutes: 0 } });
  assert.equal(review.grade('a', 'Easy', 0).scheduledDays, 8);
  assert.ok(store.has('memory-review:lab'));
});
