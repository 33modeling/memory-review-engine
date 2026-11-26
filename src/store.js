// localStorage 저장 어댑터. 저장소를 못 쓰면(사생활 보호 창 등) 메모리에만 두고 계속 동작한다.
import { createScheduler, createCard, toMs, State } from './fsrs.js';

const VERSION = 1;

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function pickStorage(storage) {
  if (storage) return storage;
  try {
    const s = globalThis.localStorage;
    if (!s) return memoryStorage();
    const probe = '__memory_review_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return memoryStorage();
  }
}

// deck: 랩마다 다른 이름(예: 'opic-words'). ids: 그 랩의 카드 id 목록.
export function createReviewStore({ deck = 'default', ids = [], storage, scheduler, schedulerOptions, keepLogs = 200, now } = {}) {
  const key = `memory-review:${deck}`;
  const store = pickStorage(storage);
  const fsrs = scheduler || createScheduler(schedulerOptions);
  let data = load();
  const listeners = new Set();

  function load() {
    try {
      const raw = store.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && parsed.v === VERSION && parsed.cards && typeof parsed.cards === 'object') return { v: VERSION, cards: parsed.cards, logs: Array.isArray(parsed.logs) ? parsed.logs : [] };
    } catch { /* 깨진 값은 새로 시작 */ }
    return { v: VERSION, cards: {}, logs: [] };
  }
  function save() {
    try { store.setItem(key, JSON.stringify(data)); } catch { /* 용량 초과 등: 메모리 값은 유지 */ }
    listeners.forEach((fn) => { try { fn(api); } catch { /* 구독자 오류 무시 */ } });
  }

  // id 목록에 맞추기: 없는 카드는 새로 만들고, 목록에서 빠진 카드는 기록을 지우지 않고 숨긴다.
  let active = new Set();
  function sync(list, at) {
    const t = toMs(at);
    active = new Set(list.map(String));
    let added = 0;
    for (const id of active) if (!data.cards[id]) { data.cards[id] = createCard(id, t); added++; }
    if (added) save();
    return added;
  }

  const all = () => [...active].map((id) => data.cards[id]).filter(Boolean);

  const api = {
    deck, key, scheduler: fsrs,
    sync,
    get: (id) => data.cards[String(id)] || null,
    all,
    due: (at, opts) => fsrs.dueCards(all(), toMs(at), opts),
    preview: (id, at) => fsrs.preview(api.get(id), toMs(at)),
    grade(id, rating, at) {
      const card = api.get(id);
      if (!card) throw new Error(`없는 카드: ${id}`);
      const { card: next, log } = fsrs.review(card, rating, toMs(at));
      data.cards[next.id] = next;
      data.logs.push({ id: next.id, ...log });
      if (data.logs.length > keepLogs) data.logs.splice(0, data.logs.length - keepLogs);
      save();
      return next;
    },
    retrievability: (id, at) => fsrs.retrievability(api.get(id), toMs(at)),
    stats: (at, opts) => fsrs.stats(all(), toMs(at), opts),
    logs: () => data.logs.slice(),
    reset(id, at) {
      if (id == null) { data = { v: VERSION, cards: {}, logs: [] }; sync([...active], at); save(); return; }
      if (data.cards[id]) { data.cards[id] = createCard(id, toMs(at)); save(); }
    },
    export: () => JSON.stringify(data),
    import(json) {
      const parsed = typeof json === 'string' ? JSON.parse(json) : json;
      if (!parsed || parsed.v !== VERSION || typeof parsed.cards !== 'object') throw new Error('모르는 형식');
      data = { v: VERSION, cards: parsed.cards, logs: Array.isArray(parsed.logs) ? parsed.logs : [] };
      save();
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    isNew: (id) => (api.get(id)?.state ?? State.New) === State.New,
  };
  sync(ids, now);
  return api;
}

// 기존 랩에 붙일 때 쓰는 짧은 이름
export const attach = (deck, ids, options = {}) => createReviewStore({ ...options, deck, ids });
