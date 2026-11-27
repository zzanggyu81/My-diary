/* zip.js — 백업 파일(.zip) 만들기 / 풀기
   외부 라이브러리 없이 표준 ZIP(저장 방식, 필요하면 압축 해제도) 을 다룹니다.
   - 만들기: 사진·동영상은 이미 압축되어 있어서 그대로(무압축) 담습니다.
   - 풀기: 우리가 만든 ZIP 은 물론, PC 에서 다시 압축한 ZIP(Deflate)도 읽습니다. */
(function (global) {
  'use strict';

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    var c = 0xffffffff;
    for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosTime(d) {
    var time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
    var date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    return { time: time & 0xffff, date: date & 0xffff };
  }

  /**
   * files: [{ name: 'entries.json', data: Blob|Uint8Array }]
   * returns Blob(application/zip)
   */
  async function makeZip(files) {
    var parts = [];
    var central = [];
    var offset = 0;
    var enc = new TextEncoder();
    var now = new Date();
    var dt = dosTime(now);

    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var data = f.data instanceof Uint8Array
        ? f.data
        : new Uint8Array(await f.data.arrayBuffer());
      var nameU8 = enc.encode(f.name);
      var crc = crc32(data);

      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);          // version needed
      lh.setUint16(6, 0x0800, true);      // UTF-8 파일 이름
      lh.setUint16(8, 0, true);           // 방식: 저장
      lh.setUint16(10, dt.time, true);
      lh.setUint16(12, dt.date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, nameU8.length, true);
      lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), nameU8, data);

      var cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, dt.time, true);
      cd.setUint16(14, dt.date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, nameU8.length, true);
      cd.setUint16(30, 0, true);
      cd.setUint16(32, 0, true);
      cd.setUint16(34, 0, true);
      cd.setUint16(36, 0, true);
      cd.setUint32(38, 0, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), nameU8);

      offset += 30 + nameU8.length + data.length;
    }

    var cdStart = offset;
    var cdSize = 0;
    central.forEach(function (c) { cdSize += c.length; });

    var eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true);
    eocd.setUint16(6, 0, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, cdStart, true);
    eocd.setUint16(20, 0, true);

    var all = parts.concat(central, [new Uint8Array(eocd.buffer)]);
    return new Blob(all, { type: 'application/zip' });
  }

  /**
   * file: File|Blob  →  Map<파일이름, Blob>
   */
  async function readZip(file) {
    var buf = new Uint8Array(await file.arrayBuffer());
    var dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    var eocd = -1;
    var minPos = Math.max(0, buf.length - 65558);
    for (var i = buf.length - 22; i >= minPos; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP 파일이 아니에요.');

    var count = dv.getUint16(eocd + 10, true);
    var cdOff = dv.getUint32(eocd + 16, true);
    var dec = new TextDecoder('utf-8');
    var out = new Map();

    var p = cdOff;
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP 구조를 읽을 수 없어요.');
      var method = dv.getUint16(p + 10, true);
      var csize = dv.getUint32(p + 20, true);
      var nlen = dv.getUint16(p + 28, true);
      var elen = dv.getUint16(p + 30, true);
      var clen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true);
      var name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));

      var lnlen = dv.getUint16(lho + 26, true);
      var lelen = dv.getUint16(lho + 28, true);
      var dataStart = lho + 30 + lnlen + lelen;
      var raw = buf.slice(dataStart, dataStart + csize);

      if (name.charAt(name.length - 1) === '/') { p += 46 + nlen + elen + clen; continue; }

      var blob;
      if (method === 0) {
        blob = new Blob([raw]);
      } else if (method === 8) {
        if (typeof DecompressionStream === 'undefined') {
          throw new Error('이 브라우저는 압축된 ZIP 을 풀 수 없어요. 백업 파일을 압축하지 않은 상태로 다시 만들어 주세요.');
        }
        var stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        blob = await new Response(stream).blob();
      } else {
        throw new Error('지원하지 않는 압축 방식이에요 (method ' + method + ').');
      }
      out.set(name, blob);
      p += 46 + nlen + elen + clen;
    }
    return out;
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1500);
  }

  global.DiaryZip = { makeZip: makeZip, readZip: readZip, crc32: crc32, download: download };
})(window);
