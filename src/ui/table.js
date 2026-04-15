/**
 * WDK table renderer with virtual scrolling.
 * Renders a DataFrame into a sortable, scrollable HTML table.
 * Only renders visible rows + buffer for million-row performance.
 * Synthwave 84 dark theme. Zero external dependencies.
 */

var DK_TABLE_THEME = {
  bg: '#0a0a1a',
  bgAlt: '#0f0f24',
  bgHeader: '#12122a',
  bgHover: '#1a1a3a',
  cyan: '#00e5ff',
  pink: '#ff2975',
  purple: '#b967ff',
  text: '#e0e0f0',
  textDim: '#8888aa',
  border: '#2a2a4a',
};

var DK_ROW_HEIGHT = 24;
var DK_BUFFER_ROWS = 20;

/**
 * Parse a filter expression and return a predicate function.
 * Supports: >, <, >=, <=, =, != (numeric), ~ (regex), ! (NOT contains),
 * or plain substring (case-insensitive).
 */
function parseFilterExpr(expr) {
  if (!expr || expr === '') return null;

  // Regex match: ~pattern
  if (expr.charAt(0) === '~') {
    var pattern = expr.substring(1);
    try {
      var re = new RegExp(pattern, 'i');
      return function (val) {
        return re.test(val === null || val === undefined ? '' : String(val));
      };
    } catch (e) {
      return null; // invalid regex — treat as no filter
    }
  }

  // NOT contains: !text
  if (expr.charAt(0) === '!' && expr.charAt(1) !== '=') {
    var neg = expr.substring(1).toLowerCase();
    return function (val) {
      var s = val === null || val === undefined ? '' : String(val).toLowerCase();
      return s.indexOf(neg) === -1;
    };
  }

  // Numeric comparisons: >=, <=, !=, >, <, =
  var numMatch = expr.match(/^(>=|<=|!=|>|<|=)\s*(.+)$/);
  if (numMatch) {
    var op = numMatch[1];
    var num = parseFloat(numMatch[2]);
    if (!isNaN(num)) {
      return function (val) {
        var n = parseFloat(val);
        if (isNaN(n)) return false;
        switch (op) {
          case '>': return n > num;
          case '<': return n < num;
          case '>=': return n >= num;
          case '<=': return n <= num;
          case '=': return n === num;
          case '!=': return n !== num;
          default: return true;
        }
      };
    }
  }

  // Default: case-insensitive substring
  var lower = expr.toLowerCase();
  return function (val) {
    var s = val === null || val === undefined ? '' : String(val).toLowerCase();
    return s.indexOf(lower) !== -1;
  };
}

