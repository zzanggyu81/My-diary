/* app.js — 화면과 동작
   화면: 목록 / 달력 / 검색 / 설정 + 일기 보기 + 일기 쓰기 + 잠금 */
(function () {
  'use strict';

  // ── 작은 도구들 ─────────────────────────────
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  var MOODS = [
    { key: '😊', label: '기쁨' }, { key: '🙂', label: '좋음' }, { key: '😌', label: '평온' },
    { key: '😐', label: '보통' }, { key: '😔', label: '슬픔' }, { key: '😤', label: '화남' },
    { key: '😴', label: '피곤' }, { key: '🤒', label: '아픔' }
  ];
  var MAX_PHOTOS = 20;
  var MAX_VIDEOS = 2;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function parseDate(s) {
    var p = String(s || '').split('-');
    return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1);
  }
  function dateLabel(s) {
    var d = parseDate(s);
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WEEK[d.getDay()] + ')';
  }
  function monthLabel(s) {
    var p = String(s || '').split('-');
    return (+p[0]) + '년 ' + (+p[1]) + '월';
  }
  function relTime(ts) {
    if (!ts) return '';
    var diff = Date.now() - ts;
    var m = Math.floor(diff / 60000);
    if (m < 1) return '방금';
    if (m < 60) return m + '분 전';
    var h = Math.floor(m / 60);
    if (h < 24) return h + '시간 전';
    var d = Math.floor(h / 24);
    if (d < 30) return d + '일 전';
    var dt = new Date(ts);
    return (dt.getMonth() + 1) + '월 ' + dt.getDate() + '일';
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  // ── 상태 ────────────────────────────────────
  var state = {
    entries: [],
    mediaIndex: {},
    view: 'list',
    cal: { y: new Date().getFullYear(), m: new Date().getMonth() },
    selectedDate: todayStr(),
    query: '',
    tagFilter: null,
    editing: null,
    unlocked: false,
    lock: null,
    busy: false
  };

  var urlCache = {};
  function blobUrl(id, blob) {
    if (urlCache[id]) return urlCache[id];
    var u = URL.createObjectURL(blob);
    urlCache[id] = u;
    return u;
  }
  function revokeByPrefix(prefix) {
    Object.keys(urlCache).forEach(function (k) {
      if (k.indexOf(prefix) === 0) {
        URL.revokeObjectURL(urlCache[k]);
        delete urlCache[k];
      }
    });
  }

  // ── 레이어(뒤로가기 처리) ────────────────────
  var layers = [];
  var historyPushed = false;
  var ignorePop = false;

  function pushLayer(node, onClose, guard) {
    node.hidden = false;
    layers.push({ el: node, onClose: onClose, guard: guard });
    if (!historyPushed) {
      historyPushed = true;
      try { history.pushState({ app: 1 }, ''); } catch (e) {}
    }
  }
  function closeLayer() {
    var l = layers.pop();
    if (!l) return;
    l.el.hidden = true;
    if (l.onClose) { try { l.onClose(); } catch (e) {} }
    if (!layers.length && historyPushed) {
      historyPushed = false;
      ignorePop = true;
      try { history.back(); } catch (e) {}
    }
  }
  window.addEventListener('popstate', function () {
    if (ignorePop) { ignorePop = false; return; }
    var top = layers[layers.length - 1];
    if (top && top.guard && top.guard() === false) {
      // 뒤로가기를 막고, 저장할지 물어보는 동안 기록을 다시 쌓아 둔다
      historyPushed = true;
      try { history.pushState({ app: 1 }, ''); } catch (e) {}
      return;
    }
    while (layers.length) {
      var l = layers.pop();
      l.el.hidden = true;
      if (l.onClose) { try { l.onClose(); } catch (e) {} }
    }
    historyPushed = false;
  });

  // ── 토스트 ──────────────────────────────────
  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 2200);
  }

  // ── 다이얼로그 ──────────────────────────────
  function dialog(opts) {
    return new Promise(function (resolve) {
      var wrap = $('#dialogWrap');
      $('#dialogTitle').textContent = opts.title || '';
      var textEl = $('#dialogText');
      textEl.textContent = opts.text || '';
      textEl.hidden = !opts.text;
      var actions = $('#dialogActions');
      actions.innerHTML = '';
      var buttons = opts.buttons || [{ label: '확인', value: true, primary: true }];
      var cancelValue = opts.cancelValue !== undefined ? opts.cancelValue : null;
      buttons.forEach(function (b) {
        var btn = el('button', (b.primary ? 'primary ' : '') + (b.danger ? 'danger' : ''), b.label);
        btn.type = 'button';
        btn.addEventListener('click', function () {
          finish(b.value);
        });
        actions.appendChild(btn);
      });
      if (opts.cancel !== false) {
        var c = el('button', '', opts.cancelLabel || '취소');
        c.type = 'button';
        c.addEventListener('click', function () { finish(cancelValue); });
        actions.appendChild(c);
      }
      function finish(v) {
        wrap.hidden = true;
        wrap.onclick = null;
        resolve(v);
      }
      wrap.onclick = function (e) { if (e.target === wrap && opts.cancel !== false) finish(cancelValue); };
      wrap.hidden = false;
    });
  }

  // ── 액션 메뉴 ────────────────────────────────
  function actionMenu(items) {
    return new Promise(function (resolve) {
      var wrap = $('#actionMenu');
      var panel = $('#actionMenuPanel');
      panel.innerHTML = '';
      items.forEach(function (it) {
        var b = el('button', 'menu-item' + (it.danger ? ' danger' : ''));
        b.type = 'button';
        var ic = el('span', 'mi', it.icon || '');
        b.appendChild(ic);
        b.appendChild(el('span', '', it.label));
        b.addEventListener('click', function () { done(it.value); });
        panel.appendChild(b);
      });
      var cancel = el('button', 'menu-item', '취소');
      cancel.type = 'button';
      cancel.addEventListener('click', function () { done(null); });
      panel.appendChild(cancel);

      function done(v) {
        wrap.hidden = true;
        wrap.onclick = null;
        resolve(v);
      }
      wrap.onclick = function (e) { if (e.target === wrap) done(null); };
      wrap.hidden = false;
    });
  }

  // ── 잠금 ────────────────────────────────────
  var lockUI = { buffer: '', purpose: 'unlock', resolve: null, title: '', msg: '' };

  function hashPin(pin, salt) {
    return sha256Hex(salt + ':' + pin + ':nae-diary');
  }

  function buildKeypad() {
    var pad = $('#keypad');
    pad.innerHTML = '';
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].forEach(function (k) {
      var b = el('button', 'key' + (k === '' ? ' blank' : (k === '⌫' ? ' fn' : '')), k);
      b.type = 'button';
      if (k) {
        b.addEventListener('click', function () {
          if (k === '⌫') lockBack();
          else lockDigit(k);
        });
      }
      pad.appendChild(b);
    });
  }

  function paintLock() {
    var dots = $$('#lockDots i');
    dots.forEach(function (d, i) { d.classList.toggle('on', i < lockUI.buffer.length); });
  }

  function showLock(opts) {
    lockUI.purpose = opts.purpose || 'unlock';
    lockUI.buffer = '';
    lockUI.resolve = opts.resolve || null;
    lockUI.title = opts.title || '4자리 비밀번호를 입력해 주세요';
    lockUI.msg = opts.msg || '';
    $('#lockMsg').textContent = lockUI.title;
    $('#app').hidden = true;
    $('#lockScreen').hidden = false;
    paintLock();
  }

  function hideLock() {
    $('#lockScreen').hidden = true;
    $('#app').hidden = false;
  }

  function lockDigit(d) {
    if (lockUI.buffer.length >= 4) return;
    lockUI.buffer += d;
    paintLock();
    if (lockUI.buffer.length === 4) {
      var pin = lockUI.buffer;
      setTimeout(function () { submitPin(pin); }, 120);
    }
  }

  function lockBack() {
    if (!lockUI.buffer.length) return;
    lockUI.buffer = lockUI.buffer.slice(0, -1);
    paintLock();
  }

  function wrongPin() {
    var dots = $('#lockDots');
    dots.classList.add('shake');
    $('#lockMsg').textContent = '비밀번호가 달라요. 다시 입력해 주세요';
    setTimeout(function () {
      dots.classList.remove('shake');
      lockUI.buffer = '';
      paintLock();
    }, 420);
  }

  async function submitPin(pin) {
    if (lockUI.purpose === 'unlock') {
      var lock = state.lock;
      if (lock && hashPin(pin, lock.salt) === lock.hash) {
        state.unlocked = true;
        hideLock();
        if (lockUI.resolve) lockUI.resolve(true);
      } else {
        wrongPin();
      }
      return;
    }
    if (lockUI.purpose === 'ask') {
      var r = lockUI.resolve;
      hideLock();
      lockUI.resolve = null;
      if (r) r(pin);
    }
  }

  /** 비밀번호 입력창을 띄우고 4자리를 받는다. 취소하면 null. */
  function askPin(title, msg) {
    return new Promise(function (resolve) {
      var cancelBtn = el('button', 'btn-soft', '취소');
      cancelBtn.type = 'button';
      cancelBtn.style.marginTop = '18px';
      var inner = $('.lock-inner');
      var old = $('#lockCancel');
      if (old) old.remove();
      cancelBtn.id = 'lockCancel';
      inner.appendChild(cancelBtn);
      cancelBtn.addEventListener('click', function () {
        cancelBtn.remove();
        $('#lockScreen').hidden = true;
        lockUI.resolve = null;
        resolve(null);
      });
      showLock({
        purpose: 'ask',
        title: title,
        msg: msg,
        resolve: function (pin) {
          cancelBtn.remove();
          resolve(pin);
        }
      });
    });
  }

  async function setupPin() {
    var p1 = await askPin('새 비밀번호 4자리를 입력해 주세요');
    if (!p1) return false;
    var p2 = await askPin('한 번 더 입력해 주세요');
    if (!p2) return false;
    if (p1 !== p2) {
      toast('두 번 입력한 번호가 달라요');
      return false;
    }
    var salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
    state.lock = { enabled: true, salt: salt, hash: hashPin(p1, salt) };
    await DiaryDB.setSetting('lock', state.lock);
    toast('잠금을 켰어요');
    return true;
  }

  // ── 데이터 ──────────────────────────────────
  async function loadAll() {
    state.entries = await DiaryDB.allEntries();
    var media = await DiaryDB.allMedia();
    state.mediaIndex = {};
    media.forEach(function (m) {
      (state.mediaIndex[m.entryId] = state.mediaIndex[m.entryId] || []).push(m);
    });
    Object.keys(state.mediaIndex).forEach(function (k) {
      state.mediaIndex[k].sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    });
  }

  function mediaOf(entryId) { return state.mediaIndex[entryId] || []; }

  // ── 화면 전환 ───────────────────────────────
  function setView(view) {
    state.view = view;
    ['list', 'calendar', 'search', 'settings'].forEach(function (v) {
      $('#view-' + v).hidden = v !== view;
    });
    $$('.tab').forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.view === view);
    });
    $('#fab').hidden = view === 'settings';
    updateTopbar();
    if (view === 'list') renderList();
    if (view === 'calendar') renderCalendar();
    if (view === 'search') {
      renderSearch();
      setTimeout(function () { $('#searchInput').focus(); }, 60);
    }
    if (view === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }

  function updateTopbar() {
    var title = '내 일기';
    var sub = '';
    var n = state.entries.length;
    if (state.view === 'list') {
      sub = n ? '일기 ' + n + '편' : '첫 일기를 기다리는 중';
      if (n) {
        var latest = state.entries[0];
        sub = '일기 ' + n + '편 · 마지막 ' + dateLabel(latest.date);
      }
      title = '내 일기';
    } else if (state.view === 'calendar') {
      title = '달력';
      var inMonth = state.entries.filter(function (e) {
        var d = parseDate(e.date);
        return d.getFullYear() === state.cal.y && d.getMonth() === state.cal.m;
      }).length;
      sub = (state.cal.m + 1) + '월에 ' + inMonth + '편';
    } else if (state.view === 'search') {
      title = '검색';
      sub = '제목 · 내용 · 태그';
    } else {
      title = '설정';
      sub = '내 폰 안에만 저장돼요';
    }
    $('#topTitle').textContent = title;
    $('#topSub').textContent = sub;
    $('#todayBtn').hidden = state.view === 'settings' || state.view === 'search';
  }

  // ── 목록 ────────────────────────────────────
  function entryCard(entry, opts) {
    opts = opts || {};
    var card = el('button', 'entry-card');
    card.type = 'button';
    card.dataset.id = entry.id;

    var top = el('div', 'entry-top');
    top.appendChild(el('span', 'entry-date', dateLabel(entry.date)));
    if (entry.mood) {
      var m = el('span', 'entry-mood', entry.mood);
      top.appendChild(m);
    }
    card.appendChild(top);

    var titleText = (entry.title || '').trim();
    var titleEl = el('div', 'entry-title' + (titleText ? '' : ' untitled'), titleText || '제목 없는 하루');
    if (opts.highlight) fillHighlight(titleEl, titleText || '제목 없는 하루', opts.highlight);
    card.appendChild(titleEl);

    var body = (entry.body || '').trim();
    if (body) {
      var ex = el('div', 'entry-excerpt');
      if (opts.highlight) fillHighlight(ex, body, opts.highlight);
      else ex.textContent = body;
      card.appendChild(ex);
    }

    var media = mediaOf(entry.id);
    if (media.length) {
      var thumbs = el('div', 'entry-thumbs');
      var show = media.slice(0, 3);
      show.forEach(function (m, i) {
        var holder = el('div', 'entry-thumb' + (m.type === 'video' ? ' video' : ''));
        holder.dataset.mediaId = m.id;
        holder.dataset.type = m.type;
        if (i === 2 && media.length > 3) {
          holder.appendChild(el('div', 'more', '+' + (media.length - 2)));
        }
        thumbs.appendChild(holder);
      });
      card.appendChild(thumbs);
    }

    if (entry.tags && entry.tags.length) {
      var tags = el('div', 'entry-tags');
      entry.tags.slice(0, 6).forEach(function (t) {
        tags.appendChild(el('span', 'tag', '#' + t));
      });
      card.appendChild(tags);
    }

    card.addEventListener('click', function () { openDetail(entry.id); });
    return card;
  }

  function fillHighlight(node, text, query) {
    node.textContent = '';
    var q = query.trim();
    if (!q) { node.textContent = text; return; }
    var lower = text.toLowerCase();
    var ql = q.toLowerCase();
    var idx = 0;
    while (idx < text.length) {
      var found = lower.indexOf(ql, idx);
      if (found < 0) break;
      if (found > idx) node.appendChild(document.createTextNode(text.slice(idx, found)));
      node.appendChild(el('mark', '', text.slice(found, found + q.length)));
      idx = found + q.length;
    }
    if (idx < text.length) node.appendChild(document.createTextNode(text.slice(idx)));
    if (!node.childNodes.length) node.textContent = text;
  }

  function renderList() {
    revokeByPrefix('t-');
    var list = $('#entryList');
    list.innerHTML = '';
    var entries = state.entries;
    $('#listEmpty').hidden = entries.length > 0;
    if (!entries.length) return;

    var lastMonth = '';
    var today = todayStr();
    if (!entries.some(function (e) { return e.date === today; })) {
      var nudge = el('button', 'nudge');
      nudge.type = 'button';
      nudge.appendChild(el('span', 'nudge-emoji', '🌤️'));
      var tx = el('span', 'nudge-text');
      tx.appendChild(el('span', 'nudge-title', '오늘 일기가 아직 없어요'));
      tx.appendChild(el('span', 'nudge-sub', '한 줄이라도 남겨 두면 나중에 반가워요'));
      nudge.appendChild(tx);
      nudge.appendChild(el('span', 'nudge-go', '›'));
      nudge.addEventListener('click', function () { openEditor(null); });
      list.appendChild(nudge);
    }

    entries.forEach(function (e) {
      var ym = String(e.date).slice(0, 7);
      if (ym !== lastMonth) {
        list.appendChild(el('div', 'month-sep', monthLabel(e.date)));
        lastMonth = ym;
      }
      list.appendChild(entryCard(e));
    });
    fillThumbs(list);
  }

  // 썸네일을 하나씩 불러와 채운다 (큰 동영상을 한꺼번에 읽지 않도록)
  var thumbQueue = Promise.resolve();
  function fillThumbs(root) {
    var nodes = $$('[data-media-id]', root).filter(function (n) { return !n.dataset.loaded; });
    nodes.forEach(function (node) {
      node.dataset.loaded = '1';
      thumbQueue = thumbQueue.then(function () { return loadThumb(node); });
    });
  }

  async function loadThumb(node) {
    if (!node.isConnected) return;
    var id = node.dataset.mediaId;
    var isVideo = node.dataset.type === 'video';
    try {
      var rec = await DiaryDB.getBlob(id);
      if (!rec || !node.isConnected) return;
      var srcBlob = rec.thumb || (isVideo ? null : rec.blob);
      if (srcBlob) {
        var img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.src = blobUrl('t-' + id, srcBlob);
        node.insertBefore(img, node.firstChild);
      } else {
        node.insertBefore(el('div', 'ph', isVideo ? '🎬' : '🖼'), node.firstChild);
      }
    } catch (e) {
      node.insertBefore(el('div', 'ph', '🖼'), node.firstChild);
    }
  }

  // ── 달력 ────────────────────────────────────
  function renderCalendar() {
    revokeByPrefix('t-');
    var y = state.cal.y, m = state.cal.m;
    $('#calLabel').textContent = y + '년 ' + (m + 1) + '월';

    var counts = {};
    state.entries.forEach(function (e) {
      counts[e.date] = (counts[e.date] || 0) + 1;
    });

    var grid = $('#calGrid');
    grid.innerHTML = '';
    var first = new Date(y, m, 1);
    var startPad = first.getDay();
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var prevDays = new Date(y, m, 0).getDate();
    var cells = [];
    for (var i = startPad - 1; i >= 0; i--) cells.push({ d: prevDays - i, out: true });
    for (var d = 1; d <= daysInMonth; d++) cells.push({ d: d, out: false });
    var nextDay = 1;
    while (cells.length % 7 !== 0) cells.push({ d: nextDay++, out: true });

    cells.forEach(function (c) {
      var btn = el('button', 'cal-cell');
      btn.type = 'button';
      btn.textContent = c.d;
      var key = y + '-' + pad2(m + 1) + '-' + pad2(c.d);
      if (c.out) {
        btn.classList.add('out');
      } else {
        if (key === state.selectedDate) btn.classList.add('sel');
        if (counts[key]) {
          btn.classList.add('has');
          var dotSpan = el('span', 'dot');
          if (key === state.selectedDate) dotSpan.style.background = '#fff';
          btn.appendChild(dotSpan);
        }
        if (key === todayStr()) btn.classList.add('today');
        btn.addEventListener('click', function () {
          state.selectedDate = key;
          renderCalendar();
        });
      }
      if (c.out) {
        btn.addEventListener('click', function () {
          state.cal = { y: m === 0 ? y - 1 : (m === 11 ? y + 1 : y), m: m === 0 ? 11 : (m === 11 ? 0 : m + 1) };
          renderCalendar();
        });
      }
      grid.appendChild(btn);
    });

    var dayBox = $('#calDay');
    dayBox.innerHTML = '';
    var sel = state.selectedDate;
    var dayEntries = state.entries.filter(function (e) { return e.date === sel; });
    var head = el('div', 'cal-day-head', dateLabel(sel) + (dayEntries.length ? ' · ' + dayEntries.length + '편' : ''));
    dayBox.appendChild(head);
    if (!dayEntries.length) {
      dayBox.appendChild(el('div', 'cal-day-empty', '이 날은 쓴 일기가 없어요'));
      var write = el('button', 'btn-soft', '이 날 일기 쓰기');
      write.type = 'button';
      write.addEventListener('click', function () { openEditor(null, sel); });
      dayBox.appendChild(write);
    } else {
      dayEntries.forEach(function (e) { dayBox.appendChild(entryCard(e)); });
      fillThumbs(dayBox);
    }
  }

  // ── 검색 ────────────────────────────────────
  function allTags() {
    var freq = {};
    state.entries.forEach(function (e) {
      (e.tags || []).forEach(function (t) { freq[t] = (freq[t] || 0) + 1; });
    });
    return Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a] || a.localeCompare(b); });
  }

  function matchEntry(e, q) {
    if (!q) return false;
    var ql = q.toLowerCase();
    if ((e.title || '').toLowerCase().indexOf(ql) >= 0) return true;
    if ((e.body || '').toLowerCase().indexOf(ql) >= 0) return true;
    return (e.tags || []).some(function (t) { return t.toLowerCase().indexOf(ql) >= 0; });
  }

  function renderSearch() {
    revokeByPrefix('t-');
    var chips = $('#tagChips');
    chips.innerHTML = '';
    allTags().slice(0, 24).forEach(function (t) {
      var b = el('button', 'tag-chip' + (state.tagFilter === t ? ' on' : ''), '#' + t);
      b.type = 'button';
      b.addEventListener('click', function () {
        state.tagFilter = state.tagFilter === t ? null : t;
        renderSearch();
      });
      chips.appendChild(b);
    });

    var q = state.query.trim();
    var list = $('#searchList');
    list.innerHTML = '';
    $('#searchClear').hidden = !q && !state.tagFilter;
    var summary = $('#searchSummary');

    if (!q && !state.tagFilter) {
      var total = state.entries.length;
      summary.textContent = total ? '일기 ' + total + '편 · 태그를 눌러 골라 볼 수도 있어요' : '';
      return;
    }

    var results = state.entries.filter(function (e) {
      var okTag = !state.tagFilter || (e.tags || []).indexOf(state.tagFilter) >= 0;
      var okQuery = !q || matchEntry(e, q);
      return okTag && okQuery;
    });

    summary.textContent = results.length
      ? results.length + '편 찾았어요'
      : '찾는 일기가 없어요';

    var lastMonth = '';
    results.forEach(function (e) {
      var ym = String(e.date).slice(0, 7);
      if (ym !== lastMonth) { list.appendChild(el('div', 'month-sep', monthLabel(e.date))); lastMonth = ym; }
      list.appendChild(entryCard(e, { highlight: q }));
    });
    fillThumbs(list);
  }

  // ── 설정 ────────────────────────────────────
  async function renderSettings() {
    var lock = state.lock;
    $('#pinToggle').checked = !!(lock && lock.enabled);
    $('#pinChange').hidden = !(lock && lock.enabled);

    var st = await DiaryDB.stats();
    var est = await DiaryDB.estimate();
    var box = $('#statsBox');
    box.innerHTML = '';
    [
      { v: st.entries + '편', l: '일기' },
      { v: st.images + '장', l: '사진' },
      { v: st.videos + '개', l: '동영상' },
      { v: DiaryMedia.formatBytes(st.bytes), l: '사진·동영상 용량' }
    ].forEach(function (s) {
      var d = el('div', 'stat');
      d.appendChild(el('b', '', s.v));
      d.appendChild(el('span', '', s.l));
      box.appendChild(d);
    });
    if (est) {
      var d2 = el('div', 'stat');
      d2.appendChild(el('b', '', DiaryMedia.formatBytes(est.usage)));
      d2.appendChild(el('span', '', '전체 사용량'));
      box.appendChild(d2);
    }

    var last = await DiaryDB.getSetting('lastBackupAt');
    $('#backupInfo').textContent = last
      ? '마지막 백업: ' + relTime(last) + (Date.now() - last > 14 * 864e5 ? ' · 새로 백업해 두세요' : '')
      : '마지막 백업: 아직 없음';
  }

  // ── 일기 보기 ───────────────────────────────
  var detailId = null;

  async function openDetail(id) {
    var entry = state.entries.find(function (e) { return e.id === id; });
    if (!entry) return;
    detailId = id;
    var body = $('#detailBody');
    body.innerHTML = '';
    $('#detailHead').textContent = entry.date.slice(0, 4) + '년 ' + dateLabel(entry.date);

    var article = el('div');
    if (entry.mood) article.appendChild(el('div', 'full-mood', entry.mood));
    article.appendChild(el('h1', 'full-title', (entry.title || '').trim() || '제목 없는 하루'));
    if ((entry.body || '').trim()) article.appendChild(el('div', 'full-body', entry.body));

    var media = mediaOf(id);
    if (media.length) {
      var box = el('div', 'full-media');
      article.appendChild(box);
      for (var i = 0; i < media.length; i++) {
        var rec = await DiaryDB.getBlob(media[i].id);
        if (!rec || !rec.blob) continue;
        var src = blobUrl('full-' + media[i].id, rec.blob);
        if (media[i].type === 'video') {
          var v = document.createElement('video');
          v.controls = true;
          v.playsInline = true;
          v.preload = 'metadata';
          v.src = src;
          box.appendChild(v);
        } else {
          var img = document.createElement('img');
          img.alt = media[i].name || '사진';
          img.loading = 'lazy';
          img.src = src;
          box.appendChild(img);
        }
      }
    }

    if (entry.tags && entry.tags.length) {
      var tags = el('div', 'tag-chips full-tags');
      entry.tags.forEach(function (t) { tags.appendChild(el('span', 'tag', '#' + t)); });
      article.appendChild(tags);
    }

    var meta = el('div', 'full-meta');
    meta.textContent = '쓴 날 ' + new Date(entry.createdAt || Date.now()).toLocaleDateString('ko-KR') +
      (entry.updatedAt && entry.updatedAt !== entry.createdAt ? ' · 고친 날 ' + new Date(entry.updatedAt).toLocaleDateString('ko-KR') : '');
    article.appendChild(meta);
    body.appendChild(article);

    pushLayer($('#detailSheet'), function () {
      detailId = null;
      $('#detailBody').innerHTML = '';
      revokeByPrefix('full-');
    });
  }

  async function detailMenu() {
    var entry = state.entries.find(function (e) { return e.id === detailId; });
    if (!entry) return;
    var pick = await actionMenu([
      { icon: '✏️', label: '고치기', value: 'edit' },
      { icon: '🔗', label: '공개용 HTML 파일로 내보내기', value: 'share' },
      { icon: '🗑️', label: '삭제', value: 'delete', danger: true }
    ]);
    if (pick === 'edit') {
      closeLayer();
      setTimeout(function () { openEditor(entry); }, 120);
    } else if (pick === 'share') {
      await shareEntry(entry);
    } else if (pick === 'delete') {
      var ok = await dialog({
        title: '이 일기를 지울까요?',
        text: dateLabel(entry.date) + '\n' + ((entry.title || '').trim() || '제목 없는 하루') + '\n\n사진과 동영상도 함께 지워지고, 되돌릴 수 없어요.',
        buttons: [{ label: '지우기', value: true, danger: true }],
        cancelLabel: '그만두기'
      });
      if (ok) {
        await DiaryDB.deleteEntry(entry.id);
        await loadAll();
        closeLayer();
        renderList();
        updateTopbar();
        toast('지웠어요');
      }
    }
  }

  async function shareEntry(entry) {
    try {
      toast('공개용 파일을 만드는 중…', 4000);
      var r = await DiaryShare.downloadEntry(entry);
      var mb = r.bytes / 1024 / 1024;
      toast(mb > 20
        ? '내보냈어요 (' + mb.toFixed(1) + 'MB) — 커서 메신저 전송이 안 될 수 있어요'
        : '공개용 파일로 내보냈어요', 3200);
    } catch (e) {
      dialog({ title: '내보내지 못했어요', text: String(e.message || e), buttons: [{ label: '확인', value: true, primary: true }], cancel: false });
    }
  }

  // ── 일기 쓰기 / 고치기 ──────────────────────
  function openEditor(entry, dateOverride) {
    var ed = {
      entry: entry || null,
      id: entry ? entry.id : DiaryDB.uid(),
      date: entry ? entry.date : (dateOverride || todayStr()),
      title: entry ? (entry.title || '') : '',
      body: entry ? (entry.body || '') : '',
      mood: entry ? (entry.mood || null) : null,
      tags: entry ? (entry.tags || []).slice() : [],
      media: [],
      removed: [],
      isNew: !entry
    };
    state.editing = ed;

    $('#editorHeading').textContent = entry ? '일기 고치기' : '새 일기';
    $('#fDate').value = ed.date;
    $('#fTitle').value = ed.title;
    $('#fBody').value = ed.body;
    $('#fTags').value = '';
    $('#editorDanger').hidden = !entry;
    $('.editor-scroll').scrollTop = 0;

    renderMoods();
    renderTagChips();
    renderEditorMedia();
    autoGrowBody();

    if (entry) {
      mediaOf(entry.id).forEach(function (m) {
        ed.media.push({
          id: m.id, type: m.type, mime: m.mime, name: m.name, size: m.size,
          order: m.order || 0, isNew: false, meta: m, file: null, thumb: null, url: null
        });
      });
      loadEditorMedia();
      renderEditorMedia();
    }

    pushLayer($('#editorSheet'), function () {
      state.editing = null;
      $('#fMedia').innerHTML = '';
    }, function () {
      // 안드로이드 뒤로가기: 쓰던 내용이 있으면 그냥 닫지 않고 물어본다
      if (editorHasChanges()) { askCloseEditor(); return false; }
      return true;
    });
  }

  async function loadEditorMedia() {
    var ed = state.editing;
    if (!ed) return;
    for (var i = 0; i < ed.media.length; i++) {
      var it = ed.media[i];
      if (it.isNew || it.url) continue;
      try {
        var rec = await DiaryDB.getBlob(it.id);
        if (!rec) continue;
        it.thumb = rec.thumb;
        it.thumbBlob = rec.thumb || (it.type === 'image' ? rec.blob : null);
        if (it.thumbBlob) it.url = URL.createObjectURL(it.thumbBlob);
        renderEditorMedia();
      } catch (e) { /* 무시 */ }
    }
  }

  function renderMoods() {
    var box = $('#fMoods');
    box.innerHTML = '';
    MOODS.forEach(function (m) {
      var on = state.editing.mood === m.key;
      var b = el('button', 'mood' + (on ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.setAttribute('aria-label', m.label);
      b.appendChild(el('span', '', m.key));
      b.appendChild(el('span', '', m.label));
      b.addEventListener('click', function () {
        state.editing.mood = on ? null : m.key;
        renderMoods();
      });
      box.appendChild(b);
    });
  }

  function renderTagChips() {
    var box = $('#fTagChips');
    box.innerHTML = '';
    state.editing.tags.forEach(function (t, i) {
      var b = el('button', 'tag-chip on', '#' + t + '  ✕');
      b.type = 'button';
      b.addEventListener('click', function () {
        state.editing.tags.splice(i, 1);
        renderTagChips();
      });
      box.appendChild(b);
    });
  }

  function renderEditorMedia() {
    var ed = state.editing;
    if (!ed) return;
    var grid = $('#fMedia');
    grid.innerHTML = '';
    ed.media.forEach(function (it, idx) {
      var box = el('div', 'm-item');
      if (it.url) {
        var img = document.createElement('img');
        img.alt = '';
        img.src = it.url;
        box.appendChild(img);
      } else if (it.type === 'image' && it.file) {
        var u = URL.createObjectURL(it.file);
        var im2 = document.createElement('img');
        im2.alt = '';
        im2.src = u;
        box.appendChild(im2);
      } else {
        box.appendChild(el('div', 'm-ph', it.type === 'video' ? '🎬' : '🖼'));
      }
      if (it.type === 'video') box.appendChild(el('span', 'm-badge', '동영상'));
      var del = el('button', 'm-del', '✕');
      del.type = 'button';
      del.setAttribute('aria-label', '이 사진 빼기');
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        ed.media.splice(idx, 1);
        if (!it.isNew) ed.removed.push(it.id);
        renderEditorMedia();
      });
      box.appendChild(del);
      grid.appendChild(box);
    });

    var photos = ed.media.filter(function (m) { return m.type === 'image'; }).length;
    var videos = ed.media.filter(function (m) { return m.type === 'video'; }).length;
    $('#mediaHint').textContent = '사진 ' + photos + '/' + MAX_PHOTOS + '장 · 동영상 ' + videos + '/' + MAX_VIDEOS + '개';
  }

  function autoGrowBody() {
    var t = $('#fBody');
    t.style.height = 'auto';
    t.style.height = Math.max(180, t.scrollHeight) + 'px';
  }

  function parseTags(text) {
    return text.split(/[,#\n]/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 12);
  }

  async function addPhotos(files) {
    var ed = state.editing;
    if (!ed) return;
    var room = MAX_PHOTOS - ed.media.filter(function (m) { return m.type === 'image'; }).length;
    if (room <= 0) { toast('사진은 ' + MAX_PHOTOS + '장까지 넣을 수 있어요'); return; }
    var list = files.slice(0, room);
    if (list.length < files.length) toast('사진은 ' + MAX_PHOTOS + '장까지라 ' + list.length + '장만 담았어요');
    toast('사진 준비 중…', 1500);
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var thumb = await DiaryMedia.makeImageThumb(f, 520);
      ed.media.push({
        id: DiaryDB.uid(), type: 'image', mime: f.type || 'image/jpeg', name: f.name || '',
        size: f.size || 0, order: ed.media.length, isNew: true, file: f, thumb: thumb,
        url: thumb ? URL.createObjectURL(thumb) : null
      });
      renderEditorMedia();
    }
  }

  async function addVideo(file) {
    var ed = state.editing;
    if (!ed) return;
    var videos = ed.media.filter(function (m) { return m.type === 'video'; }).length;
    if (videos >= MAX_VIDEOS) { toast('동영상은 ' + MAX_VIDEOS + '개까지 넣을 수 있어요'); return; }
    toast('동영상 읽는 중…', 2500);
    var poster = await DiaryMedia.makeVideoPoster(file, 520);
    ed.media.push({
      id: DiaryDB.uid(), type: 'video', mime: file.type || 'video/mp4', name: file.name || '',
      size: file.size || 0, duration: poster.duration || 0, order: ed.media.length,
      isNew: true, file: file, thumb: poster.thumb,
      url: poster.thumb ? URL.createObjectURL(poster.thumb) : null
    });
    renderEditorMedia();
  }

  async function saveEditor() {
    var ed = state.editing;
    if (!ed || state.busy) return;
    var title = $('#fTitle').value.trim();
    var body = $('#fBody').value.trim();
    var date = $('#fDate').value || todayStr();
    var tagsText = $('#fTags').value.trim();
    var tags = ed.tags.slice();
    if (tagsText) {
      parseTags(tagsText).forEach(function (t) { if (tags.indexOf(t) < 0) tags.push(t); });
    }

    if (!title && !body && !ed.media.length) {
      toast('제목이나 내용을 적어 주세요');
      $('#fTitle').focus();
      return;
    }

    state.busy = true;
    $('#editorSave').textContent = '저장 중';
    try {
      var now = Date.now();
      var entry = ed.entry ? Object.assign({}, ed.entry) : { id: ed.id, createdAt: now };
      entry.date = date;
      entry.title = title;
      entry.body = body;
      entry.mood = ed.mood || null;
      entry.tags = tags;
      entry.updatedAt = now;
      if (!entry.createdAt) entry.createdAt = now;

      await DiaryDB.saveEntry(entry);

      if (ed.removed.length) await DiaryDB.deleteMedia(ed.removed);

      for (var i = 0; i < ed.media.length; i++) {
        var it = ed.media[i];
        if (it.isNew) {
          await DiaryDB.saveMedia({
            id: it.id, entryId: entry.id, type: it.type, mime: it.mime, name: it.name,
            size: it.size, duration: it.duration || 0, order: i, createdAt: now
          }, { blob: it.file, thumb: it.thumb || null });
        } else if ((it.meta.order || 0) !== i) {
          await DiaryDB.putMediaMeta(Object.assign({}, it.meta, { order: i }));
        }
      }

      await loadAll();
      closeLayer();
      setView(state.view === 'calendar' ? 'calendar' : (state.view === 'search' ? 'search' : 'list'));
      toast(ed.isNew ? '일기를 저장했어요' : '고친 내용을 저장했어요');
      DiaryDB.requestPersistence();
    } catch (e) {
      dialog({ title: '저장하지 못했어요', text: String(e.message || e), buttons: [{ label: '확인', value: true, primary: true }], cancel: false });
    } finally {
      state.busy = false;
      $('#editorSave').textContent = '저장';
    }
  }

  async function deleteFromEditor() {
    var ed = state.editing;
    if (!ed || !ed.entry) return;
    var ok = await dialog({
      title: '이 일기를 지울까요?',
      text: '사진과 동영상도 함께 지워지고, 되돌릴 수 없어요.',
      buttons: [{ label: '지우기', value: true, danger: true }],
      cancelLabel: '그만두기'
    });
    if (!ok) return;
    await DiaryDB.deleteEntry(ed.entry.id);
    await loadAll();
    closeLayer();
    renderList();
    updateTopbar();
    toast('지웠어요');
  }

  // ── 내보내기 / 가져오기 ─────────────────────
  async function doExport() {
    if (state.busy) return;
    state.busy = true;
    toast('백업 파일을 만드는 중…', 60000);
    try {
      var r = await DiaryBackup.exportBackup(function (msg) { toast(msg, 60000); });
      toast('백업 파일을 저장했어요 (' + DiaryMedia.formatBytes(r.bytes) + ')', 3200);
      renderSettings();
    } catch (e) {
      dialog({ title: '백업하지 못했어요', text: String(e.message || e), buttons: [{ label: '확인', value: true, primary: true }], cancel: false });
    } finally {
      state.busy = false;
    }
  }

  function pickImportFile() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.addEventListener('change', async function () {
      var f = input.files && input.files[0];
      if (!f) return;
      await runImport(f);
    });
    input.click();
  }

  async function runImport(file) {
    var mode = await dialog({
      title: '백업 파일을 가져올까요?',
      text: file.name + '\n\n지금 일기에 더할지, 전부 바꿀지 골라 주세요.',
      buttons: [
        { label: '지금 일기에 더하기', value: 'merge', primary: true },
        { label: '전부 바꾸기', value: 'replace', danger: true }
      ],
      cancelLabel: '취소'
    });
    if (!mode) return;

    if (mode === 'replace') {
      var ok = await dialog({
        title: '정말 전부 바꿀까요?',
        text: '지금 이 브라우저에 있는 일기가 모두 지워지고 백업 파일의 내용으로 바뀝니다.',
        buttons: [{ label: '바꾸기', value: true, danger: true }],
        cancelLabel: '취소'
      });
      if (!ok) return;
    }

    state.busy = true;
    try {
      var r = await DiaryBackup.importBackup(file, mode, function (msg) { toast(msg, 60000); });
      await loadAll();
      renderList();
      updateTopbar();
      if (r.added || r.updated) setView('list');
      renderSettings();
      toast('가져왔어요 · 새 일기 ' + r.added + '편, 고친 일기 ' + r.updated + '편', 3400);
      if (r.missing) {
        setTimeout(function () {
          dialog({
            title: '일부 사진을 찾지 못했어요',
            text: r.missing + '개의 사진·동영상이 ZIP 안에 없었어요. 일기 글은 그대로 들어갔습니다.',
            buttons: [{ label: '확인', value: true, primary: true }],
            cancel: false
          });
        }, 600);
      }
    } catch (e) {
      dialog({ title: '가져오지 못했어요', text: String(e.message || e), buttons: [{ label: '확인', value: true, primary: true }], cancel: false });
    } finally {
      state.busy = false;
    }
  }

  // ── 이벤트 연결 ─────────────────────────────
  function bindEvents() {
    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { setView(t.dataset.view); });
    });

    $('#fab').addEventListener('click', function () { openEditor(null); });
    $('#emptyWrite').addEventListener('click', function () { openEditor(null); });

    $('#todayBtn').addEventListener('click', function () {
      var t = todayStr();
      var existing = state.entries.filter(function (e) { return e.date === t; })[0];
      if (existing) openDetail(existing.id);
      else openEditor(null, t);
    });

    $('#detailBack').addEventListener('click', function () { closeLayer(); });
    $('#detailMore').addEventListener('click', detailMenu);
    $('#editorClose').addEventListener('click', askCloseEditor);
    $('#editorSave').addEventListener('click', saveEditor);
    $('#editorDelete').addEventListener('click', deleteFromEditor);

    $('#fBody').addEventListener('input', autoGrowBody);

    $('#fPhoto').addEventListener('change', function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      e.target.value = '';
      if (files.length) addPhotos(files);
    });
    $('#fVideo').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) addVideo(f);
    });

    $('#calPrev').addEventListener('click', function () { shiftMonth(-1); });
    $('#calNext').addEventListener('click', function () { shiftMonth(1); });
    $('#calLabel').addEventListener('click', function () {
      var d = new Date();
      state.cal = { y: d.getFullYear(), m: d.getMonth() };
      state.selectedDate = todayStr();
      renderCalendar();
      updateTopbar();
    });

    var searchTimer = null;
    $('#searchInput').addEventListener('input', function (e) {
      state.query = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderSearch, 140);
    });
    $('#searchClear').addEventListener('click', function () {
      state.query = '';
      state.tagFilter = null;
      $('#searchInput').value = '';
      renderSearch();
    });

    $('#pinToggle').addEventListener('change', async function (e) {
      var on = e.target.checked;
      if (on) {
        var done = await setupPin();
        if (!done) { e.target.checked = false; return; }
        state.unlocked = true;
        renderSettings();
      } else {
        var pin = await askPin('지금 비밀번호를 입력해 주세요');
        if (!pin) { e.target.checked = true; return; }
        if (!state.lock || hashPin(pin, state.lock.salt) !== state.lock.hash) {
          toast('비밀번호가 달라요');
          e.target.checked = true;
          return;
        }
        state.lock = { enabled: false };
        await DiaryDB.setSetting('lock', state.lock);
        toast('잠금을 껐어요');
        renderSettings();
      }
    });

    $('#pinChange').addEventListener('click', async function () {
      var pin = await askPin('지금 비밀번호를 입력해 주세요');
      if (!pin) return;
      if (!state.lock || hashPin(pin, state.lock.salt) !== state.lock.hash) { toast('비밀번호가 달라요'); return; }
      await setupPin();
      renderSettings();
    });

    $('#backupExport').addEventListener('click', doExport);
    $('#backupImport').addEventListener('click', pickImportFile);

    $('#wipeBtn').addEventListener('click', async function () {
      var ok = await dialog({
        title: '모두 지울까요?',
        text: '이 브라우저에 저장된 일기 ' + state.entries.length + '편과 사진·동영상이 모두 지워집니다. 되돌릴 수 없어요.',
        buttons: [{ label: '모두 지우기', value: true, danger: true }],
        cancelLabel: '취소'
      });
      if (!ok) return;
      var again = await dialog({
        title: '마지막 확인',
        text: '백업 파일은 만들어 두셨나요? 지금 지우면 되돌릴 수 없어요.',
        buttons: [{ label: '그래도 지우기', value: true, danger: true }],
        cancelLabel: '취소'
      });
      if (!again) return;
      await DiaryDB.clearAll();
      await loadAll();
      setView('list');
      renderSettings();
      toast('모두 지웠어요');
    });

    // 자동 잠금: 앱을 2분 넘게 벗어났다 돌아오면 다시 잠근다
    var hiddenAt = 0;
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt && state.lock && state.lock.enabled && state.unlocked) {
        if (Date.now() - hiddenAt > 120000) {
          state.unlocked = false;
          showLock({ purpose: 'unlock', title: '다시 열려면 비밀번호를 입력해 주세요' });
        }
        hiddenAt = 0;
      }
    });
  }

  function shiftMonth(delta) {
    var y = state.cal.y, m = state.cal.m + delta;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    state.cal = { y: y, m: m };
    var today = new Date();
    if (y === today.getFullYear() && m === today.getMonth()) state.selectedDate = todayStr();
    else state.selectedDate = y + '-' + pad2(m + 1) + '-01';
    renderCalendar();
    updateTopbar();
  }

  function editorHasChanges() {
    var ed = state.editing;
    if (!ed) return false;
    var title = $('#fTitle').value.trim();
    var body = $('#fBody').value.trim();
    return title !== (ed.entry ? (ed.entry.title || '') : '') ||
      body !== (ed.entry ? (ed.entry.body || '') : '') ||
      $('#fTags').value.trim().length > 0 ||
      ed.media.some(function (m) { return m.isNew; }) ||
      ed.removed.length > 0;
  }

  async function askCloseEditor() {
    var ed = state.editing;
    if (!ed) { closeLayer(); return; }
    if (!editorHasChanges()) { closeLayer(); return; }

    var pick = await dialog({
      title: '쓰던 내용이 있어요',
      text: '저장하지 않고 나가면 이번에 적은 내용은 사라져요.',
      buttons: [
        { label: '저장하고 나가기', value: 'save', primary: true },
        { label: '그냥 나가기', value: 'discard', danger: true }
      ],
      cancelLabel: '계속 쓰기'
    });
    if (pick === 'save') { await saveEditor(); return; }
    if (pick === 'discard') { closeLayer(); }
  }

  // ── 시작 ────────────────────────────────────
  async function boot() {
    buildKeypad();
    bindEvents();

    // 서비스 워커 (홈 화면에 추가했을 때 오프라인에서도 열리도록)
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }

    var deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      $('#installBtn').hidden = false;
    });
    $('#installBtn').addEventListener('click', async function () {
      if (!deferredPrompt) { toast('브라우저 메뉴에서 "홈 화면에 추가"를 눌러 주세요'); return; }
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      $('#installBtn').hidden = true;
    });

    $('#appVer').textContent = '버전 1.0';

    try {
      await loadAll();
    } catch (e) {
      document.body.innerHTML = '<div style="padding:40px 24px;font-family:sans-serif;line-height:1.7">' +
        '<h1 style="font-size:20px">저장소를 열 수 없어요</h1>' +
        '<p>이 브라우저에서는 일기 저장소(IndexedDB)를 쓸 수 없습니다.<br>' +
        '크롬에서 https:// 주소로 열거나, README 의 안내를 봐 주세요.</p></div>';
      return;
    }

    state.lock = await DiaryDB.getSetting('lock');
    if (state.lock && state.lock.enabled) {
      showLock({ purpose: 'unlock', title: '4자리 비밀번호를 입력해 주세요' });
    } else {
      state.unlocked = true;
      hideLock();
    }

    updateTopbar();
    renderList();
    setView('list');

    // 비밀번호 키패드 키보드 지원
    document.addEventListener('keydown', function (e) {
      if ($('#lockScreen').hidden) return;
      if (/^[0-9]$/.test(e.key)) lockDigit(e.key);
      else if (e.key === 'Backspace') { e.preventDefault(); lockBack(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
