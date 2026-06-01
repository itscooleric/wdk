/**
 * INSPECT-001: DOM Scraper
 * Click-to-select and CSS selector extraction of HTML tables from the host page.
 * Zero dependencies, var declarations, dk- prefixed CSS.
 */
(function () {
  'use strict';

  var HIGHLIGHT_CLASS = 'dk-scraper-highlight';
  var STYLE_ID = 'dk-scraper-style';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.' + HIGHLIGHT_CLASS + ' { outline: 3px solid #2563eb !important; outline-offset: 2px; cursor: crosshair !important; }';
    document.head.appendChild(style);
  }

  function removeStyles() {
    var el = document.getElementById(STYLE_ID);
    if (el) el.parentNode.removeChild(el);
  }

  /**
   * Extract an HTML <table> element into a DataFrame object.
   * @param {HTMLTableElement} table
   * @returns {{ headers: string[], rows: string[][] }}
   */
  function tableToDataFrame(table) {
    var headers = [];
    var rows = [];
    var headerRow = table.querySelector('thead tr') || table.querySelector('tr');

    if (headerRow) {
      var thCells = headerRow.querySelectorAll('th');
      if (thCells.length > 0) {
        for (var h = 0; h < thCells.length; h++) {
          headers.push(thCells[h].textContent.trim());
        }
      } else {
        // Fall back to td cells in first row as headers
        var tdCells = headerRow.querySelectorAll('td');
        for (var t = 0; t < tdCells.length; t++) {
          headers.push(tdCells[t].textContent.trim());
        }
      }
    }

    var tbody = table.querySelector('tbody') || table;
    var allRows = tbody.querySelectorAll('tr');
    var startIdx = 0;

    // Skip header row if it was the first tr (no thead)
    if (!table.querySelector('thead') && allRows.length > 0 && allRows[0] === headerRow) {
      startIdx = 1;
    }

    for (var r = startIdx; r < allRows.length; r++) {
      var cells = allRows[r].querySelectorAll('td');
      if (cells.length === 0) continue;
      var row = [];
      for (var c = 0; c < cells.length; c++) {
        row.push(cells[c].textContent.trim());
      }
      rows.push(row);
    }

    // Generate column headers if none found
    if (headers.length === 0 && rows.length > 0) {
      for (var i = 0; i < rows[0].length; i++) {
        headers.push('Column ' + (i + 1));
      }
    }

    return { headers: headers, rows: rows };
  }

  /**
   * Find the closest <table> ancestor (or self) from an element.
   * @param {HTMLElement} el
   * @returns {HTMLTableElement|null}
   */
  function findTable(el) {
    var current = el;
    while (current && current !== document.body) {
      if (current.tagName === 'TABLE') return current;
      current = current.parentElement;
    }
    return null;
  }

  /**
   * Create a DOM scraper instance.
   * @param {function} onData - Callback receiving a DataFrame object when a table is extracted.
   * @returns {{ startSelect: function, stopSelect: function, extractBySelector: function }}
   */
  function createDOMScraper(onData) {
    var active = false;
    var lastHighlighted = null;

    function onMouseOver(e) {
      var table = findTable(e.target);
      if (lastHighlighted && lastHighlighted !== table) {
        lastHighlighted.classList.remove(HIGHLIGHT_CLASS);
      }
      if (table) {
        table.classList.add(HIGHLIGHT_CLASS);
        lastHighlighted = table;
      }
    }

    function onMouseOut(e) {
      var table = findTable(e.target);
      if (table) {
        table.classList.remove(HIGHLIGHT_CLASS);
      }
      if (lastHighlighted === table) {
        lastHighlighted = null;
      }
    }

    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      var table = findTable(e.target);
      if (table) {
        if (lastHighlighted) {
          lastHighlighted.classList.remove(HIGHLIGHT_CLASS);
          lastHighlighted = null;
        }
        var data = tableToDataFrame(table);
        if (typeof onData === 'function') {
          onData(data);
        }
      }
    }

    function startSelect() {
      if (active) return;
      active = true;
      injectStyles();
      document.addEventListener('mouseover', onMouseOver, true);
      document.addEventListener('mouseout', onMouseOut, true);
      document.addEventListener('click', onClick, true);
    }

    function stopSelect() {
      if (!active) return;
      active = false;
      document.removeEventListener('mouseover', onMouseOver, true);
      document.removeEventListener('mouseout', onMouseOut, true);
      document.removeEventListener('click', onClick, true);
      if (lastHighlighted) {
        lastHighlighted.classList.remove(HIGHLIGHT_CLASS);
        lastHighlighted = null;
      }
      removeStyles();
    }

    /**
     * Extract a table by CSS selector.
     * @param {string} selector - CSS selector targeting a <table> element.
     * @returns {{ headers: string[], rows: string[][] }|null}
     */
    function extractBySelector(selector) {
      var el = document.querySelector(selector);
      if (!el) return null;
      var table = (el.tagName === 'TABLE') ? el : findTable(el);
      if (!table) return null;
      var data = tableToDataFrame(table);
      if (typeof onData === 'function') {
        onData(data);
      }
      return data;
    }

    return {
      startSelect: startSelect,
      stopSelect: stopSelect,
      extractBySelector: extractBySelector
    };
  }

  // Expose globally
  window.WDK = window.WDK || {};
  window.WDK.createDOMScraper = createDOMScraper;
})();
