/* media.js — 사진 썸네일, 동영상 첫 장면, 용량 표시 */
(function (global) {
  'use strict';

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      if (canvas.toBlob) {
        canvas.toBlob(function (b) { resolve(b || null); }, type, quality);
      } else {
        try {
          var url = canvas.toDataURL(type, quality);
          var base64 = url.split(',')[1] || '';
          var bin = atob(base64);
          var u8 = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          resolve(new Blob([u8], { type: type }));
        } catch (e) { resolve(null); }
      }
    });
  }

  function loadImage(file) {
    if (global.createImageBitmap) {
      return createImageBitmap(file).catch(function () { return loadImageElement(file); });
    }
    return loadImageElement(file);
  }

  function loadImageElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        resolve({ width: img.naturalWidth, height: img.naturalHeight, el: img, url: url });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('사진을 읽지 못했어요.')); };
      img.src = url;
    });
  }

  /** 긴 변이 max 픽셀인 작은 미리보기(JPG)를 만든다. 실패하면 null. */
  async function makeImageThumb(file, max) {
    max = max || 480;
    var src = null;
    try {
      src = await loadImage(file);
      var w0 = src.width || src.el.naturalWidth;
      var h0 = src.height || src.el.naturalHeight;
      if (!w0 || !h0) return null;
      var scale = Math.min(1, max / Math.max(w0, h0));
      var w = Math.max(1, Math.round(w0 * scale));
      var h = Math.max(1, Math.round(h0 * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(src.el || src, 0, 0, w, h);
      return await canvasToBlob(canvas, 'image/jpeg', 0.82);
    } catch (e) {
      return null;
    } finally {
      if (src) {
        if (src.close) src.close();
        if (src.url) URL.revokeObjectURL(src.url);
      }
    }
  }

  /** 동영상에서 첫 장면을 뽑아 미리보기 이미지로 만든다. */
  function makeVideoPoster(file, max) {
    max = max || 480;
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var video = document.createElement('video');
      var done = false;
      var timer = setTimeout(function () { finish(null, null); }, 8000);

      function finish(blob, duration) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { video.removeAttribute('src'); video.load(); } catch (e) {}
        URL.revokeObjectURL(url);
        resolve({ thumb: blob, duration: duration || 0 });
      }

      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');

      video.onloadeddata = function () {
        try {
          var d = video.duration;
          video.currentTime = isFinite(d) ? Math.min(0.3, d / 4) : 0.1;
        } catch (e) { draw(); }
      };
      video.onseeked = draw;
      video.onerror = function () { finish(null, video.duration || 0); };

      function draw() {
        try {
          var w0 = video.videoWidth, h0 = video.videoHeight;
          if (!w0 || !h0) return finish(null, video.duration || 0);
          var scale = Math.min(1, max / Math.max(w0, h0));
          var w = Math.max(1, Math.round(w0 * scale));
          var h = Math.max(1, Math.round(h0 * scale));
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(video, 0, 0, w, h);
          canvasToBlob(canvas, 'image/jpeg', 0.8).then(function (b) {
            finish(b, video.duration || 0);
          });
        } catch (e) {
          finish(null, video.duration || 0);
        }
      }

      video.src = url;
    });
  }

  function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function extension(mime, fallback) {
    var map = {
      'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
      'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif',
      'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp'
    };
    return map[mime] || fallback || 'bin';
  }

  global.DiaryMedia = {
    makeImageThumb: makeImageThumb,
    makeVideoPoster: makeVideoPoster,
    formatBytes: formatBytes,
    extension: extension
  };
})(window);
