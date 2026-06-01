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
  prompt.textContent = '> ';
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

  // --- WDK API discovery registry ---
  // Static index for help() + Tab autocomplete. Lists the high-leverage
  // surfaces and what each does; the actual functions live under
  // window.DK.* and window.WDK.* — `dk` below is a convenience alias.
  var WDK_REGISTRY = [
    { sig: 'dk.help()',                            desc: 'Print this list to the REPL.' },
    { sig: 'dk.record()',                          desc: 'Start recording user clicks/types/navs in the current page. Returns a handle.' },
    { sig: 'dk.replay(actions, opts?)',            desc: 'Replay a captured / imported action list. Returns {promise, stop}.' },
    { sig: 'dk.import(file_or_string_or_object)',  desc: 'Import a Chrome DevTools Recorder JSON. Returns a Promise<{title, actions, skipped}>.' },
    { sig: 'dk.network()',                         desc: 'Start intercepting XHR + fetch on the page. Returns {getLog, clear, stop, onRequest, getInstalledFrames}.' },
    { sig: 'dk.bookmarklet(entry)',                desc: 'Convert a captured network entry to a credentials-included one-line bookmarklet.' },
    { sig: 'dk.fetchSnippet(entry)',               desc: 'Convert a captured network entry to a clipboard-friendly fetch() call. Creds stripped.' },
    { sig: 'dk.curl(entry)',                       desc: 'Convert a captured network entry to a curl command. Creds stripped.' },
    { sig: 'dk.reRun(entry, edits?)',              desc: 'Re-fire a captured request, optionally tweaking URL/method/headers/body.' },
    { sig: 'dk.export(actions, fmt, opts?)',       desc: 'Export actions as Playwright | Selenium | Cypress | JSON. Triggers download.' },
    { sig: 'data / df / rows / headers / meta',    desc: 'Loaded dataset bindings (if any data was loaded). df === data.' },
    { sig: 'window.DK.automator.*',                desc: 'Full automator namespace - record, replay, importRecorder, toPlaywright/Selenium/Cypress, download, resolveOne, waitForSelector, waitForExpression. (`window.DK.robo` is a legacy alias of the same object.)' },
    { sig: 'window.WDK.startIntercepting()',       desc: 'Same as dk.network() (un-aliased name).' },
    { sig: 'window.WDK.requestReplay.*',           desc: 'Full request-replay namespace - toBookmarklet, toFetchSnippet, toCurl, reRun, applyEdits, safeHeaders.' }
  ];

  function _buildDkHelper() {
    function help() {
      appendText('WDK REPL - type any expression to evaluate. dk.* is a convenience namespace.', THEME.cyan);
      appendText('', null);
      var maxSig = 0;
      WDK_REGISTRY.forEach(function (r) { if (r.sig.length > maxSig) { maxSig = r.sig.length; } });
      WDK_REGISTRY.forEach(function (r) {
        var pad = '';
        for (var i = r.sig.length; i < maxSig + 2; i++) { pad += ' '; }
        var line = document.createElement('div');
        line.style.cssText = 'padding:1px 8px;line-height:18px;white-space:pre;';
        line.innerHTML = colorSpan(r.sig, THEME.cyan) + pad + colorSpan(r.desc, THEME.textDim);
        appendEntry(line);
      });
      appendText('', null);
      appendText('Tab on a partial expression autocompletes from this registry. Ctrl/Cmd+L clears.', THEME.textDim);
      return undefined;   // suppress the `return undefined` print
    }
    // Resolve namespace lazily — modules may load after REPL mounts
    function _w() { return (typeof window !== 'undefined') ? window : {}; }
    function _DK() { return _w().DK || {}; }
    function _WDK() { return _w().WDK || {}; }
    return {
      help: help,
      record: function () {
        var r = _DK().robo;
        if (!r || !r.record) { throw new Error('robo.record not available - full or robo tier required.'); }
        return r.record();
      },
      replay: function (actions, opts) {
        var a = _DK().automator;
        if (!a || !a.replay) { throw new Error('automator.replay not available - full or robo tier required.'); }
        return a.replay(actions, opts);
      },
      import: function (input) {
        var a = _DK().automator;
        if (!a || !a.importRecorder) { throw new Error('automator.importRecorder not available - full or robo tier required.'); }
        return a.importRecorder(input);
      },
      network: function () {
        var w = _WDK();
        if (!w.startIntercepting) { throw new Error('network interceptor not available - inspect tier or higher required.'); }
        return w.startIntercepting();
      },
      bookmarklet:  function (e) { return _WDK().requestReplay.toBookmarklet(e); },
      fetchSnippet: function (e) { return _WDK().requestReplay.toFetchSnippet(e); },
      curl:         function (e) { return _WDK().requestReplay.toCurl(e); },
      reRun:        function (e, edits) { return _WDK().requestReplay.reRun(e, edits); },
      export: function (actions, fmt, opts) {
        var r = _DK().robo;
        if (!r || !r.download) { throw new Error('robo.download not available - full or robo tier required.'); }
        return r.download(actions, fmt, opts);
      }
    };
  }
  var dk = _buildDkHelper();

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
      : (value.constructor && value.constructor.name !== 'Object' ? value.constructor.name + ' ' : '') + '{' + keys.slice(0, 3).join(', ') + (keys.length > 3 ? ', ...' : '') + '}';

    if (depth >= maxDepth || keys.length === 0) {
      el.innerHTML = (key !== undefined ? colorSpan(JSON.stringify(key), THEME.key) + ': ' : '') + colorSpan(preview, THEME.textDim);
      return el;
    }

    // Collapsible
    var toggle = document.createElement('span');
    toggle.style.cssText = 'cursor:pointer;user-select:none;';
    toggle.innerHTML = '<span style="color:' + THEME.textDim + ';font-size:10px;">></span> '
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
          more.textContent = '... ' + ((isArray ? value.length : keys.length) - limit) + ' more';
          childContainer.appendChild(more);
        }
      }
      childContainer.style.display = expanded ? 'block' : 'none';
      toggle.querySelector('span').textContent = expanded ? 'v' : '>';
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
    row.innerHTML = '<span style="color:' + THEME.cyan + ';">></span> ' + escapeHtml(code);
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

  // --- Export helpers ---

  var lastResult = undefined;

  function showExportBar(value) {
    // Remove previous export bar if any
    var prev = output.querySelector('.dk-repl-export-bar');
    if (prev) prev.parentNode.removeChild(prev);

    if (value === null || value === undefined || typeof value !== 'object') return;

    var bar = document.createElement('div');
    bar.className = 'dk-repl-export-bar';
    bar.style.cssText = 'display:flex;gap:6px;margin:4px 0 6px;';

    function makeBtn(label, onClick) {
      var btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = 'background:transparent;color:' + THEME.cyan + ';border:1px solid ' + THEME.border + ';padding:2px 8px;cursor:pointer;font-family:inherit;font-size:10px;border-radius:2px;';
      btn.addEventListener('click', onClick);
      return btn;
    }

    bar.appendChild(makeBtn('Copy JSON', function () {
      var text = JSON.stringify(value, null, 2);
      copyToClipboard(text);
      this.textContent = 'Copied!';
      var self = this;
      setTimeout(function () { self.textContent = 'Copy JSON'; }, 1500);
    }));

    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      bar.appendChild(makeBtn('Copy CSV', function () {
        var keys = Object.keys(value[0]);
        var lines = [keys.join(',')];
        for (var i = 0; i < value.length; i++) {
          var row = keys.map(function (k) {
            var v = value[i][k];
            if (v === null || v === undefined) return '';
            var s = String(v);
            if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
              return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
          });
          lines.push(row.join(','));
        }
        copyToClipboard(lines.join('\n'));
        this.textContent = 'Copied!';
        var self = this;
        setTimeout(function () { self.textContent = 'Copy CSV'; }, 1500);
      }));
    }

    appendEntry(bar);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
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
      info: 'i ',
      warn: '! ',
      error: 'x '
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
        fn = new Function('data', 'df', 'rows', 'headers', 'meta', 'window', 'dk', 'return (' + code + ')');
      } catch (_) {
        // If that fails (e.g. multi-statement code), use the raw code
        fn = new Function('data', 'df', 'rows', 'headers', 'meta', 'window', 'dk', code);
      }
      var result = fn(ctx.data, ctx.data, ctx.rows, ctx.headers, ctx.meta, window, dk);

      if (result !== undefined) {
        appendResult(result);
        lastResult = result;
        showExportBar(result);
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

  // Static autocomplete entries derived from WDK_REGISTRY signatures
  // (strip parens + arg lists, leaving only the dotted name).
  var AUTOCOMPLETE = (function () {
    var out = [];
    for (var i = 0; i < WDK_REGISTRY.length; i++) {
      var sig = WDK_REGISTRY[i].sig;
      var name = sig.replace(/\(.*$/, '').trim();
      // Skip the 'data / df / rows / ...' multi-binding line
      if (name.indexOf('/') !== -1) {
        name.split('/').forEach(function (n) { out.push(n.trim()); });
      } else {
        out.push(name);
      }
    }
    return out;
  })();

  function _autocomplete(prefix) {
    if (!prefix) { return []; }
    var hits = [];
    for (var i = 0; i < AUTOCOMPLETE.length; i++) {
      if (AUTOCOMPLETE[i].indexOf(prefix) === 0) { hits.push(AUTOCOMPLETE[i]); }
    }
    return hits;
  }

  function _wordToCursor() {
    var val = textarea.value;
    var pos = textarea.selectionStart;
    var start = pos;
    while (start > 0 && /[\w.]/.test(val[start - 1])) { start--; }
    return { start: start, end: pos, text: val.substring(start, pos) };
  }

  textarea.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      // Autocomplete first; if no match, fall back to 2-space indent
      var w = _wordToCursor();
      var hits = _autocomplete(w.text);
      if (hits.length === 1) {
        // Single match — complete inline
        var before = textarea.value.substring(0, w.start);
        var after  = textarea.value.substring(w.end);
        textarea.value = before + hits[0] + after;
        var pos = (before + hits[0]).length;
        textarea.selectionStart = textarea.selectionEnd = pos;
        autoResize();
        return;
      }
      if (hits.length > 1) {
        // Multiple matches — print them, find common prefix, fill it
        appendInput(w.text);
        appendText(hits.join('   '), THEME.textDim);
        // Common prefix completion
        var common = hits[0];
        for (var i = 1; i < hits.length; i++) {
          while (common.length && hits[i].indexOf(common) !== 0) { common = common.slice(0, -1); }
        }
        if (common.length > w.text.length) {
          var b2 = textarea.value.substring(0, w.start);
          var a2 = textarea.value.substring(w.end);
          textarea.value = b2 + common + a2;
          var p2 = (b2 + common).length;
          textarea.selectionStart = textarea.selectionEnd = p2;
        }
        autoResize();
        return;
      }
      // No autocomplete hits — fall back to indent
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

  // --- Welcome message (mounted on init) ---
  appendText("WDK REPL ready. Type any JS expression. dk.help() lists what's available. Tab autocompletes.", THEME.cyan);

  // --- Public API ---

  return {
    run: function () { runScript(textarea.value); },
    getTextarea: function () { return textarea; },
    getOutput: function () { return output; },
    clear: function () { output.innerHTML = ''; },
    setScript: function (code) { textarea.value = code; autoResize(); },
    help: function () { dk.help(); }
  };
}
