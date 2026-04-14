/**
 * WDK REPL / Script Panel — Chrome DevTools-style console
 * Interactive scripting against loaded data.
 * - Enter to execute, Shift+Enter for multiline
 * - Expandable/collapsible JSON tree for objects
 * - Scrollable output history
 * - Command history (up/down arrows)
 * Export: createREPL(container, getContext)
 *   getContext() => { data: object[], rows: any[][], headers: string[], meta: { rowCount, columnCount } }
 */

function createREPL(container, getContext) {
  var THEME = {
    bg: '#0a0a1a',
    inputBg: '#121228',
    border: '#2a2a4e',
    text: '#e0e0ff',
    textDim: '#8888aa',
    cyan: '#00e5ff',
    green: '#80d080',
    yellow: '#d0a040',
    red: '#e04040',
    purple: '#b967ff',
    blue: '#7090d0',
    pink: '#ff2975',
    key: '#b967ff',
    string: '#80d080',
    number: '#00e5ff',
    bool: '#ff2975',
    null_: '#8888aa',
  };

  // --- Build DOM ---
  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;font-family:"SF Mono","Fira Code","Consolas",monospace;font-size:13px;';

  // Output area (scrollable history)
  var output = document.createElement('div');
  output.setAttribute('role', 'log');
  output.setAttribute('aria-live', 'polite');
  output.setAttribute('aria-label', 'REPL output');
  output.style.cssText = 'flex:1;overflow:auto;padding:8px;margin:0;background:' + THEME.bg + ';color:' + THEME.text + ';scrollbar-width:thin;scrollbar-color:' + THEME.border + ' ' + THEME.bg + ';';

  // Input area
  var inputRow = document.createElement('div');
  inputRow.style.cssText = 'display:flex;align-items:flex-start;border-top:1px solid ' + THEME.border + ';background:' + THEME.inputBg + ';flex-shrink:0;';

  var prompt = document.createElement('span');
  prompt.textContent = '\u276f ';
  prompt.style.cssText = 'color:' + THEME.cyan + ';padding:8px 0 8px 8px;user-select:none;line-height:20px;';

  var textarea = document.createElement('textarea');
  textarea.rows = 1;
  textarea.style.cssText = 'flex:1;background:transparent;color:' + THEME.text + ';border:none;outline:none;padding:8px 8px 8px 2px;font-family:inherit;font-size:inherit;resize:none;line-height:20px;overflow:hidden;';
  textarea.placeholder = 'Type expression... (Enter to run, Shift+Enter for newline)';
  textarea.spellcheck = false;
  textarea.setAttribute('role', 'textbox');
  textarea.setAttribute('aria-label', 'REPL input');
  textarea.setAttribute('aria-multiline', 'true');

  inputRow.appendChild(prompt);
  inputRow.appendChild(textarea);
  wrapper.appendChild(output);
  wrapper.appendChild(inputRow);
  container.appendChild(wrapper);

  // --- Command history ---
  var history = [];
  var historyIdx = -1;
  var pendingInput = '';

  // --- Auto-resize textarea ---
  function autoResize() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }
  textarea.addEventListener('input', autoResize);

  // --- Expandable JSON tree ---

  function createTreeNode(value, key, depth, isLast) {
    depth = depth || 0;
    var maxDepth = 4;
    var el = document.createElement('div');
    el.style.cssText = 'padding-left:' + (depth * 16) + 'px;line-height:20px;white-space:pre;';

    if (value === null) {
      el.innerHTML = (key !== undefined ? colorSpan(JSON.stringify(key), THEME.key) + ': ' : '') + colorSpan('null', THEME.null_);
      return el;
    }

    if (value === undefined) {
      el.innerHTML = (key !== undefined ? colorSpan(JSON.stringify(key), THEME.key) + ': ' : '') + colorSpan('undefined', THEME.null_);
      return el;
    }

    var type = typeof value;

    if (type === 'string') {
      var display = JSON.stringify(value);
      el.innerHTML = (key !== undefined ? colorSpan(JSON.stringify(key), THEME.key) + ': ' : '') + colorSpan(display, THEME.string);
      return el;
    }

    if (type === 'number') {
      el.innerHTML = (key !== undefined ? colorSpan(JSON.stringify(key), THEME.key) + ': ' : '') + colorSpan(String(value), THEME.number);
      return el;
    }

    if (type === 'boolean') {
      el.innerHTML = (key !== undefined ? colorSpan(JSON.stringify(key), THEME.key) + ': ' : '') + colorSpan(String(value), THEME.bool);
      return el;
    }

    if (type === 'function') {
      el.innerHTML = (key !== undefined ? colorSpan(JSON.stringify(key), THEME.key) + ': ' : '') + colorSpan('f ' + (value.name || 'anonymous') + '()', THEME.blue);
      return el;
    }

    // Object or Array
    var isArray = Array.isArray(value);
    var keys;
    try { keys = Object.keys(value); } catch (_) { keys = []; }
    var preview = isArray
      ? 'Array(' + value.length + ')'
      : (value.constructor && value.constructor.name !== 'Object' ? value.constructor.name + ' ' : '') + '{' + keys.slice(0, 3).join(', ') + (keys.length > 3 ? ', \u2026' : '') + '}';

    if (depth >= maxDepth || keys.length === 0) {
      el.innerHTML = (key !== undefined ? colorSpan(JSON.stringify(key), THEME.key) + ': ' : '') + colorSpan(preview, THEME.textDim);
      return el;
    }

    // Collapsible
    var toggle = document.createElement('span');
    toggle.style.cssText = 'cursor:pointer;user-select:none;';
    toggle.innerHTML = '<span style="color:' + THEME.textDim + ';font-size:10px;">\u25b6</span> '
      + (key !== undefined ? colorSpan(JSON.stringify(key), THEME.key) + ': ' : '')
      + colorSpan(preview, THEME.textDim);

    var childContainer = document.createElement('div');
    childContainer.style.display = 'none';
    var expanded = false;
    var childrenRendered = false;

    toggle.addEventListener('click', function () {
      expanded = !expanded;
      if (!childrenRendered) {
        childrenRendered = true;
        var entries = isArray ? value : keys;
        var limit = Math.min(isArray ? value.length : keys.length, 100);
        for (var i = 0; i < limit; i++) {
          var k = isArray ? i : keys[i];
          var v = value[k];
          childContainer.appendChild(createTreeNode(v, k, depth + 1, i === limit - 1));
        }
        if ((isArray ? value.length : keys.length) > limit) {
          var more = document.createElement('div');
          more.style.cssText = 'padding-left:' + ((depth + 1) * 16) + 'px;color:' + THEME.textDim + ';';
          more.textContent = '\u2026 ' + ((isArray ? value.length : keys.length) - limit) + ' more';
          childContainer.appendChild(more);
        }
      }
      childContainer.style.display = expanded ? 'block' : 'none';
      toggle.querySelector('span').textContent = expanded ? '\u25bc' : '\u25b6';
    });

    el.appendChild(toggle);
    el.appendChild(childContainer);
    return el;
  }

  function colorSpan(text, color) {
    return '<span style="color:' + color + ';">' + escapeHtml(text) + '</span>';
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // --- Output helpers ---

  function appendEntry(el) {
    output.appendChild(el);
    output.scrollTop = output.scrollHeight;
  }

  function appendInput(code) {
    var row = document.createElement('div');
    row.style.cssText = 'color:' + THEME.textDim + ';margin:4px 0 2px;';
    row.innerHTML = '<span style="color:' + THEME.cyan + ';">\u276f</span> ' + escapeHtml(code);
    appendEntry(row);
  }

  function appendText(text, color) {
    var el = document.createElement('div');
    el.style.cssText = 'color:' + (color || THEME.text) + ';line-height:20px;white-space:pre-wrap;word-wrap:break-word;margin:0 0 2px;';
    el.textContent = text;
    appendEntry(el);
  }

  function appendResult(value) {
    if (value === undefined) {
      appendText('undefined', THEME.null_);
      return;
    }
    if (value === null || typeof value !== 'object') {
      var node = createTreeNode(value);
      node.style.margin = '0 0 2px';
      appendEntry(node);
      return;
    }
    // Object/array — render expandable tree
    var node = createTreeNode(value);
    node.style.margin = '0 0 2px';
    appendEntry(node);
  }

  // --- Console intercept ---

  function makeInterceptedConsole() {
    var original = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      info: console.info.bind(console)
    };

    var colors = {
      log: THEME.text,
      info: THEME.blue,
      warn: THEME.yellow,
      error: THEME.red
    };

    var prefixes = {
      log: '',
      info: '\u2139 ',
      warn: '\u26a0 ',
      error: '\u2716 '
    };

    var intercepted = {};
    ['log', 'info', 'warn', 'error'].forEach(function (level) {
      intercepted[level] = function () {
        var args = Array.prototype.slice.call(arguments);
        // For single object args, render as tree
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
          var label = document.createElement('div');
          label.style.cssText = 'color:' + colors[level] + ';line-height:20px;';
          if (prefixes[level]) label.textContent = prefixes[level];
          appendEntry(label);
          appendResult(args[0]);
        } else {
          var msg = prefixes[level] + args.map(function (a) {
            if (typeof a === 'object') {
              try { return JSON.stringify(a); } catch (_) { return String(a); }
            }
            return String(a);
          }).join(' ');
          appendText(msg, colors[level]);
        }
        original[level].apply(console, args);
      };
    });

    return { intercepted: intercepted, original: original };
  }

  // --- Script execution ---

  function runScript(code) {
    if (!code.trim()) return;

    appendInput(code);

    var ctx = getContext();
    var consoles = makeInterceptedConsole();

    // Temporarily replace console methods
    var savedConsole = {};
    ['log', 'info', 'warn', 'error'].forEach(function (level) {
      savedConsole[level] = console[level];
      console[level] = consoles.intercepted[level];
    });

    try {
      // Try auto-return: wrap as expression so bare values like `data.length` return a result
      var fn;
      try {
        fn = new Function('data', 'df', 'rows', 'headers', 'meta', 'window', 'return (' + code + ')');
      } catch (_) {
        // If that fails (e.g. multi-statement code), use the raw code
        fn = new Function('data', 'df', 'rows', 'headers', 'meta', 'window', code);
      }
      var result = fn(ctx.data, ctx.data, ctx.rows, ctx.headers, ctx.meta, window);

      if (result !== undefined) {
        appendResult(result);
      }
    } catch (err) {
      appendText(err.message, THEME.red);
    } finally {
      ['log', 'info', 'warn', 'error'].forEach(function (level) {
        console[level] = savedConsole[level];
      });
    }
  }

  // --- Input handling ---

  textarea.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      var start = textarea.selectionStart;
      var end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
      autoResize();
      return;
    }

    // Enter (no shift) = execute
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      var code = textarea.value;
      if (!code.trim()) return;
      history.push(code);
      historyIdx = history.length;
      pendingInput = '';
      textarea.value = '';
      autoResize();
      runScript(code);
      return;
    }

    // Up arrow at start = history back
    if (e.key === 'ArrowUp' && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
      e.preventDefault();
      if (historyIdx === history.length) {
        pendingInput = textarea.value;
      }
      if (historyIdx > 0) {
        historyIdx--;
        textarea.value = history[historyIdx];
        autoResize();
      }
      return;
    }

    // Down arrow at end = history forward
    if (e.key === 'ArrowDown' && textarea.selectionStart === textarea.value.length) {
      e.preventDefault();
      if (historyIdx < history.length) {
        historyIdx++;
        textarea.value = historyIdx === history.length ? pendingInput : history[historyIdx];
        autoResize();
      }
      return;
    }

    // Ctrl/Cmd+L = clear output
    if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      output.innerHTML = '';
      return;
    }
  });

  // --- Public API ---

  return {
    run: function () { runScript(textarea.value); },
    getTextarea: function () { return textarea; },
    getOutput: function () { return output; },
    clear: function () { output.innerHTML = ''; },
    setScript: function (code) { textarea.value = code; autoResize(); }
  };
}
