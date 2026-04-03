/**
 * DataKit table renderer.
 * Renders a DataFrame into a sortable, scrollable HTML table.
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

function injectTableStyles() {
  if (document.getElementById('dk-table-styles')) return;
  var style = document.createElement('style');
  style.id = 'dk-table-styles';
  style.textContent = [
    '.dk-table-wrap {',
    '  overflow-y: auto; overflow-x: auto; max-height: 100%;',
    '  scrollbar-width: thin; scrollbar-color: ' + DK_TABLE_THEME.border + ' ' + DK_TABLE_THEME.bg + ';',
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
    '  position: sticky; top: 0;',
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
    '  padding: 3px 8px;',
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
  ].join('\n');
  document.head.appendChild(style);
}

/**
 * Render a DataFrame into an HTML table inside a container element.
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

      // Sort arrow
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

    // Body rows
    var tbody = document.createElement('tbody');
    rows.forEach(function (row, rowIdx) {
      var tr = document.createElement('tr');

      var tdNum = document.createElement('td');
      tdNum.className = 'dk-row-num';
      tdNum.textContent = String(rowIdx + 1);
      tr.appendChild(tdNum);

      headers.forEach(function (_, colIdx) {
        var td = document.createElement('td');
        var val = row[colIdx];
        td.textContent = val === null || val === undefined ? '' : String(val);
        td.title = td.textContent;
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
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
