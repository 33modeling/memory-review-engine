// dist/ 만들기: 한 파일짜리 스크립트(전역 MemoryReview)·ES 모듈, 그리고 데모 페이지.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const names = [];
const body = ['src/fsrs.js', 'src/store.js']
  .map((f) => readFileSync(join(root, f), 'utf8'))
  .join('\n')
  .split('\n')
  .filter((line) => !/^import .* from '\.\/.*';$/.test(line))
  .map((line) => line.replace(/^export (const|function|let) ([A-Za-z_$][\w$]*)/, (_, kw, name) => { names.push(name); return `${kw} ${name}`; }))
  .join('\n');
if (/^export /m.test(body)) throw new Error('처리하지 못한 export 가 있음');

const banner = `/*! memory-review-engine ${pkg.version} | MIT | FSRS-6 간격 반복 복습 엔진 */`;
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'memory-review.js'), `${banner}\n(function (global) {\n'use strict';\n${body}\nglobal.MemoryReview = Object.freeze({ version: '${pkg.version}', ${names.join(', ')} });\n})(typeof window !== 'undefined' ? window : globalThis);\n`);
writeFileSync(join(dist, 'memory-review.mjs'), `${banner}\n${body}\nexport { ${names.join(', ')} };\n`);
cpSync(join(root, 'demo'), dist, { recursive: true });
console.log(`dist/memory-review.js (${names.length}개 이름), dist/memory-review.mjs, 데모 복사 완료`);
