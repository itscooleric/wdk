/**
 * WDK DOCX Reader — extracts text, tables, and metadata from .docx files.
 * Reuses the existing ZIP reader at src/parsers/zip.js (unzip function).
 * Zero dependencies, IIFE pattern, var only.
 *
 * API: DK.docxReader.parse(arrayBuffer) -> Promise<{text, paragraphs, tables, metadata}>
 */
(function() {
  "use strict";

  var DK = window.DK = window.DK || {};

  // --- XML helpers (string-based, no DOMParser) ---

  function findAll(xml, tag) {
    var results = [];
    var open = "<" + tag;
    var close = "</" + tag + ">";
    var selfClose = "/>";
    var idx = 0;
    while (idx < xml.length) {
      var start = xml.indexOf(open, idx);
      if (start === -1) break;
      var afterTag = start + open.length;
      var ch = xml.charAt(afterTag);
      if (ch !== " " && ch !== ">" && ch !== "/") { idx = afterTag; continue; }
      var endSelf = xml.indexOf(selfClose, afterTag);
      var endClose = xml.indexOf(close, afterTag);
      var end;
      if (endClose === -1 && endSelf === -1) break;
      if (endClose === -1) { end = endSelf + selfClose.length; }
      else if (endSelf === -1) { end = endClose + close.length; }
      else if (endSelf < endClose) {
        var gt = xml.indexOf(">", afterTag);
        if (gt === endSelf + 1) { end = endSelf + selfClose.length; }
        else { end = endClose + close.length; }
      } else { end = endClose + close.length; }
      results.push(xml.substring(start, end));
      idx = end;
    }
    return results;
  }

  function innerContent(xml, tag) {
    var open = "<" + tag;
    var start = xml.indexOf(open);
    if (start === -1) return "";
    var gt = xml.indexOf(">", start + open.length);
    if (gt === -1) return "";
    if (xml.charAt(gt - 1) === "/") return "";
    var close = "</" + tag + ">";
    var end = xml.indexOf(close, gt);
    if (end === -1) return "";
    return xml.substring(gt + 1, end);
  }

  function attrVal(xml, attr) {
    var pat = attr + '="';
    var idx = xml.indexOf(pat);
    if (idx === -1) return "";
    var start = idx + pat.length;
    var end = xml.indexOf('"', start);
    if (end === -1) return "";
    return xml.substring(start, end);
  }

  function extractText(xml) {
    var parts = [];
    var wts = findAll(xml, "w:t");
    for (var i = 0; i < wts.length; i++) {
      var gt = wts[i].indexOf(">");
      if (gt === -1) continue;
      var close = wts[i].lastIndexOf("</w:t>");
      if (close === -1) continue;
      parts.push(wts[i].substring(gt + 1, close));
    }
    return parts.join("");
  }

  // --- DOCX parsing ---

  function parseParagraphs(docXml) {
    var paragraphs = [];
    var pBlocks = findAll(docXml, "w:p");
    for (var i = 0; i < pBlocks.length; i++) {
      var p = pBlocks[i];
      var style = "Normal";
      var pStyleIdx = p.indexOf("<w:pStyle");
      if (pStyleIdx !== -1) {
        var val = attrVal(p.substring(pStyleIdx), "w:val");
        if (val) style = val;
      }
      var text = extractText(p);
      paragraphs.push({ text: text, style: style });
    }
    return paragraphs;
  }

  function parseTables(docXml) {
    var tables = [];
    var tblBlocks = findAll(docXml, "w:tbl");
    for (var i = 0; i < tblBlocks.length; i++) {
      var tbl = tblBlocks[i];
      var rows = findAll(tbl, "w:tr");
      var rowData = [];
      for (var r = 0; r < rows.length; r++) {
        var cells = findAll(rows[r], "w:tc");
        var cellTexts = [];
        for (var c = 0; c < cells.length; c++) {
          cellTexts.push(extractText(cells[c]));
        }
        rowData.push(cellTexts);
      }
      var headers = rowData.length > 0 ? rowData[0] : [];
      var dataRows = rowData.length > 1 ? rowData.slice(1) : [];
      tables.push({ headers: headers, rows: dataRows });
    }
    return tables;
  }

  function parseMetadata(coreXml) {
    if (!coreXml) return { title: "", author: "" };
    return {
      title: innerContent(coreXml, "dc:title") || innerContent(coreXml, "dcterms:title") || "",
      author: innerContent(coreXml, "dc:creator") || innerContent(coreXml, "cp:lastModifiedBy") || ""
    };
  }

  // --- Main API ---

  DK.docxReader = {
    parse: function(arrayBuffer) {
      return unzip(arrayBuffer).then(function(entries) {
        var docXml = "";
        var coreXml = "";
        var decoder = new TextDecoder();

        if (entries.has("word/document.xml")) {
          docXml = decoder.decode(entries.get("word/document.xml"));
        }
        if (entries.has("docProps/core.xml")) {
          coreXml = decoder.decode(entries.get("docProps/core.xml"));
        }

        if (!docXml) {
          return { text: "", paragraphs: [], tables: [], metadata: { title: "", author: "" } };
        }

        var paragraphs = parseParagraphs(docXml);
        var tables = parseTables(docXml);
        var metadata = parseMetadata(coreXml);
        var textParts = [];
        for (var i = 0; i < paragraphs.length; i++) {
          textParts.push(paragraphs[i].text);
        }

        return {
          text: textParts.join("\n"),
          paragraphs: paragraphs,
          tables: tables,
          metadata: metadata
        };
      })["catch"](function() {
        return { text: "", paragraphs: [], tables: [], metadata: { title: "", author: "" } };
      });
    }
  };

})();
