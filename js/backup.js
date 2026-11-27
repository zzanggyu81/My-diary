/* backup.js — 전체 데이터를 ZIP 하나로 내보내고 다시 가져오기
   ZIP 안 구성
     entries.json        일기 목록 + 사진/동영상 정보
     media/<id>.<확장자>  원본 사진 · 동영상
     thumbs/<id>.jpg      목록용 작은 미리보기
     README.txt           복구 안내 */
(function (global) {
  'use strict';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayStamp() {
    var d = new Date();
    return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  }

  async function exportBackup(onProgress) {
    var say = onProgress || function () {};
    say('일기 목록을 모으는 중…');
    var entries = await DiaryDB.allEntries();
    var media = await DiaryDB.allMedia();

    var byEntry = {};
    media.forEach(function (m) {
      (byEntry[m.entryId] = byEntry[m.entryId] || []).push(m);
    });

    var manifest = {
      app: '내 일기',
      format: 'diary-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      entryCount: entries.length,
      entries: []
    };
    var files = [];

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var list = (byEntry[e.id] || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      var mediaMeta = [];
      for (var j = 0; j < list.length; j++) {
        var m = list[j];
        var ext = DiaryMedia.extension(m.mime, m.type === 'video' ? 'mp4' : 'jpg');
        var path = 'media/' + m.id + '.' + ext;
        var rec = await DiaryDB.getBlob(m.id);
        if (rec && rec.blob) {
          files.push({ name: path, data: rec.blob });
          if (rec.thumb) files.push({ name: 'thumbs/' + m.id + '.jpg', data: rec.thumb });
          mediaMeta.push({
            id: m.id, type: m.type, mime: m.mime, name: m.name || '',
            size: m.size || rec.blob.size || 0, duration: m.duration || 0,
            order: m.order || 0, path: path,
            thumbPath: rec.thumb ? 'thumbs/' + m.id + '.jpg' : null
          });
        }
      }
      manifest.entries.push({
        id: e.id, date: e.date, title: e.title || '', body: e.body || '',
        mood: e.mood || null, tags: e.tags || [],
        createdAt: e.createdAt || null, updatedAt: e.updatedAt || null,
        media: mediaMeta
      });
      say('사진·동영상 담는 중… (' + (i + 1) + '/' + entries.length + ')');
    }

    files.unshift({
      name: 'README.txt',
      data: new Blob([
        '내 일기 백업 파일\n',
        '만든 시각: ' + new Date().toLocaleString('ko-KR') + '\n\n',
        '이 ZIP 파일은 일기장 앱의 [설정 → 백업 → 가져오기]에서 그대로 불러올 수 있어요.\n',
        'entries.json 에 일기 내용이, media 폴더에 사진과 동영상이 들어 있습니다.\n',
        'ZIP 을 풀어서 사진만 꺼내 보셔도 됩니다.\n'
      ], { type: 'text/plain;charset=utf-8' })
    });
    files.splice(1, 0, {
      name: 'entries.json',
      data: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
    });

    say('ZIP 파일로 묶는 중…');
    var zip = await DiaryZip.makeZip(files);
    var name = '내일기-백업-' + todayStamp() + '.zip';
    DiaryZip.download(zip, name);

    await DiaryDB.setSetting('lastBackupAt', Date.now());
    return { filename: name, entries: entries.length, media: media.length, bytes: zip.size };
  }

  function findKey(map, suffix) {
    var keys = Array.from(map.keys());
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === suffix || keys[i].slice(-suffix.length - 1) === '/' + suffix) return keys[i];
    }
    return null;
  }

  /**
   * mode: 'merge' (기존 자료에 더하기) | 'replace' (전부 바꾸기)
   * onProgress(text)
   */
  async function importBackup(file, mode, onProgress) {
    var say = onProgress || function () {};
    say('ZIP 파일을 읽는 중…');
    var zip = await DiaryZip.readZip(file);

    var key = findKey(zip, 'entries.json');
    if (!key) throw new Error('이 백업 파일에는 entries.json 이 없어요. 앱에서 내보낸 ZIP 인지 확인해 주세요.');
    var text = await zip.get(key).text();
    var data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('entries.json 을 읽을 수 없어요.'); }
    if (!data || !Array.isArray(data.entries)) throw new Error('백업 파일 형식이 올바르지 않아요.');

    if (mode === 'replace') {
      say('기존 자료를 비우는 중…');
      await DiaryDB.clearAll();
    }

    var existing = {};
    if (mode !== 'replace') {
      (await DiaryDB.allEntries()).forEach(function (e) { existing[e.id] = e; });
    }

    var added = 0, updated = 0, skipped = 0, mediaSaved = 0, missing = 0;
    var total = data.entries.length;

    function thumbFor(path) {
      if (!path) return null;
      var k = findKey(zip, path.split('/').pop());
      return k ? zip.get(k) : null;
    }

    for (var i = 0; i < total; i++) {
      var e = data.entries[i] || {};
      if (!e.id || !e.date) { skipped++; continue; }
      say('가져오는 중… (' + (i + 1) + '/' + total + ')');

      var old = existing[e.id];
      if (old && (old.updatedAt || 0) > (e.updatedAt || 0)) { skipped++; continue; }

      var entry = {
        id: e.id,
        date: String(e.date).slice(0, 10),
        title: e.title || '',
        body: e.body || '',
        mood: e.mood || null,
        tags: Array.isArray(e.tags) ? e.tags : [],
        createdAt: e.createdAt || Date.now(),
        updatedAt: e.updatedAt || Date.now()
      };
      await DiaryDB.saveEntry(entry);
      if (old) updated++; else added++;

      // 같은 일기의 기존 사진은 새로 넣을 것만 남기고 정리
      var keep = {};
      var list = Array.isArray(e.media) ? e.media : [];
      for (var j = 0; j < list.length; j++) {
        var m = list[j];
        if (!m || !m.id) continue;
        var blobFile = m.path ? findKey(zip, m.path.split('/').pop()) : null;
        var blob = blobFile ? zip.get(blobFile) : null;
        if (!blob) { missing++; continue; }
        var thumb = await thumbFor(m.thumbPath);
        await DiaryDB.saveMedia(
          {
            id: m.id, entryId: entry.id, type: m.type === 'video' ? 'video' : 'image',
            mime: m.mime || blob.type || '', name: m.name || '', size: blob.size,
            duration: m.duration || 0, order: m.order || j, createdAt: Date.now()
          },
          { blob: blob, thumb: thumb || null }
        );
        keep[m.id] = true;
        mediaSaved++;
      }
      if (old) {
        var oldMedia = await DiaryDB.mediaFor(entry.id);
        var drop = oldMedia.filter(function (m) { return !keep[m.id]; }).map(function (m) { return m.id; });
        if (drop.length) await DiaryDB.deleteMedia(drop);
      }
    }
    await DiaryDB.setSetting('lastImportAt', Date.now());
    return { added: added, updated: updated, skipped: skipped, media: mediaSaved, missing: missing, total: total };
  }

  global.DiaryBackup = { exportBackup: exportBackup, importBackup: importBackup };
})(window);
