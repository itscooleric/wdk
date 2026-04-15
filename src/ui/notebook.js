/**
 * WDK Notebook — code+output cells supporting JS, SQL, and Markdown.
 * Each cell can be JS (runs against df context), SQL (runs against named tables),
 * or Markdown (renders basic markdown to HTML).
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

  // Inject notebook-specific CSS
  var nbStyle = document.createElement('style');
  nbStyle.textContent = [
    '.dk-cell-stale { opacity: 0.4; position: relative; }',
    '.dk-cell-stale::after {',
    '  content: "stale \\2014 re-run cell";',
    '  position: absolute; top: 4px; right: 8px;',
    '  font-size: 10px; color: ' + DK_NB_THEME.yellow + ';',
    '  background: ' + DK_NB_THEME.cellBg + '; padding: 1px 6px;',
    '  border-radius: 3px; border: 1px solid ' + DK_NB_THEME.yellow + '66;',
    '  pointer-events: none;',
    '}',
    '.dk-cell-drag-handle { cursor: grab; color: ' + DK_NB_THEME.textDim + '; padding: 0 4px; user-select: none; font-size: 14px; }',
    '.dk-cell-drag-handle:active { cursor: grabbing; }',
    '.dk-cell-dragover { border-top: 2px solid ' + DK_NB_THEME.cyan + ' !important; }',
    '.dk-nb-md-output h1, .dk-nb-md-output h2, .dk-nb-md-output h3 { margin: 0.4em 0 0.2em; color: ' + DK_NB_THEME.cyan + '; }',
    '.dk-nb-md-output h1 { font-size: 18px; }',
    '.dk-nb-md-output h2 { font-size: 15px; }',
    '.dk-nb-md-output h3 { font-size: 13px; }',
    '.dk-nb-md-output strong { color: ' + DK_NB_THEME.pink + '; }',
    '.dk-nb-md-output em { color: ' + DK_NB_THEME.purple || '#b967ff' + '; font-style: italic; }',
    '.dk-nb-md-output code { background: ' + DK_NB_THEME.cellBg + '; padding: 1px 4px; border-radius: 2px; font-size: 11px; color: ' + DK_NB_THEME.yellow + '; }',
    '.dk-nb-md-output pre { background: ' + DK_NB_THEME.cellBg + '; padding: 8px; border-radius: 3px; overflow-x: auto; }',
    '.dk-nb-md-output pre code { padding: 0; background: transparent; }',
    '.dk-nb-md-output ul, .dk-nb-md-output ol { margin: 0.3em 0; padding-left: 1.5em; }',
    '.dk-nb-md-output li { margin: 0.15em 0; }',
    '.dk-nb-md-output hr { border: none; border-top: 1px solid ' + DK_NB_THEME.border + '; margin: 0.5em 0; }',
    '.dk-nb-md-output p { margin: 0.3em 0; }',
    '.dk-nb-md-output { padding: 8px 12px; font-size: 12px; line-height: 1.5; color: ' + DK_NB_THEME.text + '; }',
  ].join('\n');
  document.head.appendChild(nbStyle);

  // Toolbar
  var toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;gap:6px;padding:4px 0;flex-shrink:0;';

  var addJSBtn = _btn('+ JS Cell', DK_NB_THEME.cyan);
  var addSQLBtn = _btn('+ SQL Cell', DK_NB_THEME.yellow);
  var addMDBtn = _btn('+ Markdown', DK_NB_THEME.pink);
  var runAllBtn = _btn('Run All', DK_NB_THEME.green);

  addJSBtn.addEventListener('click', function () { addCell('js'); });
  addSQLBtn.addEventListener('click', function () { addCell('sql'); });
  addMDBtn.addEventListener('click', function () { addCell('md'); });
  runAllBtn.addEventListener('click', function () { cells.forEach(function (c) { c.run(); }); });

  toolbar.appendChild(addJSBtn);
  toolbar.appendChild(addSQLBtn);
  toolbar.appendChild(addMDBtn);
  toolbar.appendChild(runAllBtn);

  var cellContainer = document.createElement('div');
  cellContainer.style.cssText = 'display:flex;flex-direction:column;gap:6px;flex:1;';

  wrapper.appendChild(toolbar);
  wrapper.appendChild(cellContainer);
  container.appendChild(wrapper);

  // Add initial cell
  addCell('sql');

  // ─── Basic markdown renderer ───────────────────────────────────────
  function renderMarkdown(src) {
    var lines = src.split('\n');
    var html = [];
    var inCodeBlock = false;
    var codeBlockLines = [];
    var inUl = false;
    var inOl = false;

    function closeLists() {
      if (inUl) { html.push('</ul>'); inUl = false; }
      if (inOl) { html.push('</ol>'); inOl = false; }
    }

    function inlineFormat(text) {
      // Code spans first (to avoid processing inside them)
      text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
      // Bold before italic
      text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      return text;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // Fenced code blocks
      if (line.trim().indexOf('```') === 0) {
        if (!inCodeBlock) {
          closeLists();
          inCodeBlock = true;
          codeBlockLines = [];
        } else {
          html.push('<pre><code>' + codeBlockLines.join('\n').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code></pre>');
          inCodeBlock = false;
        }
        continue;
      }
      if (inCodeBlock) {
        codeBlockLines.push(line);
        continue;
      }

      // Blank line = paragraph break
      if (line.trim() === '') {
        closeLists();
        continue;
      }

      // Horizontal rule
      if (/^---+\s*$/.test(line.trim())) {
        closeLists();
        html.push('<hr>');
        continue;
      }

      // Headings
      if (/^### /.test(line)) { closeLists(); html.push('<h3>' + inlineFormat(line.slice(4)) + '</h3>'); continue; }
      if (/^## /.test(line)) { closeLists(); html.push('<h2>' + inlineFormat(line.slice(3)) + '</h2>'); continue; }
      if (/^# /.test(line)) { closeLists(); html.push('<h1>' + inlineFormat(line.slice(2)) + '</h1>'); continue; }

      // Unordered list
      if (/^[-*] /.test(line.trim())) {
        if (!inUl) { if (inOl) { html.push('</ol>'); inOl = false; } html.push('<ul>'); inUl = true; }
        html.push('<li>' + inlineFormat(line.trim().slice(2)) + '</li>');
        continue;
      }

      // Ordered list
      if (/^\d+\. /.test(line.trim())) {
        if (!inOl) { if (inUl) { html.push('</ul>'); inUl = false; } html.push('<ol>'); inOl = true; }
        html.push('<li>' + inlineFormat(line.trim().replace(/^\d+\.\s*/, '')) + '</li>');
        continue;
      }

      // Paragraph
      closeLists();
      html.push('<p>' + inlineFormat(line) + '</p>');
    }

    // Close any open blocks
    if (inCodeBlock) {
      html.push('<pre><code>' + codeBlockLines.join('\n').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code></pre>');
    }
    closeLists();

    return html.join('\n');
  }

  // ─── Drag-and-drop reorder ────────────────────────────────────────
  var dragSourceIdx = null;

  function addCell(lang) {
    var cell = createCell(lang, cells.length + 1);
    cells.push(cell);
    cellContainer.appendChild(cell.el);
    cell.focus();
    return cell;
  }

  function createCell(lang, num) {
    var el = document.createElement('div');
    el.style.cssText = 'border:1px solid ' + DK_NB_THEME.border + ';border-radius:3px;overflow:hidden;';

    // Header bar
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:2px 8px;background:' + DK_NB_THEME.cellBg + ';border-bottom:1px solid ' + DK_NB_THEME.border + ';';

    var langColor = lang === 'sql' ? DK_NB_THEME.yellow : lang === 'md' ? DK_NB_THEME.pink : DK_NB_THEME.cyan;
    var langText = lang === 'sql' ? 'SQL' : lang === 'md' ? 'MD' : 'JS';

    var langLabel = document.createElement('span');
    langLabel.style.cssText = 'font-size:10px;color:' + langColor + ';text-transform:uppercase;font-weight:bold;letter-spacing:0.5px;font-family:inherit;';
    langLabel.textContent = langText;

    var cellNum = document.createElement('span');
    cellNum.style.cssText = 'font-size:10px;color:' + DK_NB_THEME.textDim + ';';
    cellNum.textContent = '[' + num + ']';

    // Drag handle
    var dragHandle = document.createElement('span');
    dragHandle.className = 'dk-cell-drag-handle';
    dragHandle.textContent = '\u2801\u2801\u2801';
    dragHandle.draggable = true;

    dragHandle.addEventListener('dragstart', function (e) {
      dragSourceIdx = cells.indexOf(cellObj);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragSourceIdx));
    });

    el.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('dk-cell-dragover');
    });

    el.addEventListener('dragleave', function () {
      el.classList.remove('dk-cell-dragover');
    });

    el.addEventListener('drop', function (e) {
      e.preventDefault();
      el.classList.remove('dk-cell-dragover');
      var targetIdx = cells.indexOf(cellObj);
      if (dragSourceIdx === null || dragSourceIdx === targetIdx) return;
      var movedCell = cells.splice(dragSourceIdx, 1)[0];
      cells.splice(targetIdx, 0, movedCell);
      // Re-append all cells in new order
      cells.forEach(function (c) { cellContainer.appendChild(c.el); });
      dragSourceIdx = null;
    });

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
    leftGroup.appendChild(dragHandle);
    leftGroup.appendChild(cellNum);
    leftGroup.appendChild(langLabel);

    header.appendChild(leftGroup);
    header.appendChild(btnGroup);

    // Input
    var input = document.createElement('textarea');
    input.style.cssText = 'width:100%;box-sizing:border-box;min-height:60px;resize:vertical;padding:8px;background:' + DK_NB_THEME.cellBg + ';color:' + DK_NB_THEME.text + ';border:none;font-family:"SF Mono","Fira Code","Consolas",monospace;font-size:12px;outline:none;';
    input.spellcheck = false;
    input.placeholder = lang === 'sql' ? 'SELECT * FROM df WHERE ...' : lang === 'md' ? '# Heading\n\nWrite markdown here...' : '// df, rows, headers, meta available\nreturn df.filter(r => r.salary > 100)';

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

    // Stale output warning — mark output stale when textarea edited after run
    input.addEventListener('input', function () {
      if (output.innerHTML !== '') {
        output.classList.add('dk-cell-stale');
      }
    });

    // Markdown: auto-render on blur
    if (lang === 'md') {
      input.addEventListener('blur', function () {
        if (input.value.trim()) {
          cellObj.run();
        }
      });
    }

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
      setValue: function (code) { input.value = code; },
      run: function () {
        output.innerHTML = '';
        output.classList.remove('dk-cell-stale');
        var code = input.value.trim();
        if (!code) return;

        // Markdown rendering
        if (lang === 'md') {
          output.className = 'dk-nb-md-output';
          output.innerHTML = renderMarkdown(code);
          return;
        }

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
