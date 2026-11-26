/*! memory-review-engine 0.1.0 | MIT | FSRS-6 간격 반복 복습 엔진 */
// 간격 반복 복습 엔진 (FSRS-6 공식, 의존성 없음).
// 공식 출처: open-spaced-repetition 위키 "The Algorithm" FSRS-6 절.
// 기억 상태 = 안정도 S(일), 난이도 D(1~10). 떠올릴 확률 R 은 마지막 복습 뒤 지난 날수 t 로 계산한다.

const Rating = Object.freeze({ Again: 1, Hard: 2, Good: 3, Easy: 4 });
const State = Object.freeze({ New: 0, Learning: 1, Review: 2, Relearning: 3 });
const RATING_LABELS = Object.freeze({ 1: '다시', 2: '어려움', 3: '알맞음', 4: '쉬움' });
const STATE_LABELS = Object.freeze({ 0: '새 카드', 1: '익히는 중', 2: '복습', 3: '다시 익히는 중' });

// FSRS-6 기본 가중치 w0~w20 (공개 기본값)
const DEFAULT_WEIGHTS = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
  1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
]);

const DEFAULT_OPTIONS = Object.freeze({
  weights: DEFAULT_WEIGHTS,
  requestRetention: 0.9, // 목표 유지율: 복습 날에 떠올릴 확률
  maximumInterval: 36500, // 일
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
  enableShortTerm: true, // 같은 날 다시 본 것도 안정도에 반영
  learnAheadMinutes: 20,
  utcOffsetMinutes: null, // null 이면 기기 시간대로 날짜를 나눔
});

const S_MIN = 0.001;
const S_MAX = 36500;
const DAY_MS = 86400000;
const MIN_MS = 60000;

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
const round8 = (x) => Math.round(x * 1e8) / 1e8;

// ── 공식 ─────────────────────────────────────────────

// 망각 곡선 R(t, S) = (1 + F·t/S)^(-w20), F = 0.9^(-1/w20) - 1 → R(S, S) = 0.9
function forgettingFactor(w) {
  return Math.pow(0.9, -1 / w[20]) - 1;
}

function forgettingCurve(w, elapsedDays, stability) {
  if (!(stability > 0)) return 0;
  return Math.pow(1 + (forgettingFactor(w) * Math.max(0, elapsedDays)) / stability, -w[20]);
}

// R 을 목표 유지율로 두고 t 를 푼 것: I = S/F · (r^(-1/w20) - 1)
function intervalFromStability(w, stability, requestRetention, maximumInterval = S_MAX) {
  if (!(requestRetention > 0 && requestRetention <= 1)) throw new RangeError('목표 유지율은 0 보다 크고 1 이하');
  const raw = (stability / forgettingFactor(w)) * (Math.pow(requestRetention, -1 / w[20]) - 1);
  return clamp(Math.round(raw), 1, maximumInterval);
}

const initStability = (w, g) => clamp(w[g - 1], S_MIN, S_MAX);
// D0(G) = w4 - e^(w5·(G-1)) + 1
const rawInitDifficulty = (w, g) => w[4] - Math.exp(w[5] * (g - 1)) + 1;
const initDifficulty = (w, g) => clamp(rawInitDifficulty(w, g), 1, 10);

// ΔD = -w6·(G-3), 선형 감쇠 ΔD·(10-D)/9, 쉬움 초깃값 쪽으로 w7 만큼 평균 회귀
function nextDifficulty(w, d, g) {
  const delta = -w[6] * (g - 3);
  const damped = d + (delta * (10 - d)) / 9;
  const reverted = w[7] * rawInitDifficulty(w, Rating.Easy) + (1 - w[7]) * damped;
  return clamp(reverted, 1, 10);
}

