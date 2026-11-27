/* idb.js — 브라우저 IndexedDB 저장소
   저장 구조
     entries  : 일기 본문/제목/날짜/기분/태그
     media    : 사진·동영상의 정보(이름, 종류, 크기, 순서)
     blobs    : 실제 파일(Blob)과 작은 썸네일  → media.id 로 연결
     settings : 잠금 비밀번호, 마지막 백업 시각 같은 설정
   사진/동영상을 따로 두는 이유: 목록을 그릴 때 큰 동영상까지 읽지 않기 위해서. */
(function (global) {
  'use strict';

  var DB_NAME = 'nae-diary';
  var DB_VERSION = 1;
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error('이 브라우저에서는 저장소(IndexedDB)를 쓸 수 없어요.'));
        return;
      }
      var req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('entries')) {
          var e = db.createObjectStore('entries', { keyPath: 'id' });
          e.createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('media')) {
          var m = db.createObjectStore('media', { keyPath: 'id' });
          m.createIndex('entryId', 'entryId');
        }
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('저장소를 열지 못했어요.')); };
      req.onblocked = function () { /* 다른 탭이 열려 있어도 기다린다 */ };
    });
    return dbPromise;
  }

  // 읽기: 요청 하나의 결과를 돌려준다.
  function read(storeName, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(storeName, 'readonly');
        var s = t.objectStore(storeName);
        var r;
        try { r = fn(s); } catch (e) { reject(e); return; }
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  // 쓰기: 트랜잭션이 끝나면 완료.
  function write(storeNames, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t;
        try {
          t = db.transaction(storeNames, 'readwrite');
        } catch (e) { reject(e); return; }
        var stores = storeNames.map(function (n) { return t.objectStore(n); });
        var out;
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('저장하지 못했어요.')); };
        try {
          out = fn.apply(null, stores);
        } catch (e) {
          try { t.abort(); } catch (ignore) {}
          reject(e);
        }
      });
    });
  }

  function uid() {
    var s = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
    return Date.now().toString(36) + '-' + s.slice(0, 18);
  }

  // ── 일기 ──────────────────────────────────
  function allEntries() {
    return read('entries', function (s) { return s.getAll(); }).then(function (list) {
      list = list || [];
      list.sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
      return list;
    });
  }

  function getEntry(id) {
    return read('entries', function (s) { return s.get(id); });
  }

  function saveEntry(entry) {
    return write(['entries'], function (s) { s.put(entry); return entry; });
  }

  // 일기 한 편과 그 안의 사진·동영상을 모두 지운다.
  function deleteEntry(id) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(['entries', 'media', 'blobs'], 'readwrite');
        t.oncomplete = function () { resolve(true); };
        t.onerror = function () { reject(t.error); };
        t.objectStore('entries').delete(id);
        var idx = t.objectStore('media').index('entryId');
        var cur = idx.openCursor(IDBKeyRange.only(id));
        cur.onsuccess = function () {
          var c = cur.result;
          if (!c) return;
          t.objectStore('blobs').delete(c.value.id);
          c.delete();
          c.continue();
        };
      });
    });
  }

  // ── 사진 · 동영상 ─────────────────────────
  function allMedia() {
    return read('media', function (s) { return s.getAll(); }).then(function (l) { return l || []; });
  }

  function mediaFor(entryId) {
    return read('media', function (s) {
      return s.index('entryId').getAll(IDBKeyRange.only(entryId));
    }).then(function (l) {
      l = l || [];
      l.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      return l;
    });
  }

  function saveMedia(meta, files) {
    return write(['media', 'blobs'], function (m, b) {
      m.put(meta);
      b.put({ id: meta.id, blob: files.blob, thumb: files.thumb || null });
      return meta;
    });
  }

  // 사진·동영상 파일은 그대로 두고 정보(순서 등)만 고친다.
  function putMediaMeta(meta) {
    return write(['media'], function (m) { m.put(meta); return meta; });
  }

  function getBlob(id) {
    return read('blobs', function (s) { return s.get(id); });
  }

  function deleteMedia(ids) {
    if (!ids || !ids.length) return Promise.resolve();
    return write(['media', 'blobs'], function (m, b) {
      ids.forEach(function (id) { m.delete(id); b.delete(id); });
    });
  }

  function deleteMediaForEntry(entryId) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(['media', 'blobs'], 'readwrite');
        t.oncomplete = function () { resolve(true); };
        t.onerror = function () { reject(t.error); };
        var idx = t.objectStore('media').index('entryId');
        var cur = idx.openCursor(IDBKeyRange.only(entryId));
        cur.onsuccess = function () {
          var c = cur.result;
          if (!c) return;
          t.objectStore('blobs').delete(c.value.id);
          c.delete();
          c.continue();
        };
      });
    });
  }

  // ── 설정 ──────────────────────────────────
  function getSetting(key) {
    return read('settings', function (s) { return s.get(key); }).then(function (r) {
      return r ? r.value : undefined;
    });
  }

  function setSetting(key, value) {
    return write(['settings'], function (s) {
      s.put({ key: key, value: value });
      return value;
    });
  }

  function removeSetting(key) {
    return write(['settings'], function (s) { s.delete(key); });
  }

  // ── 통계 · 초기화 ─────────────────────────
  function stats() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(['entries', 'media'], 'readonly');
        var out = { entries: 0, images: 0, videos: 0, bytes: 0 };
        var reqs = [
          t.objectStore('entries').count(),
          t.objectStore('media').getAll()
        ];
        t.oncomplete = function () {
          out.entries = reqs[0].result || 0;
          var media = reqs[1].result || [];
          media.forEach(function (m) {
            if (m.type === 'video') out.videos++;
            else out.images++;
            out.bytes += m.size || 0;
          });
          resolve(out);
        };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function clearAll() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var names = ['entries', 'media', 'blobs'];
        var t = db.transaction(names, 'readwrite');
        t.oncomplete = function () { resolve(true); };
        t.onerror = function () { reject(t.error); };
        names.forEach(function (n) { t.objectStore(n).clear(); });
      });
    });
  }

  async function estimate() {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    try {
      var e = await navigator.storage.estimate();
      return { usage: e.usage || 0, quota: e.quota || 0 };
    } catch (e) { return null; }
  }

  async function requestPersistence() {
    if (!navigator.storage || !navigator.storage.persist) return false;
    try { return await navigator.storage.persist(); } catch (e) { return false; }
  }

  global.DiaryDB = {
    open: open,
    uid: uid,
    allEntries: allEntries,
    getEntry: getEntry,
    saveEntry: saveEntry,
    deleteEntry: deleteEntry,
    allMedia: allMedia,
    mediaFor: mediaFor,
    saveMedia: saveMedia,
    putMediaMeta: putMediaMeta,
    getBlob: getBlob,
    deleteMedia: deleteMedia,
    deleteMediaForEntry: deleteMediaForEntry,
    getSetting: getSetting,
    setSetting: setSetting,
    removeSetting: removeSetting,
    stats: stats,
    clearAll: clearAll,
    estimate: estimate,
    requestPersistence: requestPersistence
  };
})(window);
