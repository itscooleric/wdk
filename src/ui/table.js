/**
 * DataKit table renderer with virtual scrolling.
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

  function render(dt) {
    container.innerHTML = '';

    var headers = dt._headers;
    var rows = dt._rows;

    if (!headers || headers.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'dk-table-empty';
      empty.textContent = 'No data loaded';
      container.appendChild(empty);
      return;
    }

    var totalRows = rows.length;

    var wrap = document.createElement('div');
    wrap.className = 'dk-table-wrap';
    wrap.style.maxHeight = '100%';

    var table = document.createElement('table');
    table.className = 'dk-table';

    // Header row
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');

    var thNum = document.createElement('th');
    thNum.textContent = '#';
    thNum.style.cursor = 'default';
    headRow.appendChild(thNum);

    headers.forEach(function (colName) {
      var th = document.createElement('th');
      var label = document.createTextNode(colName);
      th.appendChild(label);

      if (sortCol === colName) {
        var arrow = document.createElement('span');
        arrow.className = 'dk-sort-arrow';
        arrow.textContent = sortAsc ? '\u25b2' : '\u25bc';
        th.appendChild(arrow);
      }

      th.addEventListener('click', function () {
        if (sortCol === colName) {
          sortAsc = !sortAsc;
        } else {
          sortCol = colName;
          sortAsc = true;
        }
        if (onSort) onSort(colName, sortAsc);
      });

      headRow.appendChild(th);
    });

    thead.appendChild(headRow);
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
    badge.textContent = totalRows.toLocaleString() + ' rows';

    var lastStart = -1;
    var lastEnd = -1;

    function renderVisibleRows() {
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

        var tdNum = document.createElement('td');
        tdNum.className = 'dk-row-num';
        tdNum.textContent = String(i + 1);
        tr.appendChild(tdNum);

        for (var c = 0; c < headers.length; c++) {
          var td = document.createElement('td');
          var val = row[c];
          td.textContent = val === null || val === undefined ? '' : String(val);
          td.title = td.textContent;
          tr.appendChild(td);
        }

        tbody.appendChild(tr);
      }

      tbody.appendChild(bottomSpacer);
    }

    container.appendChild(wrap);
    container.style.position = 'relative';
    container.appendChild(badge);

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
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderTable: renderTable };
}
