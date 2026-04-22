/**
 * WDK DOCX Writer
 * Zero-dependency Word (.docx) file generator.
 * Creates valid OOXML WordprocessingML archives using a minimal ZIP writer.
 * Reuses CRC-32 + ZIP builder pattern from xlsx-writer.js.
 */
(function () {
  'use strict';
  if (typeof window.DK === 'undefined') window.DK = {};

  // ─── CRC-32 ────────────────────────────────────────────────────────
  var CRC32_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c;
    }
    return table;
  })();

  function crc32(data) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < data.length; i++) {
      crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // ─── UTF-8 + ZIP (STORE) ───────────────────────────────────────────
  function encodeUTF8(str) {
    var arr = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 0x80) { arr.push(code); }
      else if (code < 0x800) { arr.push(0xC0 | (code >> 6)); arr.push(0x80 | (code & 0x3F)); }
      else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
        var cp = ((code - 0xD800) << 10) + (str.charCodeAt(++i) - 0xDC00) + 0x10000;
        arr.push(0xF0 | (cp >> 18)); arr.push(0x80 | ((cp >> 12) & 0x3F));
        arr.push(0x80 | ((cp >> 6) & 0x3F)); arr.push(0x80 | (cp & 0x3F));
      } else { arr.push(0xE0 | (code >> 12)); arr.push(0x80 | ((code >> 6) & 0x3F)); arr.push(0x80 | (code & 0x3F)); }
    }
    return new Uint8Array(arr);
  }

  function writeU16LE(buf, o, v) { buf[o] = v & 0xFF; buf[o + 1] = (v >> 8) & 0xFF; }
  function writeU32LE(buf, o, v) { buf[o] = v & 0xFF; buf[o + 1] = (v >> 8) & 0xFF; buf[o + 2] = (v >> 16) & 0xFF; buf[o + 3] = (v >> 24) & 0xFF; }

  function buildZip(files) {
    var localHeaders = [], centralEntries = [], offset = 0;
    for (var i = 0; i < files.length; i++) {
      var nameBytes = encodeUTF8(files[i].name), fileData = files[i].data, fileCrc = crc32(fileData);
      var localSize = 30 + nameBytes.length + fileData.length;
      var local = new Uint8Array(localSize);
      local[0] = 0x50; local[1] = 0x4B; local[2] = 0x03; local[3] = 0x04;
      writeU16LE(local, 4, 20); writeU16LE(local, 6, 0x0800); writeU16LE(local, 8, 0);
      writeU16LE(local, 10, 0); writeU16LE(local, 12, 0);
      writeU32LE(local, 14, fileCrc); writeU32LE(local, 18, fileData.length); writeU32LE(local, 22, fileData.length);
      writeU16LE(local, 26, nameBytes.length); writeU16LE(local, 28, 0);
      local.set(nameBytes, 30); local.set(fileData, 30 + nameBytes.length);
      localHeaders.push(local);
      var central = new Uint8Array(46 + nameBytes.length);
      central[0] = 0x50; central[1] = 0x4B; central[2] = 0x01; central[3] = 0x02;
      writeU16LE(central, 4, 20); writeU16LE(central, 6, 20); writeU16LE(central, 8, 0x0800); writeU16LE(central, 10, 0);
      writeU16LE(central, 12, 0); writeU16LE(central, 14, 0);
      writeU32LE(central, 16, fileCrc); writeU32LE(central, 20, fileData.length); writeU32LE(central, 24, fileData.length);
      writeU16LE(central, 28, nameBytes.length); writeU16LE(central, 30, 0); writeU16LE(central, 32, 0);
      writeU16LE(central, 34, 0); writeU16LE(central, 36, 0); writeU32LE(central, 38, 0); writeU32LE(central, 42, offset);
      central.set(nameBytes, 46);
      centralEntries.push(central); offset += localSize;
    }
    var cdOffset = offset, cdSize = 0, j;
    for (j = 0; j < centralEntries.length; j++) cdSize += centralEntries[j].length;
    var eocd = new Uint8Array(22);
    eocd[0] = 0x50; eocd[1] = 0x4B; eocd[2] = 0x05; eocd[3] = 0x06;
    writeU16LE(eocd, 4, 0); writeU16LE(eocd, 6, 0); writeU16LE(eocd, 8, files.length);
    writeU16LE(eocd, 10, files.length); writeU32LE(eocd, 12, cdSize); writeU32LE(eocd, 16, cdOffset);
    var result = new Uint8Array(offset + cdSize + 22), pos = 0;
    for (j = 0; j < localHeaders.length; j++) { result.set(localHeaders[j], pos); pos += localHeaders[j].length; }
    for (j = 0; j < centralEntries.length; j++) { result.set(centralEntries[j], pos); pos += centralEntries[j].length; }
    result.set(eocd, pos); return result;
  }

  // ─── XML helpers ──────────────────────────────────────────────────
  var W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  var R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── WordprocessingML builders ────────────────────────────────────
  function wPara(text, opts) {
    var o = opts || {};
    var pPr = '', rPr = '';
    if (o.style) pPr += '<w:pStyle w:val="' + o.style + '"/>';
    if (o.center) pPr += '<w:jc w:val="center"/>';
    if (pPr) pPr = '<w:pPr>' + pPr + '</w:pPr>';
    if (o.bold) rPr = '<w:rPr><w:b/></w:rPr>';
    return '<w:p>' + pPr + '<w:r>' + rPr + '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r></w:p>';
  }

  function wBanner(text) {
    return wPara(text, { bold: true, center: true });
  }

  function wTable(headers, rows) {
    var bdr = ' w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
    var xml = '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>' +
      '<w:tblBorders><w:top' + bdr + '<w:left' + bdr + '<w:bottom' + bdr +
      '<w:right' + bdr + '<w:insideH' + bdr + '<w:insideV' + bdr + '</w:tblBorders></w:tblPr>';
    // Header row
    xml += '<w:tr>';
    for (var h = 0; h < headers.length; h++) {
      xml += '<w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>' + esc(headers[h]) + '</w:t></w:r></w:p></w:tc>';
    }
    xml += '</w:tr>';
    // Data rows
    for (var r = 0; r < rows.length; r++) {
      xml += '<w:tr>';
      for (var c = 0; c < headers.length; c++) {
        var val = c < rows[r].length ? rows[r][c] : '';
        xml += '<w:tc><w:p><w:r><w:t>' + esc(val) + '</w:t></w:r></w:p></w:tc>';
      }
      xml += '</w:tr>';
    }
    xml += '</w:tbl>';
    return xml;
  }

  // ─── DOCX XML parts ──────────────────────────────────────────────
  function makeContentTypes() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>';
  }

  function makeRootRels() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>';
  }

  function makeDocRels() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';
  }

  function makeStyles() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles ' + W_NS + '>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
      '<w:rPr><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
      '<w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>' +
      '<w:rPr><w:b/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>' +
      '<w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr>' +
      '<w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/>' +
      '<w:pPr><w:spacing w:before="160" w:after="60"/></w:pPr>' +
      '<w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>' +
      '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>' +
      '</w:styles>';
  }

  function makeDocument(bodyXml) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document ' + W_NS + ' ' + R_NS + '><w:body>' + bodyXml +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
      '</w:body></w:document>';
  }

  // ─── Main generate function ───────────────────────────────────────
  function generate(options) {
    var opts = options || {};
    var content = opts.content || [];
    var classification = opts.classification || '';
    var filename = opts.filename || 'export.docx';
    var body = '';

    // Leading classification banner
    if (classification) body += wBanner(classification);

    // Content blocks
    for (var i = 0; i < content.length; i++) {
      var block = content[i];
      var type = block.type || 'paragraph';

      if (type === 'banner') {
        body += wBanner(block.text || '');
      } else if (type === 'heading') {
        var lvl = Math.min(Math.max(block.level || 1, 1), 3);
        body += wPara(block.text || '', { style: 'Heading' + lvl });
      } else if (type === 'paragraph') {
        body += wPara(block.text || '', { bold: !!block.bold });
      } else if (type === 'table') {
        body += wTable(block.headers || [], block.rows || []);
      } else if (type === 'list') {
        var items = block.items || [];
        for (var li = 0; li < items.length; li++) {
          body += wPara('\u2022 ' + items[li]);
        }
      }
    }

    // Trailing classification banner
    if (classification) body += wBanner(classification);

    // Build ZIP
    var zipData = buildZip([
      { name: '[Content_Types].xml', data: encodeUTF8(makeContentTypes()) },
      { name: '_rels/.rels', data: encodeUTF8(makeRootRels()) },
      { name: 'word/document.xml', data: encodeUTF8(makeDocument(body)) },
      { name: 'word/_rels/document.xml.rels', data: encodeUTF8(makeDocRels()) },
      { name: 'word/styles.xml', data: encodeUTF8(makeStyles()) }
    ]);

    var blob = new Blob([zipData], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    return {
      blob: blob,
      download: function () {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    };
  }

  window.DK.docxWriter = { generate: generate };
})();