// 기억해 냈을 때: S' = S·(1 + e^w8 · (11-D) · S^(-w9) · (e^(w10·(1-R)) - 1) · 어려움벌점 · 쉬움보너스)
function nextRecallStability(w, d, s, r, g) {
  const hard = g === Rating.Hard ? w[15] : 1;
  const easy = g === Rating.Easy ? w[16] : 1;
  const inc = Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1) * hard * easy;
  return clamp(s * (1 + inc), S_MIN, S_MAX);
}

// 잊었을 때: S_f = w11 · D^(-w12) · ((S+1)^w13 - 1) · e^(w14·(1-R)), 단 S/e^(w17·w18) 보다 크지 않게
function nextForgetStability(w, d, s, r, enableShortTerm = true) {
  const sf = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r));
  const cap = enableShortTerm ? s / Math.exp(w[17] * w[18]) : s;
  return clamp(Math.min(sf, Math.max(cap, S_MIN)), S_MIN, S_MAX);
}

// 같은 날 다시 볼 때: S' = S · S^(-w19) · e^(w17·(G-3+w18)), 어려움 이상은 줄지 않음
function nextShortTermStability(w, s, g) {
  let inc = Math.pow(s, -w[19]) * Math.exp(w[17] * (g - 3 + w[18]));
  if (g >= Rating.Hard) inc = Math.max(inc, 1);
  return clamp(s * inc, S_MIN, S_MAX);
}

// 기억 상태 한 걸음. memory 가 없으면 첫 평가.
function stepMemory(w, memory, elapsedDays, g, { enableShortTerm = true, retrievability } = {}) {
  if (!(g >= 1 && g <= 4)) throw new RangeError(`평가는 1~4: ${g}`);
  if (!memory || (!memory.stability && !memory.difficulty)) {
    return { stability: round8(initStability(w, g)), difficulty: round8(initDifficulty(w, g)) };
  }
  const { stability: s, difficulty: d } = memory;
  const r = retrievability ?? forgettingCurve(w, elapsedDays, s);
  let ns;
  if (elapsedDays === 0 && enableShortTerm) ns = nextShortTermStability(w, s, g);
  else if (g === Rating.Again) ns = nextForgetStability(w, d, s, r, enableShortTerm);
  else ns = nextRecallStability(w, d, s, r, g);
  return { stability: round8(ns), difficulty: round8(nextDifficulty(w, d, g)) };
}

// ── 날짜 ─────────────────────────────────────────────

const toMs = (t) => (t == null ? Date.now() : t instanceof Date ? t.getTime() : typeof t === 'string' ? Date.parse(t) : Number(t));

function dayNumber(ms, utcOffsetMinutes) {
  const off = utcOffsetMinutes == null ? -new Date(ms).getTimezoneOffset() : utcOffsetMinutes;
  return Math.floor((ms + off * MIN_MS) / DAY_MS);
}

function elapsedDays(fromMs, toMsValue, utcOffsetMinutes = null) {
  return Math.max(0, dayNumber(toMsValue, utcOffsetMinutes) - dayNumber(fromMs, utcOffsetMinutes));
}

function endOfDay(ms, utcOffsetMinutes = null) {
  const off = utcOffsetMinutes == null ? -new Date(ms).getTimezoneOffset() : utcOffsetMinutes;
  return (dayNumber(ms, utcOffsetMinutes) + 1) * DAY_MS - off * MIN_MS - 1;
}

function stepToMinutes(step) {
  if (typeof step === 'number') return step;
  const m = /^(\d+(?:\.\d+)?)([mhd])$/.exec(String(step).trim());
  if (!m) throw new RangeError(`단계 형식은 10m·1h·1d: ${step}`);
  return Number(m[1]) * { m: 1, h: 60, d: 1440 }[m[2]];
}

