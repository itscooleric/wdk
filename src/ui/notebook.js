/**
 * Wiz Notebook — code+output cells supporting JS and SQL.
 * Each cell can be JS (runs against df context) or SQL (runs against named tables).
 * Synthwave 84 theme. Zero dependencies.
 */

/* global execSQL, renderTable */

var DK_NB_THEME = {
  bg: '#0d0d22',
  cellBg: '#121228',
  border: '#2a2a4e',
  cyan: '#00e5ff',
  pink: '#ff2975',
  green: '#80d080',
  yellow: '#ffe066',
  text: '#e0e0f0',
  textDim: '#8888aa',
  error: '#ff4444',
};

function createNotebook(container, getContext) {
  var cells = [];
  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow-y:auto;background:' + DK_NB_THEME.bg + ';padding:8px;gap:6px;';

  // Toolbar
  var toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;gap:6px;padding:4px 0;flex-shrink:0;';

  var addJSBtn = _btn('+ JS Cell', DK_NB_THEME.cyan);
  var addSQLBtn = _btn('+ SQL Cell', DK_NB_THEME.yellow);
  var runAllBtn = _btn('Run All', DK_NB_THEME.green);

  addJSBtn.addEventListener('click', function () { addCell('js'); });
  addSQLBtn.addEventListener('click', function () { addCell('sql'); });
  runAllBtn.addEventListener('click', function () { cells.forEach(function (c) { c.run(); }); });

  toolbar.appendChild(addJSBtn);
  toolbar.appendChild(addSQLBtn);
  toolbar.appendChild(runAllBtn);

  var cellContainer = document.createElement('div');
  cellContainer.style.cssText = 'display:flex;flex-direction:column;gap:6px;flex:1;';

  wrapper.appendChild(toolbar);
  wrapper.appendChild(cellContainer);
  container.appendChild(wrapper);

  // Add initial cell
  addCell('sql');

  function addCell(lang) {
    var cell = createCell(lang, cells.length + 1);
    cells.push(cell);
    cellContainer.appendChild(cell.el);
    cell.focus();
  }

  function createCell(lang, num) {
    var el = document.createElement('div');
    el.style.cssText = 'border:1px solid ' + DK_NB_THEME.border + ';border-radius:3px;overflow:hidden;';

    // Header bar
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:2px 8px;background:' + DK_NB_THEME.cellBg + ';border-bottom:1px solid ' + DK_NB_THEME.border + ';';

    var langLabel = document.createElement('span');
    langLabel.style.cssText = 'font-size:10px;color:' + (lang === 'sql' ? DK_NB_THEME.yellow : DK_NB_THEME.cyan) + ';text-transform:uppercase;font-weight:bold;letter-spacing:0.5px;font-family:inherit;';
    langLabel.textContent = lang === 'sql' ? 'SQL' : 'JS';

    var cellNum = document.createElement('span');
    cellNum.style.cssText = 'font-size:10px;color:' + DK_NB_THEME.textDim + ';';
    cellNum.textContent = '[' + num + ']';

    var btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;gap:4px;';

    var runCellBtn = _btn('\u25b6', DK_NB_THEME.green, true);
    var delCellBtn = _btn('\u2715', DK_NB_THEME.pink, true);

    runCellBtn.addEventListener('click', function () { cellObj.run(); });
    delCellBtn.addEventListener('click', function () {
      var idx = cells.indexOf(cellObj);
      if (idx >= 0) cells.splice(idx, 1);
      el.remove();
    });

    btnGroup.appendChild(runCellBtn);
    btnGroup.appendChild(delCellBtn);

    var leftGroup = document.createElement('div');
    leftGroup.style.cssText = 'display:flex;gap:8px;align-items:center;';
    leftGroup.appendChild(cellNum);
    leftGroup.appendChild(langLabel);

    header.appendChild(leftGroup);
    header.appendChild(btnGroup);

    // Input
    var input = document.createElement('textarea');
    input.style.cssText = 'width:100%;box-sizing:border-box;min-height:60px;resize:vertical;padding:8px;background:' + DK_NB_THEME.cellBg + ';color:' + DK_NB_THEME.text + ';border:none;font-family:"SF Mono","Fira Code","Consolas",monospace;font-size:12px;outline:none;';
    input.spellcheck = false;
    input.placeholder = lang === 'sql' ? 'SELECT * FROM df WHERE ...' : '// df, rows, headers, meta available\nreturn df.filter(r => r.salary > 100)';

    // Tab key inserts spaces
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        var start = input.selectionStart;
        input.value = input.value.substring(0, start) + '  ' + input.value.substring(input.selectionEnd);
        input.selectionStart = input.selectionEnd = start + 2;
      }
      // Shift+Enter runs cell
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        cellObj.run();
      }
    });

    // Output
    var output = document.createElement('div');
    output.style.cssText = 'max-height:300px;overflow:auto;border-top:1px solid ' + DK_NB_THEME.border + ';';

    el.appendChild(header);
    el.appendChild(input);
    el.appendChild(output);

    var cellObj = {
      el: el,
      lang: lang,
      focus: function () { input.focus(); },
      run: function () {
        output.innerHTML = '';
        var code = input.value.trim();
        if (!code) return;

        var ctx = getContext();
        var t0 = performance.now();

        try {
          if (lang === 'sql') {
            // SQL execution
            var sqlTables = { df: { _headers: ctx.headers, _rows: ctx.rows } };
            var result = execSQL(code, sqlTables);
            var elapsed = (performance.now() - t0).toFixed(1);

            // Render result as table
            if (typeof renderTable === 'function') {
              renderTable(output, { _headers: result.headers, _rows: result.rows });
            }
            _appendStatus(output, result.rows.length + ' rows \u00b7 ' + elapsed + 'ms');
          } else {
            // JS execution
            var logs = [];
            var mockConsole = {
              log: function () { logs.push({ level: 'log', args: Array.from(arguments) }); },
              warn: function () { logs.push({ level: 'warn', args: Array.from(arguments) }); },
              error: function () { logs.push({ level: 'error', args: Array.from(arguments) }); },
            };

            var fn = new Function('df', 'data', 'rows', 'headers', 'meta', 'console', code);
            var result = fn(ctx.data, ctx.data, ctx.rows, ctx.headers, ctx.meta, mockConsole);
            var elapsed = (performance.now() - t0).toFixed(1);

            // Render console output
            logs.forEach(function (entry) {
              var line = document.createElement('div');
              line.style.cssText = 'padding:2px 8px;font-size:11px;font-family:monospace;color:' +
                (entry.level === 'error' ? DK_NB_THEME.error : entry.level === 'warn' ? DK_NB_THEME.yellow : DK_NB_THEME.text) + ';';
              line.textContent = entry.args.map(function (a) { return typeof a === 'object' ? JSON.stringify(a) : String(a); }).join(' ');
              output.appendChild(line);
            });

            // Render return value
            if (result !== undefined) {
              // If result looks like a table ({headers, rows} or array of objects), render as table
              if (result && result.headers && result.rows) {
                renderTable(output, { _headers: result.headers, _rows: result.rows });
              } else if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'object') {
                var keys = Object.keys(result[0]);
                var tableRows = result.map(function (obj) { return keys.map(function (k) { return obj[k]; }); });
                renderTable(output, { _headers: keys, _rows: tableRows });
              } else {
                var valLine = document.createElement('div');
                valLine.style.cssText = 'padding:2px 8px;font-size:11px;font-family:monospace;color:' + DK_NB_THEME.green + ';';
                valLine.textContent = '\u21d2 ' + (typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result));
                output.appendChild(valLine);
              }
            }

            _appendStatus(output, elapsed + 'ms');
          }
        } catch (e) {
          var errLine = document.createElement('div');
          errLine.style.cssText = 'padding:4px 8px;font-size:11px;font-family:monospace;color:' + DK_NB_THEME.error + ';';
          errLine.textContent = '\u2717 ' + e.message;
          output.appendChild(errLine);
        }

        // Highlight active cell border
        el.style.borderColor = DK_NB_THEME.cyan;
        setTimeout(function () { el.style.borderColor = DK_NB_THEME.border; }, 1000);
      }
    };

    return cellObj;
  }

  function _btn(text, color, small) {
    var btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = 'background:transparent;color:' + color + ';border:1px solid ' + color + ';padding:' + (small ? '1px 6px' : '3px 10px') + ';cursor:pointer;font-family:inherit;font-size:' + (small ? '10px' : '11px') + ';border-radius:2px;';
    btn.addEventListener('mouseenter', function () { btn.style.background = color; btn.style.color = '#000'; });
    btn.addEventListener('mouseleave', function () { btn.style.background = 'transparent'; btn.style.color = color; });
    return btn;
  }

  function _appendStatus(container, text) {
    var s = document.createElement('div');
    s.style.cssText = 'padding:2px 8px;font-size:10px;color:' + DK_NB_THEME.textDim + ';text-align:right;';
    s.textContent = text;
    container.appendChild(s);
  }

  return {
    addCell: addCell,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createNotebook: createNotebook };
}