function injectTableStyles() {
  if (document.getElementById('dk-table-styles')) return;
  var style = document.createElement('style');
  style.id = 'dk-table-styles';
  style.textContent = [
    '.dk-table-wrap {',
    '  overflow-y: auto; overflow-x: auto; max-height: 100%;',
    '  scrollbar-width: thin; scrollbar-color: ' + DK_TABLE_THEME.border + ' ' + DK_TABLE_THEME.bg + ';',
    '  position: relative;',
    '}',
    '.dk-table-wrap::-webkit-scrollbar { width: 6px; height: 6px; }',
    '.dk-table-wrap::-webkit-scrollbar-track { background: ' + DK_TABLE_THEME.bg + '; }',
    '.dk-table-wrap::-webkit-scrollbar-thumb { background: ' + DK_TABLE_THEME.border + '; border-radius: 3px; }',
    '.dk-table {',
    '  width: 100%; border-collapse: collapse;',
    '  font-family: "SF Mono", "Fira Code", "Consolas", monospace;',
    '  font-size: 12px; color: ' + DK_TABLE_THEME.text + ';',
    '}',
    '.dk-table th {',
    '  position: sticky; top: 0; z-index: 2;',
    '  background: ' + DK_TABLE_THEME.bgHeader + ';',
    '  color: ' + DK_TABLE_THEME.cyan + ';',
    '  padding: 5px 8px; text-align: left;',
    '  border-bottom: 2px solid ' + DK_TABLE_THEME.border + ';',
    '  cursor: pointer; white-space: nowrap; user-select: none;',
    '  font-weight: 600; font-size: 11px; letter-spacing: 0.5px;',
    '  text-transform: uppercase;',
    '}',
    '.dk-table th:hover { color: ' + DK_TABLE_THEME.pink + '; }',
    '.dk-table th .dk-sort-arrow { font-size: 10px; margin-left: 4px; opacity: 0.7; }',
    '.dk-table td {',
    '  padding: 3px 8px; height: ' + DK_ROW_HEIGHT + 'px; box-sizing: border-box;',
    '  border-bottom: 1px solid ' + DK_TABLE_THEME.border + ';',
    '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
    '  max-width: 280px;',
    '}',
    '.dk-table tr:nth-child(even) td { background: ' + DK_TABLE_THEME.bgAlt + '; }',
    '.dk-table tr:hover td { background: ' + DK_TABLE_THEME.bgHover + '; }',
    '.dk-table td.dk-row-num {',
    '  color: ' + DK_TABLE_THEME.textDim + '; text-align: right;',
    '  width: 40px; min-width: 40px; padding-right: 10px;',
    '  border-right: 1px solid ' + DK_TABLE_THEME.border + ';',
    '}',
    '.dk-table-empty {',
    '  padding: 24px; text-align: center; color: ' + DK_TABLE_THEME.textDim + ';',
    '  font-style: italic;',
    '}',
    '.dk-vscroll-spacer { display: block; }',
    '.dk-row-count {',
    '  position: absolute; bottom: 4px; right: 12px; font-size: 10px;',
    '  color: ' + DK_TABLE_THEME.textDim + '; pointer-events: none; z-index: 3;',
    '}',
    '.dk-copy-btn {',
    '  position: absolute; top: 4px; right: 12px; z-index: 4;',
    '  background: transparent; color: ' + DK_TABLE_THEME.textDim + ';',
    '  border: 1px solid ' + DK_TABLE_THEME.border + '; border-radius: 2px;',
    '  padding: 2px 8px; font-size: 10px; cursor: pointer;',
    '  font-family: inherit; letter-spacing: 0.5px;',
    '}',
    '.dk-copy-btn:hover { color: ' + DK_TABLE_THEME.cyan + '; border-color: ' + DK_TABLE_THEME.cyan + '; }',
    '.dk-filter-row { background: #0d0d20; }',
    '.dk-filter-row th {',
    '  position: sticky; top: 28px; z-index: 2;',
    '  background: #0d0d20;',
    '  padding: 3px 4px; border-bottom: 1px solid ' + DK_TABLE_THEME.border + ';',
    '  cursor: default; text-transform: none; letter-spacing: 0;',
    '  font-weight: normal;',
    '}',
    '.dk-filter-input {',
    '  width: 100%; box-sizing: border-box;',
    '  background: #12122a; color: #e0e0f0;',
    '  border: 1px solid #2a2a4a; border-radius: 2px;',
    '  padding: 2px 4px; font-size: 11px;',
    '  font-family: "SF Mono", "Fira Code", "Consolas", monospace;',
    '  outline: none;',
    '}',
    '.dk-filter-input::placeholder { color: #555577; }',
    '.dk-filter-input.dk-filter-active {',
    '  border-color: #00e5ff;',
    '  box-shadow: 0 0 4px rgba(0,229,255,0.3);',
    '}',
    '.dk-clear-filters {',
    '  position: absolute; top: 4px; right: 80px; z-index: 4;',
    '  background: transparent; color: ' + DK_TABLE_THEME.textDim + ';',
    '  border: 1px solid ' + DK_TABLE_THEME.border + '; border-radius: 2px;',
    '  padding: 2px 8px; font-size: 10px; cursor: pointer;',
    '  font-family: inherit; letter-spacing: 0.5px; display: none;',
    '}',
    '.dk-clear-filters:hover { color: ' + DK_TABLE_THEME.pink + '; border-color: ' + DK_TABLE_THEME.pink + '; }',
    '.dk-table td:focus-visible, .dk-table th:focus-visible {',
    '  outline: 2px solid #00e5ff;',
    '  outline-offset: 2px;',
    '}',
    '.dk-cell-null {',
    '  color: #666688; font-style: italic; opacity: 0.7;',
    '}',
    '.dk-row-selected td { background: rgba(0, 229, 255, 0.08) !important; }',
    '.dk-selection-bar {',
    '  font-size: 10px; color: ' + DK_TABLE_THEME.textDim + ';',
    '  padding: 4px 12px; display: none;',
    '}',
    '.dk-selection-bar button {',
    '  background: transparent; color: ' + DK_TABLE_THEME.textDim + ';',
    '  border: 1px solid ' + DK_TABLE_THEME.border + '; border-radius: 2px;',
    '  padding: 1px 6px; font-size: 10px; cursor: pointer;',
    '  font-family: inherit; margin-left: 8px;',
    '}',
    '.dk-selection-bar button:hover { color: ' + DK_TABLE_THEME.pink + '; border-color: ' + DK_TABLE_THEME.pink + '; }',
  ].join('\n');
  document.head.appendChild(style);
}