// 익히는 단계: 다시=첫 단계, 어려움=첫 두 단계 평균(하나면 1.5배), 알맞음=다음 단계, 쉬움·마지막 단계 넘김=졸업
function learningStepMinutes(steps, state, step, g) {
  if (!steps.length || step >= steps.length) return null;
  if (state === State.Review) return g === Rating.Again ? { minutes: stepToMinutes(steps[step]), next: 0 } : null;
  const first = stepToMinutes(steps[0]);
  const second = steps.length > 1 ? stepToMinutes(steps[1]) : null;
  if (g === Rating.Again) return { minutes: first, next: 0 };
  if (g === Rating.Hard) return { minutes: second == null ? first * 1.5 : (first + second) / 2, next: step };
  if (g === Rating.Good && step + 1 < steps.length) return { minutes: stepToMinutes(steps[step + 1]), next: step + 1 };
  return null;
}

// ── 스케줄러 ─────────────────────────────────────────

function createCard(id, now) {
  const t = toMs(now);
  return { id: String(id), state: State.New, due: t, stability: 0, difficulty: 0, step: 0, reps: 0, lapses: 0, lastReview: null, scheduledDays: 0 };
}

function createScheduler(options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const w = Array.from(o.weights);
  if (w.length !== 21) throw new RangeError('가중치는 21개(FSRS-6)');
  const stepsFor = (state) => (state === State.New || state === State.Learning ? o.learningSteps : o.relearningSteps);
  const interval = (s) => intervalFromStability(w, s, o.requestRetention, o.maximumInterval);

  function retrievability(card, now) {
    if (!card || card.state === State.New || card.lastReview == null) return 0;
    return forgettingCurve(w, elapsedDays(card.lastReview, toMs(now), o.utcOffsetMinutes), card.stability);
  }

  // 네 가지 평가 결과를 한꺼번에 계산(카드는 바꾸지 않음)
  function preview(card, now) {
    const t = toMs(now);
    const days = card.state === State.New || card.lastReview == null ? 0 : elapsedDays(card.lastReview, t, o.utcOffsetMinutes);
    const memory = card.state === State.New ? null : { stability: card.stability, difficulty: card.difficulty };
    const r = memory ? forgettingCurve(w, days, memory.stability) : 0;
    const out = {};
    for (const g of [1, 2, 3, 4]) {
      const m = stepMemory(w, memory, days, g, { enableShortTerm: o.enableShortTerm, retrievability: card.state === State.Review ? r : undefined });
      out[g] = { ...card, ...m, reps: card.reps + 1, lastReview: t };
    }
    const place = (next, g, learnState) => {
      const ls = learningStepMinutes(stepsFor(card.state), card.state, card.step || 0, g);
      if (ls && ls.minutes > 0 && ls.minutes < 1440) {
        Object.assign(next, { state: learnState, step: ls.next, scheduledDays: 0, due: t + Math.round(ls.minutes * 60) * 1000 });
      } else if (ls && ls.minutes >= 1440) {
        Object.assign(next, { state: State.Review, step: ls.next, scheduledDays: Math.floor(ls.minutes / 1440), due: t + Math.round(ls.minutes * 60) * 1000 });
      } else {
        const d = interval(next.stability);
        Object.assign(next, { state: State.Review, step: 0, scheduledDays: d, due: t + d * DAY_MS });
      }
    };
    if (card.state === State.Review) {
      // 어려움 ≤ 알맞음 ≤ 쉬움 이 되도록 하루씩 벌림
      const hard = Math.min(interval(out[2].stability), o.maximumInterval);
      const good = Math.min(Math.max(interval(out[3].stability), hard + 1), o.maximumInterval);
      const easy = Math.min(Math.max(interval(out[4].stability), good + 1), o.maximumInterval);
      [[2, hard], [3, good], [4, easy]].forEach(([g, d]) => Object.assign(out[g], { state: State.Review, step: 0, scheduledDays: d, due: t + d * DAY_MS }));
      place(out[1], Rating.Again, State.Relearning);
      out[1].lapses = card.lapses + 1;
    } else {
      const learnState = card.state === State.New ? State.Learning : card.state;
      for (const g of [1, 2, 3, 4]) place(out[g], g, learnState);
    }
    for (const g of [1, 2, 3, 4]) out[g].log = { rating: g, at: t, state: card.state, elapsedDays: days, retrievability: r, scheduledDays: out[g].scheduledDays };
    return out;
  }

  function review(card, rating, now) {
    const g = typeof rating === 'string' ? Rating[rating] : rating;
    if (!(g >= 1 && g <= 4)) throw new RangeError(`평가는 Again·Hard·Good·Easy 또는 1~4: ${rating}`);
    const { log, ...next } = preview(card, now)[g];
    return { card: next, log };
  }

  // 오늘 복습할 카드: 익히는 중(지금+learnAhead 안), 복습 카드(오늘 안), 새 카드(newLimit 장까지)
  function dueCards(cards, now, { newLimit = 20, reviewLimit = Infinity } = {}) {
    const t = toMs(now);
    const eod = endOfDay(t, o.utcOffsetMinutes);
    const learning = [], reviews = [], fresh = [];
    for (const c of cards) {
      if (c.state === State.New) fresh.push(c);
      else if (c.state === State.Review) { if (c.due <= eod) reviews.push(c); }
      else if (c.due <= t + o.learnAheadMinutes * MIN_MS) learning.push(c);
    }
    learning.sort((a, b) => a.due - b.due);
    reviews.sort((a, b) => retrievability(a, t) - retrievability(b, t) || a.due - b.due);
    return [...learning, ...reviews.slice(0, reviewLimit), ...fresh.slice(0, Math.max(0, newLimit))];
  }

  // 통계: 상태별 수, 오늘 할 것, 평균 예상 유지율(오늘·N일 뒤), 앞으로 7일 복습 예보
  function stats(cards, now, { forecastDays = 7 } = {}) {
    const t = toMs(now);
    const by = { new: 0, learning: 0, review: 0, relearning: 0 };
    const names = ['new', 'learning', 'review', 'relearning'];
    let sumR = 0, sumR7 = 0, seen = 0, lapses = 0, reps = 0;
    const forecast = Array.from({ length: forecastDays }, () => 0);
    const today = dayNumber(t, o.utcOffsetMinutes);
    for (const c of cards) {
      by[names[c.state]]++;
      reps += c.reps || 0; lapses += c.lapses || 0;
      if (c.state === State.New) continue;
      seen++;
      sumR += retrievability(c, t);
      sumR7 += retrievability(c, t + 7 * DAY_MS);
      const k = Math.max(0, dayNumber(c.due, o.utcOffsetMinutes) - today);
      if (k < forecastDays) forecast[k]++;
    }
    return {
      total: cards.length, ...by, seen, reps, lapses,
      dueToday: dueCards(cards, t, { newLimit: 0 }).length,
      averageRetention: seen ? sumR / seen : null,
      retentionIn7Days: seen ? sumR7 / seen : null,
      forecast,
    };
  }

  return { options: Object.freeze({ ...o, weights: w }), weights: w, nextInterval: interval, retrievability, preview, review, dueCards, stats, createCard };
}

// localStorage 저장 어댑터. 저장소를 못 쓰면(사생활 보호 창 등) 메모리에만 두고 계속 동작한다.

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
function createReviewStore({ deck = 'default', ids = [], storage, scheduler, schedulerOptions, keepLogs = 200, now } = {}) {
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
const attach = (deck, ids, options = {}) => createReviewStore({ ...options, deck, ids });

export { Rating, State, RATING_LABELS, STATE_LABELS, DEFAULT_WEIGHTS, DEFAULT_OPTIONS, forgettingFactor, forgettingCurve, intervalFromStability, initStability, initDifficulty, nextDifficulty, nextRecallStability, nextForgetStability, nextShortTermStability, stepMemory, toMs, elapsedDays, endOfDay, stepToMinutes, createCard, createScheduler, createReviewStore, attach };
