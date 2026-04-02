/**
 * DataKit REPL / Script Panel
 * Interactive scripting against loaded data.
 * Export: createREPL(container, getContext)
 *   getContext() => { data: object[], rows: any[][], headers: string[], meta: { rowCount, columnCount } }
 */

function createREPL(container, getContext) {
  // --- Build DOM ---
  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;font-family:monospace;font-size:13px;';

  // Script input
  var textarea = document.createElement('textarea');
  textarea.style.cssText = [
    'width:100%;box-sizing:border-box;min-height:120px;resize:vertical;padding:10px',
    'background:#121228;color:#e0e0ff;border:1px solid #2a2a4e;border-radius:4px',
    'font-family:inherit;font-size:inherit;outline:none;tab-size:2'
  ].join(';');
  textarea.placeholder = '// Script runs with: data, rows, headers, meta, window\n// console.log/warn/error output appears below\n';
  textarea.spellcheck = false;

  // Tab key inserts spaces instead of changing focus
  textarea.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      var start = textarea.selectionStart;
      var end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
    }
    // Ctrl/Cmd+Enter runs script
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runScript();
    }
  });

  // Toolbar
  var toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;gap:6px;margin:6px 0;align-items:center;';

  var runBtn = document.createElement('button');
  runBtn.textContent = 'Run';
  runBtn.title = 'Execute script (Ctrl+Enter)';
  runBtn.style.cssText = [
    'padding:4px 14px;background:#2a2a4e;color:#e0e0ff;border:1px solid #3a3a6e',
    'border-radius:3px;cursor:pointer;font-family:inherit;font-size:12px'
  ].join(';');

  var clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.style.cssText = runBtn.style.cssText;

  var status = document.createElement('span');
  status.style.cssText = 'color:#888;font-size:11px;margin-left:auto;';

  toolbar.appendChild(runBtn);
  toolbar.appendChild(clearBtn);
  toolbar.appendChild(status);

  // Output panel
  var output = document.createElement('pre');
  output.style.cssText = [
    'flex:1;overflow:auto;padding:10px;margin:0;min-height:80px',
    'background:#0a0a1a;color:#c0c0e0;border:1px solid #2a2a4e;border-radius:4px',
    'white-space:pre-wrap;word-wrap:break-word;font-family:inherit;font-size:inherit'
  ].join(';');

  wrapper.appendChild(textarea);
  wrapper.appendChild(toolbar);
  wrapper.appendChild(output);
  container.appendChild(wrapper);

  // --- Helpers ---

  function appendOutput(text, color) {
    var span = document.createElement('span');
    span.style.color = color || '#c0c0e0';
    span.textContent = text + '\n';
    output.appendChild(span);
    output.scrollTop = output.scrollHeight;
  }

  function formatValue(val) {
    if (val === undefined) return 'undefined';
    if (val === null) return 'null';
    if (typeof val === 'object') {
      try { return JSON.stringify(val, null, 2); } catch (_) { return String(val); }
    }
    return String(val);
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
      log: '#c0c0e0',
      info: '#7090d0',
      warn: '#d0a040',
      error: '#e04040'
    };

    var intercepted = {};
    ['log', 'info', 'warn', 'error'].forEach(function (level) {
      intercepted[level] = function () {
        var args = Array.prototype.slice.call(arguments);
        var msg = args.map(formatValue).join(' ');
        appendOutput('[' + level + '] ' + msg, colors[level]);
        original[level].apply(console, args);
      };
    });

    return { intercepted: intercepted, original: original };
  }

  // --- Script execution ---

  function runScript() {
    output.innerHTML = '';
    var code = textarea.value;
    if (!code.trim()) {
      appendOutput('(empty script)', '#666');
      return;
    }

    var ctx = getContext();
    var consoles = makeInterceptedConsole();
    var startTime = performance.now();

    // Temporarily replace console methods
    var savedConsole = {};
    ['log', 'info', 'warn', 'error'].forEach(function (level) {
      savedConsole[level] = console[level];
      console[level] = consoles.intercepted[level];
    });

    try {
      // Build function with context variables in scope
      var fn = new Function('data', 'rows', 'headers', 'meta', 'window', code);
      var result = fn(ctx.data, ctx.rows, ctx.headers, ctx.meta, window);

      if (result !== undefined) {
        appendOutput('=> ' + formatValue(result), '#80d080');
      }

      var elapsed = (performance.now() - startTime).toFixed(1);
      status.textContent = 'Ran in ' + elapsed + 'ms';
      status.style.color = '#6a6';
    } catch (err) {
      appendOutput('Error: ' + err.message, '#e04040');
      if (err.stack) {
        // Show trimmed stack (remove engine internals)
        var stackLines = err.stack.split('\n').slice(1, 6);
        appendOutput(stackLines.join('\n'), '#a03030');
      }
      status.textContent = 'Error';
      status.style.color = '#e04040';
    } finally {
      // Restore original console
      ['log', 'info', 'warn', 'error'].forEach(function (level) {
        console[level] = savedConsole[level];
      });
    }
  }

  // --- Events ---

  runBtn.addEventListener('click', runScript);
  clearBtn.addEventListener('click', function () {
    output.innerHTML = '';
    status.textContent = '';
  });

  // --- Public API ---

  return {
    run: runScript,
    getTextarea: function () { return textarea; },
    getOutput: function () { return output; },
    clear: function () { output.innerHTML = ''; status.textContent = ''; },
    setScript: function (code) { textarea.value = code; }
  };
}
