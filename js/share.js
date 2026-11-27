/* share.js — 일기 한 편을 '혼자 열리는 HTML 파일'로 내보내기
   사진과 동영상이 파일 안에 함께 들어가서, 그 파일만 있으면 누구나 볼 수 있어요.
   (서버나 로그인이 필요 없고, 카카오톡·메일로 파일을 보내면 됩니다.) */
(function (global) {
  'use strict';

  var WEEK = ['일', '월', '화', '수', '목', '금', '토'];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function prettyDate(dateStr) {
    var p = String(dateStr || '').split('-');
    if (p.length !== 3) return dateStr || '';
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return p[0] + '년 ' + (+p[1]) + '월 ' + (+p[2]) + '일 ' + WEEK[d.getDay()] + '요일';
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('사진을 읽지 못했어요.')); };
      fr.readAsDataURL(blob);
    });
  }

  function moodEmoji(entry) {
    return entry.mood || '';
  }

  async function buildEntryHtml(entry, media) {
    var blocks = [];
    for (var i = 0; i < media.length; i++) {
      var m = media[i];
      var src = await blobToDataUrl(m.blob);
      if (m.type === 'video') {
        blocks.push(
          '<figure class="media"><video controls playsinline preload="metadata" src="' + src + '"></video></figure>'
        );
      } else {
        blocks.push(
          '<figure class="media"><img alt="' + esc(m.name || '사진') + '" src="' + src + '"></figure>'
        );
      }
    }

    var tags = (entry.tags || []).map(function (t) {
      return '<span class="tag">#' + esc(t) + '</span>';
    }).join('');

    var bodyHtml = esc(entry.body || '').replace(/\n/g, '<br>');
    var title = entry.title && entry.title.trim() ? esc(entry.title) : '제목 없는 하루';

    return '<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<meta name="robots" content="noindex">\n' +
      '<title>' + title + ' · ' + esc(entry.date) + '</title>\n' +
      '<style>\n' + shareCss() + '</style>\n</head>\n<body>\n<main class="wrap">\n' +
      '<p class="date">' + esc(prettyDate(entry.date)) + '</p>\n' +
      (moodEmoji(entry) ? '<p class="mood">' + esc(moodEmoji(entry)) + '</p>\n' : '') +
      '<h1 class="title">' + title + '</h1>\n' +
      (bodyHtml ? '<div class="body">' + bodyHtml + '</div>\n' : '') +
      (blocks.length ? '<div class="medias">' + blocks.join('') + '</div>\n' : '') +
      (tags ? '<div class="tags">' + tags + '</div>\n' : '') +
      '<footer class="foot">내 일기 · ' + esc(prettyDate(entry.date)) + '</footer>\n' +
      '</main>\n</body>\n</html>\n';
  }

  function shareCss() {
    return [
      ':root{--ink:#2f2b26;--ink2:#6f665a;--line:#e8dfd0;--accent:#c96f4a}',
      '*{box-sizing:border-box}',
      'body{margin:0;background:#fbf6ee;color:var(--ink);',
      'font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Noto Sans KR",sans-serif;',
      'font-size:17px;line-height:1.85;-webkit-text-size-adjust:100%}',
      '.wrap{max-width:680px;margin:0 auto;padding:44px 22px 60px}',
      '.date{font-size:14px;font-weight:700;color:var(--accent);letter-spacing:.2px;margin:0 0 6px}',
      '.mood{font-size:40px;line-height:1;margin:6px 0 4px}',
      '.title{font-size:27px;font-weight:800;letter-spacing:-.5px;line-height:1.35;margin:8px 0 20px}',
      '.body{font-size:17px;color:#3b352e;word-break:break-word}',
      '.medias{display:flex;flex-direction:column;gap:14px;margin:26px 0 8px}',
      '.media{margin:0}',
      '.media img,.media video{width:100%;display:block;border-radius:14px;background:#000}',
      '.tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:26px}',
      '.tag{font-size:13px;font-weight:600;color:#a9522f;background:#f7e4d9;padding:4px 10px;border-radius:999px}',
      '.foot{margin-top:46px;padding-top:16px;border-top:1px solid var(--line);',
      'font-size:12.5px;color:#a1968a}',
      '@media (min-width:720px){body{background:#f3ebdf}.wrap{background:#fbf6ee;border-radius:20px;margin-top:30px;',
      'box-shadow:0 10px 40px rgba(90,70,45,.08)}}'
    ].join('\n');
  }

  function safeName(s, max) {
    return String(s || '').replace(/[\\/:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 40);
  }

  async function downloadEntry(entry) {
    var metas = await DiaryDB.mediaFor(entry.id);
    var media = [];
    for (var i = 0; i < metas.length; i++) {
      var rec = await DiaryDB.getBlob(metas[i].id);
      if (rec && rec.blob) media.push({ meta: metas[i], blob: rec.blob, type: metas[i].type, name: metas[i].name });
    }
    var html = await buildEntryHtml(entry, media);
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var datePart = (entry.date || '').replace(/-/g, '');
    var titlePart = safeName(entry.title, 24);
    var name = '일기-' + datePart + (titlePart ? '-' + titlePart : '') + '.html';
    DiaryZip.download(blob, name);
    return { filename: name, bytes: blob.size, mediaCount: media.length };
  }

  global.DiaryShare = { buildEntryHtml: buildEntryHtml, downloadEntry: downloadEntry, prettyDate: prettyDate };
})(window);
