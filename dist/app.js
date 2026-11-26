// 데모: 카드 6장을 엔진에 붙여 복습 흐름과 통계를 보여 준다. 시간 이동은 데모에서만 쓴다.
(function () {
  'use strict';
  var MR = window.MemoryReview;
  var CARDS = [
    { id: 'apple', front: 'apple', back: '사과' },
    { id: 'borrow', front: 'borrow', back: '빌리다' },
    { id: 'curious', front: 'curious', back: '궁금한' },
    { id: 'decide', front: 'decide', back: '결정하다' },
    { id: 'early', front: 'early', back: '이른, 일찍' },
    { id: 'forget', front: 'forget', back: '잊다' },
  ];
  var byId = {};
  CARDS.forEach(function (c) { byId[c.id] = c; });

  var OFFSET_KEY = 'memory-review-demo:offset';
  var offset = 0;
  try { offset = Number(localStorage.getItem(OFFSET_KEY)) || 0; } catch (e) { offset = 0; }
  function now() { return Date.now() + offset; }

  var review = MR.attach('demo-words', CARDS.map(function (c) { return c.id; }), { now: now() });
  var current = null;
  var $ = function (id) { return document.getElementById(id); };

  function span(ms) {
    var m = Math.round(ms / 60000);
    if (m < 60) return Math.max(1, m) + '분';
    var h = Math.round(m / 60);
    if (h < 24) return h + '시간';
    var d = Math.round(m / 1440);
    if (d < 31) return d + '일';
    if (d < 365) return (d / 30).toFixed(1).replace('.0', '') + '달';
    return (d / 365).toFixed(1).replace('.0', '') + '년';
  }
  function pct(x) { return x == null ? '–' : Math.round(x * 100) + '%'; }
  function when(ms) {
    var diff = ms - now();
    if (diff <= 0) return '지금';
    return span(diff) + ' 뒤';
  }

  function next() {
    var list = review.due(now(), { newLimit: 6 });
    current = list[0] || null;
    $('back').hidden = true;
    $('grades').hidden = true;
    if (!current) {
      $('card').hidden = true; $('show').hidden = true; $('done').hidden = false;
    } else {
      var c = byId[current.id];
      $('card').hidden = false; $('show').hidden = false; $('done').hidden = true;
      $('front').textContent = c.front;
      $('back').textContent = c.back;
      $('meta').textContent = MR.STATE_LABELS[current.state] + ' · 남은 카드 ' + list.length + '장';
      var t = now();
      var p = review.preview(current.id, t);
      var buttons = $('grades').querySelectorAll('button');
      for (var i = 0; i < buttons.length; i++) {
        var g = Number(buttons[i].getAttribute('data-g'));
        buttons[i].querySelector('span').textContent = span(p[g].due - t);
      }
    }
    render();
  }

  function render() {
    var d = new Date(now());
    $('clock').textContent = (offset ? '데모 시각 ' : '') + (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
    var s = review.stats(now());
    var items = [
      ['오늘 남은 복습', s.dueToday + '장'], ['새 카드', s.new + '장'],
      ['익히는 중', (s.learning + s.relearning) + '장'], ['복습 단계', s.review + '장'],
      ['지금 예상 기억', pct(s.averageRetention)], ['7일 뒤 예상 기억', pct(s.retentionIn7Days)],
    ];
    $('stats').innerHTML = '';
    items.forEach(function (it) {
      var div = document.createElement('div');
      var dt = document.createElement('dt'); dt.textContent = it[0];
      var dd = document.createElement('dd'); dd.textContent = it[1];
      div.appendChild(dt); div.appendChild(dd); $('stats').appendChild(div);
    });
    var max = Math.max.apply(null, s.forecast.concat([1]));
    $('forecast').innerHTML = '';
    s.forecast.forEach(function (n, k) {
      var li = document.createElement('li');
      li.setAttribute('aria-label', (k === 0 ? '오늘' : k + '일 뒤') + ' ' + n + '장');
      var em = document.createElement('em'); em.textContent = n;
      var bar = document.createElement('i'); bar.style.height = Math.round((n / max) * 80) + 'px';
      var lab = document.createElement('span'); lab.textContent = k === 0 ? '오늘' : '+' + k;
      li.appendChild(em); li.appendChild(bar); li.appendChild(lab); $('forecast').appendChild(li);
    });
    var tbody = $('cards').querySelector('tbody');
    tbody.innerHTML = '';
    review.all().forEach(function (c) {
      var tr = document.createElement('tr');
      [byId[c.id].front, MR.STATE_LABELS[c.state], c.state === MR.State.New ? '–' : when(c.due),
        c.state === MR.State.New ? '–' : c.stability.toFixed(1) + '일', c.state === MR.State.New ? '–' : pct(review.retrievability(c.id, now()))]
        .forEach(function (v, i) { var td = document.createElement('td'); td.textContent = v; if (i > 2) td.className = 'num'; tr.appendChild(td); });
      tbody.appendChild(tr);
    });
  }

  $('show').addEventListener('click', function () {
    $('back').hidden = false; $('show').hidden = true; $('grades').hidden = false;
    $('grades').querySelector('.good').focus();
  });
  $('grades').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || !current) return;
    review.grade(current.id, Number(b.getAttribute('data-g')), now());
    next();
  });
  $('skip').addEventListener('click', function () {
    offset += 86400000;
    try { localStorage.setItem(OFFSET_KEY, String(offset)); } catch (e) { /* 저장 못 해도 진행 */ }
    next();
  });
  $('reset').addEventListener('click', function () {
    offset = 0;
    try { localStorage.removeItem(OFFSET_KEY); } catch (e) { /* 무시 */ }
    review.reset(null, now());
    next();
  });
  next();
})();