/**
 * Render a DataFrame into a virtualized HTML table inside a container element.
 *
 * @param {HTMLElement} container - The element to render into (will be cleared)
 * @param {DataFrame} df - The DataFrame to render
 * @param {Function} [onSort] - Callback: onSort(columnName, ascending)
 * @returns {{ refresh: Function }} - Call refresh(newDataFrame) to re-render
 */
function renderTable(container, df, onSort) {
  injectTableStyles();

  var sortCol = null;
  var sortAsc = true;
  var filterState = {};   // { colName: inputValue }
  var filterInputs = {};  // { colName: HTMLInputElement } — survives re-render
  var selectedRows = new Set();  // indices into filteredRows
  var lastClickedRow = null;     // for shift-range select

  function render(dt) {
    container.innerHTML = '';

    var headers = dt._headers;
    var allRows = dt._rows;

    if (!headers || headers.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'dk-table-empty';
      empty.textContent = 'No data loaded';
      container.appendChild(empty);
      return;
    }

    var totalRowCount = allRows.length;

    // --- Filtering ---
    var filteredRows = allRows;
    var activeFilterCount = 0;

    function applyFilters() {
      filteredRows = allRows;
      activeFilterCount = 0;
      for (var ci = 0; ci < headers.length; ci++) {
        var expr = filterState[headers[ci]];
        if (!expr) continue;
        var pred = parseFilterExpr(expr);
        if (!pred) continue;
        activeFilterCount++;
        var colIdx = ci;
        filteredRows = filteredRows.filter(function (row) {
          return pred(row[colIdx]);
        });
      }
      // Apply sort after filtering
      if (sortCol !== null) {
        var si = headers.indexOf(sortCol);
        if (si >= 0) {
          var asc = sortAsc;
          filteredRows = filteredRows.slice().sort(function (a, b) {
            var va = a[si], vb = b[si];
            if (va == null) va = '';
            if (vb == null) vb = '';
            var na = parseFloat(va), nb = parseFloat(vb);
            var cmp;
            if (!isNaN(na) && !isNaN(nb)) {
              cmp = na - nb;
            } else {
              cmp = String(va).localeCompare(String(vb));
            }
            return asc ? cmp : -cmp;
          });
        }
      }
    }

    applyFilters();

    var wrap = document.createElement('div');
    wrap.className = 'dk-table-wrap';
    wrap.style.maxHeight = '100%';

    var table = document.createElement('table');
    table.className = 'dk-table';
    table.setAttribute('role', 'grid');

    // Header row
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    headRow.setAttribute('role', 'row');

    var thNum = document.createElement('th');
    thNum.textContent = '#';
    thNum.style.cursor = 'default';
    thNum.setAttribute('role', 'columnheader');
    headRow.appendChild(thNum);

    headers.forEach(function (colName, colIdx) {
      var th = document.createElement('th');
      th.setAttribute('role', 'columnheader');
      th.setAttribute('tabindex', '0');
      if (sortCol === colName) {
        th.setAttribute('aria-sort', sortAsc ? 'ascending' : 'descending');
      } else {
        th.setAttribute('aria-sort', 'none');
      }
      var label = document.createTextNode(colName);
      th.appendChild(label);

      // Type badge tooltip
      var colType = 'str';
      if (typeof detectColumnType === 'function') {
        var sampleVals = [];
        for (var si = 0; si < Math.min(allRows.length, 100); si++) {
          sampleVals.push(allRows[si][colIdx]);
        }
        colType = detectColumnType(sampleVals);
      } else {
        var numCount = 0;
        var boolCount = 0;
        var sampleLen = Math.min(allRows.length, 100);
        for (var si = 0; si < sampleLen; si++) {
          var sv = allRows[si][colIdx];
          if (sv === null || sv === undefined || sv === '') continue;
          if (!isNaN(parseFloat(sv)) && isFinite(sv)) numCount++;
          if (sv === true || sv === false || sv === 'true' || sv === 'false') boolCount++;
        }
        if (boolCount > sampleLen * 0.5) colType = 'bool';
        else if (numCount > sampleLen * 0.5) colType = 'num';
      }
      th.title = colName + ' (type: ' + colType + ')';

      if (sortCol === colName) {
        var arrow = document.createElement('span');
        arrow.className = 'dk-sort-arrow';
        arrow.textContent = sortAsc ? '\u25b2' : '\u25bc';
        th.appendChild(arrow);
      }

      function doSort() {
        if (sortCol === colName) {
          if (!sortAsc) {
            // Third click: remove sort
            sortCol = null;
            sortAsc = true;
          } else {
            sortAsc = false;
          }
        } else {
          sortCol = colName;
          sortAsc = true;
        }
        rebuildSorted();
        if (onSort) onSort(sortCol, sortAsc);
      }

      th.addEventListener('click', doSort);
      th.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          doSort();
        }
      });

      headRow.appendChild(th);
    });

    thead.appendChild(headRow);

    // Filter row
    var filterRow = document.createElement('tr');
    filterRow.className = 'dk-filter-row';
    filterRow.setAttribute('role', 'row');

    var filterNumTh = document.createElement('th');
    filterNumTh.style.cursor = 'default';
    filterRow.appendChild(filterNumTh);

    var debounceTimer = null;

    headers.forEach(function (colName) {
      var th = document.createElement('th');
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'dk-filter-input';
      input.placeholder = 'filter...';
      input.setAttribute('aria-label', 'Filter ' + colName);

      // Restore previous filter value
      if (filterState[colName]) {
        input.value = filterState[colName];
        input.classList.add('dk-filter-active');
      }

      filterInputs[colName] = input;

      input.addEventListener('input', function () {
        var val = input.value;
        filterState[colName] = val;

        if (val) {
          input.classList.add('dk-filter-active');
        } else {
          input.classList.remove('dk-filter-active');
        }

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          rebuildFiltered();
        }, 200);
      });

      // Stop click from propagating to sort handler
      input.addEventListener('click', function (e) { e.stopPropagation(); });

      th.appendChild(input);
      filterRow.appendChild(th);
    });

    thead.appendChild(filterRow);
    table.appendChild(thead);

    // Body — virtual scroll
    var tbody = document.createElement('tbody');
    table.appendChild(tbody);
    wrap.appendChild(table);

    // Top spacer for virtual scroll offset
    var topSpacer = document.createElement('tr');
    var topTd = document.createElement('td');
    topTd.colSpan = headers.length + 1;
    topTd.className = 'dk-vscroll-spacer';
    topTd.style.cssText = 'padding:0;border:none;height:0;';
    topSpacer.appendChild(topTd);

    // Bottom spacer
    var bottomSpacer = document.createElement('tr');
    var bottomTd = document.createElement('td');
    bottomTd.colSpan = headers.length + 1;
    bottomTd.className = 'dk-vscroll-spacer';
    bottomTd.style.cssText = 'padding:0;border:none;height:0;';
    bottomSpacer.appendChild(bottomTd);

    // Row count badge
    var badge = document.createElement('div');
    badge.className = 'dk-row-count';

    function updateBadge() {
      if (activeFilterCount > 0) {
        badge.textContent = 'Showing ' + filteredRows.length.toLocaleString() + ' of ' + totalRowCount.toLocaleString() + ' rows';
      } else {
        badge.textContent = totalRowCount.toLocaleString() + ' rows';
      }
    }

    updateBadge();

    // Clear all filters button
    var clearBtn = document.createElement('button');
    clearBtn.className = 'dk-clear-filters';
    clearBtn.textContent = 'Clear filters';
    clearBtn.style.display = activeFilterCount > 0 ? 'block' : 'none';
    clearBtn.addEventListener('click', function () {
      filterState = {};
      for (var key in filterInputs) {
        if (filterInputs.hasOwnProperty(key)) {
          filterInputs[key].value = '';
          filterInputs[key].classList.remove('dk-filter-active');
        }
      }
      rebuildFiltered();
    });

    var lastStart = -1;
    var lastEnd = -1;

    function renderVisibleRows() {
      var rows = filteredRows;
      var totalRows = rows.length;
      var scrollTop = wrap.scrollTop;
      var viewHeight = wrap.clientHeight;
      var headerHeight = thead.offsetHeight || 30;

      var start = Math.max(0, Math.floor((scrollTop - headerHeight) / DK_ROW_HEIGHT) - DK_BUFFER_ROWS);
      var visibleCount = Math.ceil(viewHeight / DK_ROW_HEIGHT) + DK_BUFFER_ROWS * 2;
      var end = Math.min(totalRows, start + visibleCount);

      if (start === lastStart && end === lastEnd) return;
      lastStart = start;
      lastEnd = end;

      // Update spacers
      topTd.style.height = (start * DK_ROW_HEIGHT) + 'px';
      bottomTd.style.height = ((totalRows - end) * DK_ROW_HEIGHT) + 'px';

      // Clear and rebuild visible rows
      tbody.innerHTML = '';
      tbody.appendChild(topSpacer);

      for (var i = start; i < end; i++) {
        var row = rows[i];
        var tr = document.createElement('tr');
        tr.setAttribute('role', 'row');

        var tdNum = document.createElement('td');
        tdNum.className = 'dk-row-num';
        tdNum.setAttribute('role', 'gridcell');
        tdNum.textContent = String(i + 1);
        tr.appendChild(tdNum);

        for (var c = 0; c < headers.length; c++) {
          var td = document.createElement('td');
          td.setAttribute('role', 'gridcell');
          td.setAttribute('tabindex', '-1');
          var val = row[c];
          if (val === null || val === undefined) {
            td.textContent = 'null';
            td.className = 'dk-cell-null';
            td.title = 'null';
          } else {
            td.textContent = String(val);
            td.title = td.textContent;
          }
          tr.appendChild(td);
        }

        if (selectedRows.has(i)) {
          tr.classList.add('dk-row-selected');
        }

        (function (rowIdx) {
          tr.addEventListener('click', function (ev) {
            if (ev.shiftKey && lastClickedRow !== null) {
              var lo = Math.min(lastClickedRow, rowIdx);
              var hi = Math.max(lastClickedRow, rowIdx);
              for (var ri = lo; ri <= hi; ri++) {
                selectedRows.add(ri);
              }
            } else {
              if (selectedRows.has(rowIdx)) {
                selectedRows.delete(rowIdx);
              } else {
                selectedRows.add(rowIdx);
              }
            }
            lastClickedRow = rowIdx;
            lastStart = -1;
            lastEnd = -1;
            renderVisibleRows();
            updateSelectionBar();
          });
        })(i);

        tbody.appendChild(tr);
      }

      tbody.appendChild(bottomSpacer);
    }

    function rebuildFiltered() {
      applyFilters();
      updateBadge();
      clearBtn.style.display = activeFilterCount > 0 ? 'block' : 'none';
      lastStart = -1;
      lastEnd = -1;
      renderVisibleRows();
    }

    function rebuildSorted() {
      applyFilters();
      updateBadge();
      lastStart = -1;
      lastEnd = -1;
      // Re-render headers to update sort arrow
      render(dt);
    }

    // Copy to clipboard button (TSV for Excel paste)
    var copyBtn = document.createElement('button');
    copyBtn.className = 'dk-copy-btn';
    copyBtn.textContent = 'Copy TSV';
    copyBtn.title = 'Copy table as tab-separated values (paste into Excel)';
    copyBtn.addEventListener('click', function () {
      var rows = filteredRows;
      var lines = [headers.join('\t')];
      for (var r = 0; r < rows.length; r++) {
        lines.push(rows[r].map(function (v) { return v == null ? '' : String(v); }).join('\t'));
      }
      var tsv = lines.join('\n');
      if (typeof copyToClipboard === 'function') {
        copyToClipboard(tsv).then(function () {
          copyBtn.textContent = 'Copied!';
          setTimeout(function () { copyBtn.textContent = 'Copy TSV'; }, 1500);
        });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(tsv).then(function () {
          copyBtn.textContent = 'Copied!';
          setTimeout(function () { copyBtn.textContent = 'Copy TSV'; }, 1500);
        });
      }
    });

    // Keyboard navigation: arrow keys move between cells
    table.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var cell = document.activeElement;
      if (!cell || (cell.tagName !== 'TD' && cell.tagName !== 'TH')) return;
      var tr = cell.parentElement;
      if (!tr) return;
      var cellIdx = Array.prototype.indexOf.call(tr.children, cell);
      e.preventDefault();
      if (e.key === 'ArrowLeft' && cellIdx > 0) {
        var prev = tr.children[cellIdx - 1];
        if (prev) { prev.setAttribute('tabindex', '0'); prev.focus(); cell.setAttribute('tabindex', '-1'); }
      } else if (e.key === 'ArrowRight' && cellIdx < tr.children.length - 1) {
        var next = tr.children[cellIdx + 1];
        if (next) { next.setAttribute('tabindex', '0'); next.focus(); cell.setAttribute('tabindex', '-1'); }
      } else if (e.key === 'ArrowUp') {
        var prevRow = tr.previousElementSibling;
        if (prevRow && prevRow.children[cellIdx]) { prevRow.children[cellIdx].setAttribute('tabindex', '0'); prevRow.children[cellIdx].focus(); cell.setAttribute('tabindex', '-1'); }
      } else if (e.key === 'ArrowDown') {
        var nextRow = tr.nextElementSibling;
        if (nextRow && nextRow.children[cellIdx]) { nextRow.children[cellIdx].setAttribute('tabindex', '0'); nextRow.children[cellIdx].focus(); cell.setAttribute('tabindex', '-1'); }
      }
    });

    // Selection summary bar
    var selectionBar = document.createElement('div');
    selectionBar.className = 'dk-selection-bar';

    function updateSelectionBar() {
      if (selectedRows.size === 0) {
        selectionBar.style.display = 'none';
        return;
      }
      selectionBar.style.display = 'block';
      var parts = [];
      parts.push(selectedRows.size + ' rows selected');

      // Compute SUM/AVG for numeric columns
      for (var ci = 0; ci < headers.length; ci++) {
        var sum = 0;
        var count = 0;
        var isNumeric = true;
        var iter = selectedRows.values();
        var next = iter.next();
        while (!next.done) {
          var rv = filteredRows[next.value];
          if (rv) {
            var nv = parseFloat(rv[ci]);
            if (isNaN(nv)) { isNumeric = false; break; }
            sum += nv;
            count++;
          }
          next = iter.next();
        }
        if (isNumeric && count > 0) {
          var avg = sum / count;
          parts.push(headers[ci] + ': SUM=' + sum.toLocaleString(undefined, { maximumFractionDigits: 4 }) + ' AVG=' + avg.toLocaleString(undefined, { maximumFractionDigits: 4 }));
        }
      }

      selectionBar.innerHTML = '';
      var textSpan = document.createElement('span');
      textSpan.textContent = parts.join(' | ');
      selectionBar.appendChild(textSpan);

      var clearSelBtn = document.createElement('button');
      clearSelBtn.textContent = 'Clear selection';
      clearSelBtn.addEventListener('click', function () {
        selectedRows.clear();
        lastClickedRow = null;
        lastStart = -1;
        lastEnd = -1;
        renderVisibleRows();
        updateSelectionBar();
      });
      selectionBar.appendChild(clearSelBtn);
    }

    container.appendChild(wrap);
    container.style.position = 'relative';
    container.appendChild(selectionBar);
    container.appendChild(badge);
    container.appendChild(clearBtn);
    container.appendChild(copyBtn);

    // Initial render
    renderVisibleRows();

    // Scroll handler with rAF throttle
    var ticking = false;
    wrap.addEventListener('scroll', function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(function () {
          renderVisibleRows();
          ticking = false;
        });
      }
    });
  }

  render(df);

  return {
    refresh: function (newDataFrame) {
      render(newDataFrame);
    },
    getFilterState: function () {
      return JSON.parse(JSON.stringify(filterState));
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderTable: renderTable };
}
