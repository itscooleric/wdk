/**
 * WDK Automator Panel — bottom-panel UI for record / import / replay
 * / export of automation scripts.
 *
 * Public:
 *   createAutomatorPanel(container, opts) -> { reload, getActions, setActions }
 *
 * Depends on:
 *   window.DK.robo                  (record + export to playwright/selenium/cypress)
 *   window.DK.automator.replay      (in-page replay engine)
 *   window.DK.automator.importRecorder (DevTools Recorder JSON adapter)
 */

/* global DK_SHELL_THEME */

(function () {
  'use strict';

  // Theme defaults — reused if app-shell theme isn't loaded (bookmarklet
  // tier deploys without app-shell).
  var T = (typeof DK_SHELL_THEME !== 'undefined') ? DK_SHELL_THEME : {
    bg: '#0a0a1a',
    bgPanel: '#0d0d20',
    bgHover: '#1a1a3a',
    bgActive: '#1e1e40',
    cyan: '#00e5ff',
    pink: '#ff2975',
    purple: '#b967ff',
    yellow: '#f5e642',
    text: '#e0e0f0',
    textDim: '#8888aa',
    textMuted: '#555577',
    border: '#2a2a4a',
    borderBright: '#3a3a6a'
  };

  var STORAGE_KEY = 'dk-automator-scripts';

  function btn(label, opts) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = (
      'background:' + T.bgHover + ';' +
      'color:' + T.text + ';' +
      'border:1px solid ' + T.border + ';' +
      'border-radius:3px;' +
      'padding:4px 10px;' +
      'font-family:inherit;font-size:11px;cursor:pointer;' +
      'transition:background 0.12s, border-color 0.12s, color 0.12s;' +
      'white-space:nowrap;'
    );
    if (opts && opts.color) {
      b.style.color = opts.color;
      b.style.borderColor = opts.color;
    }
    b.addEventListener('mouseenter', function () { b.style.background = T.bgActive; });
    b.addEventListener('mouseleave', function () { b.style.background = T.bgHover; });
    return b;
  }

  function row() {
    var r = document.createElement('div');
    r.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
    return r;
  }

  function loadLibrary() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) { return []; }
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function saveLibrary(lib) {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lib)); }
    catch (e) { /* private browsing or quota — surface to user */ }
  }

  function createAutomatorPanel(container, opts) {
    opts = opts || {};
    container.innerHTML = '';
    // Don't grow the container past its parent's width — overflow:auto on the
    // floating-panel pane was creating horizontal scroll instead of letting the
    // toolbar's flex-wrap kick in. width:100% + min-width:0 binds it.
    container.style.cssText += 'background:' + T.bgPanel + ';color:' + T.text + ';font-family:inherit;font-size:12px;display:flex;flex-direction:column;width:100%;min-width:0;height:100%;';

    /* state */
    var state = {
      actions: [],
      title: 'Untitled Script',
      recorderHandle: null,
      replayHandle: null
    };

    /* ---- toolbar ---- */
    var toolbar = document.createElement('div');
    toolbar.style.cssText = (
      'display:flex;align-items:center;gap:6px;flex-wrap:wrap;' +
      'padding:6px 10px;border-bottom:1px solid ' + T.border + ';' +
      'background:' + T.bg + ';flex-shrink:0;width:100%;box-sizing:border-box;min-width:0;'
    );

    var btnRecord = btn('Record', { color: T.pink });
    var btnReplay = btn('Replay', { color: T.cyan });
    var btnReplayStop = btn('Stop replay');
    var btnClear = btn('Clear');
    var btnImport = btn('Import Recorder JSON');
    var importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = '.json,application/json';
    importInput.style.cssText = 'display:none;';

    var btnExportPW  = btn('Export Playwright');
    var btnExportSE  = btn('Export Selenium');
    var btnExportCY  = btn('Export Cypress');
    var btnExportJS  = btn('Export JSON');
    var btnSave      = btn('Save to library');
    var btnLib       = btn('Library');

    btnReplayStop.disabled = true;
    btnReplayStop.style.opacity = '0.4';
    btnReplayStop.style.cursor = 'not-allowed';

    var titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = state.title;
    titleInput.style.cssText = (
      'background:' + T.bgHover + ';color:' + T.text + ';' +
      'border:1px solid ' + T.border + ';border-radius:3px;' +
      'padding:4px 8px;font-family:inherit;font-size:11px;' +
      'min-width:160px;'
    );
    titleInput.addEventListener('input', function () { state.title = titleInput.value; });

    var statusBox = document.createElement('span');
    statusBox.style.cssText = 'color:' + T.textDim + ';font-size:11px;margin-left:auto;';
    statusBox.textContent = 'idle';

    toolbar.appendChild(btnRecord);
    toolbar.appendChild(btnReplay);
    toolbar.appendChild(btnReplayStop);
    toolbar.appendChild(btnClear);
    var sep = document.createElement('span');
    sep.style.cssText = 'width:1px;height:20px;background:' + T.border + ';';
    toolbar.appendChild(sep);
    toolbar.appendChild(btnImport);
    toolbar.appendChild(importInput);
    var sep2 = sep.cloneNode(false);
    toolbar.appendChild(sep2);
    toolbar.appendChild(btnExportPW);
    toolbar.appendChild(btnExportSE);
    toolbar.appendChild(btnExportCY);
    toolbar.appendChild(btnExportJS);
    var sep3 = sep.cloneNode(false);
    toolbar.appendChild(sep3);
    toolbar.appendChild(btnSave);
    toolbar.appendChild(btnLib);
    var sep4 = sep.cloneNode(false);
    toolbar.appendChild(sep4);
    toolbar.appendChild(titleInput);
    toolbar.appendChild(statusBox);

    /* ---- action list ---- */
    var listWrap = document.createElement('div');
    listWrap.style.cssText = 'flex:1;overflow:auto;padding:8px 10px;';

    function setStatus(msg, color) {
      statusBox.textContent = msg;
      statusBox.style.color = color || T.textDim;
    }

    function renderList() {
      listWrap.innerHTML = '';
      if (!state.actions.length) {
        var empty = document.createElement('div');
        empty.style.cssText = 'color:' + T.textMuted + ';padding:24px 0;text-align:center;';
        empty.textContent = 'No actions. Click Record to capture clicks/types/navigations on this page, or Import a Chrome DevTools Recorder JSON.';
        listWrap.appendChild(empty);
        return;
      }

      var table = document.createElement('table');
      table.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px;';
      var head = document.createElement('thead');
      head.innerHTML = (
        '<tr style="color:' + T.textDim + ';text-align:left;">' +
        '<th style="padding:4px 6px;width:32px;">#</th>' +
        '<th style="padding:4px 6px;width:120px;">Action</th>' +
        '<th style="padding:4px 6px;">Selector / URL / Key</th>' +
        '<th style="padding:4px 6px;">Value</th>' +
        '<th style="padding:4px 6px;width:80px;">&nbsp;</th>' +
        '</tr>'
      );
      table.appendChild(head);

      var body = document.createElement('tbody');
      state.actions.forEach(function (a, i) {
        var tr = document.createElement('tr');
        tr.style.cssText = 'border-top:1px solid ' + T.border + ';';
        tr.dataset.idx = String(i);

        var idxCell = document.createElement('td');
        idxCell.style.cssText = 'padding:4px 6px;color:' + T.textMuted + ';';
        idxCell.textContent = String(i + 1);

        var actCell = document.createElement('td');
        actCell.style.cssText = 'padding:4px 6px;color:' + T.cyan + ';';
        actCell.textContent = a.action || '?';

        var targetCell = document.createElement('td');
        targetCell.style.cssText = 'padding:4px 6px;color:' + T.text + ';font-family:inherit;word-break:break-all;';
        targetCell.textContent = a.selector || a.url || a.key || a.expression || '';

        var valCell = document.createElement('td');
        valCell.style.cssText = 'padding:4px 6px;color:' + T.yellow + ';';
        var valInput = document.createElement('input');
        valInput.type = 'text';
        valInput.value = a.value != null ? a.value : '';
        valInput.placeholder = a.action === 'type' || a.action === 'select' ? '(value)' : '';
        valInput.style.cssText = (
          'background:transparent;color:' + T.yellow + ';' +
          'border:1px solid transparent;border-radius:3px;' +
          'padding:2px 4px;font-family:inherit;font-size:11px;width:100%;'
        );
        valInput.addEventListener('focus', function () { valInput.style.borderColor = T.border; });
        valInput.addEventListener('blur', function () { valInput.style.borderColor = 'transparent'; });
        valInput.addEventListener('input', function () { a.value = valInput.value; });
        valCell.appendChild(valInput);

        var actionsCell = document.createElement('td');
        actionsCell.style.cssText = 'padding:4px 6px;text-align:right;';
        var bUp = btn('^'); bUp.title = 'Move up'; bUp.style.padding = '2px 6px';
        var bDn = btn('v'); bDn.title = 'Move down'; bDn.style.padding = '2px 6px';
        var bDel = btn('x', { color: T.pink }); bDel.title = 'Delete'; bDel.style.padding = '2px 6px';
        bUp.addEventListener('click', function () {
          if (i === 0) { return; }
          var prev = state.actions[i - 1];
          state.actions[i - 1] = a;
          state.actions[i] = prev;
          renderList();
        });
        bDn.addEventListener('click', function () {
          if (i === state.actions.length - 1) { return; }
          var nxt = state.actions[i + 1];
          state.actions[i + 1] = a;
          state.actions[i] = nxt;
          renderList();
        });
        bDel.addEventListener('click', function () {
          state.actions.splice(i, 1);
          renderList();
        });
        actionsCell.appendChild(bUp);
        actionsCell.appendChild(bDn);
        actionsCell.appendChild(bDel);

        tr.appendChild(idxCell);
        tr.appendChild(actCell);
        tr.appendChild(targetCell);
        tr.appendChild(valCell);
        tr.appendChild(actionsCell);
        body.appendChild(tr);
      });
      table.appendChild(body);
      listWrap.appendChild(table);
    }

    /* ---- handlers ---- */

    btnRecord.addEventListener('click', function () {
      if (!window.DK || !window.DK.robo || !window.DK.robo.record) {
        setStatus('robo lib not loaded', T.pink);
        return;
      }
      if (state.recorderHandle) {
        // stop
        var captured = state.recorderHandle.getActions();
        state.recorderHandle.stop();
        state.recorderHandle = null;
        btnRecord.textContent = 'Record';
        btnRecord.style.color = T.pink;
        // append captured actions
        captured.forEach(function (a) { state.actions.push(a); });
        setStatus('Captured ' + captured.length + ' action(s)', T.cyan);
        renderList();
      } else {
        state.recorderHandle = window.DK.robo.record();
        btnRecord.textContent = 'Stop recording';
        btnRecord.style.color = T.cyan;
        setStatus('Recording - interact with the page, then click Stop', T.pink);
      }
    });

    btnReplay.addEventListener('click', function () {
      if (!window.DK || !window.DK.automator || !window.DK.automator.replay) {
        setStatus('replay engine not loaded', T.pink);
        return;
      }
      if (state.replayHandle) { return; }
      if (!state.actions.length) {
        setStatus('Nothing to replay', T.pink);
        return;
      }

      var total = state.actions.length;
      btnReplay.disabled = true; btnReplay.style.opacity = '0.4';
      btnReplayStop.disabled = false; btnReplayStop.style.opacity = '1';
      setStatus('Replaying 0/' + total + '...', T.cyan);

      state.replayHandle = window.DK.automator.replay(state.actions, {
        stepDelay: 200,
        timeout: 5000,
        continueOnError: false,
        onStep: function (i) {
          setStatus('Replaying ' + (i + 1) + '/' + total + '...', T.cyan);
          var trs = listWrap.querySelectorAll('tr[data-idx]');
          trs.forEach(function (tr) {
            tr.style.background = (Number(tr.dataset.idx) === i) ? T.bgActive : '';
          });
        },
        onError: function (i, _a, err) {
          setStatus('FAILED at step ' + (i + 1) + ': ' + err.message, T.pink);
        },
        onDone: function () {
          setStatus('Replay complete: ' + total + ' step(s)', T.cyan);
        }
      });

      state.replayHandle.promise.then(function () {
        state.replayHandle = null;
        btnReplay.disabled = false; btnReplay.style.opacity = '1';
        btnReplayStop.disabled = true; btnReplayStop.style.opacity = '0.4';
      });
    });

    btnReplayStop.addEventListener('click', function () {
      if (state.replayHandle) {
        state.replayHandle.stop();
        setStatus('Replay aborted', T.pink);
      }
    });

    btnClear.addEventListener('click', function () {
      state.actions = [];
      renderList();
      setStatus('Cleared');
    });

    btnImport.addEventListener('click', function () { importInput.click(); });
    importInput.addEventListener('change', function () {
      var f = importInput.files && importInput.files[0];
      if (!f) { return; }
      if (!window.DK.automator || !window.DK.automator.importRecorder) {
        setStatus('importer not loaded', T.pink);
        return;
      }
      window.DK.automator.importRecorder(f).then(function (script) {
        state.actions = state.actions.concat(script.actions);
        if (script.title && state.title === 'Untitled Script') {
          state.title = script.title;
          titleInput.value = state.title;
        }
        var msg = 'Imported ' + script.actions.length + ' action(s)';
        if (script.skipped && script.skipped.length) {
          msg += ' (' + script.skipped.length + ' skipped)';
        }
        setStatus(msg, T.cyan);
        renderList();
      }, function (err) {
        setStatus('Import failed: ' + err.message, T.pink);
      });
      importInput.value = '';
    });

    function exportAs(format) {
      if (!window.DK || !window.DK.robo || !window.DK.robo.download) {
        setStatus('exporter not loaded', T.pink);
        return;
      }
      if (!state.actions.length) {
        setStatus('Nothing to export', T.pink);
        return;
      }
      window.DK.robo.download(state.actions, format, { name: state.title });
      setStatus('Downloaded ' + format, T.cyan);
    }
    btnExportPW.addEventListener('click', function () { exportAs('playwright'); });
    btnExportSE.addEventListener('click', function () { exportAs('selenium'); });
    btnExportCY.addEventListener('click', function () { exportAs('cypress'); });
    btnExportJS.addEventListener('click', function () { exportAs('json'); });

    btnSave.addEventListener('click', function () {
      var lib = loadLibrary();
      lib.push({
        title: state.title,
        actions: state.actions.slice(),
        savedAt: new Date().toISOString()
      });
      saveLibrary(lib);
      setStatus('Saved "' + state.title + '" (' + lib.length + ' in library)', T.cyan);
    });

    btnLib.addEventListener('click', function () { showLibrary(); });

    /* ---- library overlay ---- */
    var overlay = null;
    function showLibrary() {
      if (overlay) { closeLibrary(); return; }
      var lib = loadLibrary();
      overlay = document.createElement('div');
      overlay.style.cssText = (
        'position:absolute;inset:0;background:rgba(0,0,0,0.7);' +
        'display:flex;align-items:center;justify-content:center;z-index:999;'
      );
      var box = document.createElement('div');
      box.style.cssText = (
        'background:' + T.bgPanel + ';color:' + T.text + ';' +
        'border:1px solid ' + T.borderBright + ';border-radius:6px;' +
        'min-width:480px;max-width:80%;max-height:80%;overflow:auto;' +
        'padding:16px;font-family:inherit;font-size:12px;'
      );
      var hdr = document.createElement('div');
      hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;';
      var ttl = document.createElement('div');
      ttl.textContent = 'Script Library - ' + lib.length + ' saved';
      ttl.style.cssText = 'color:' + T.cyan + ';font-size:13px;font-weight:bold;';
      var bClose = btn('Close');
      bClose.addEventListener('click', closeLibrary);
      hdr.appendChild(ttl); hdr.appendChild(bClose);
      box.appendChild(hdr);

      if (!lib.length) {
        var em = document.createElement('div');
        em.textContent = 'No saved scripts yet.';
        em.style.cssText = 'color:' + T.textMuted + ';padding:24px 0;text-align:center;';
        box.appendChild(em);
      } else {
        lib.forEach(function (s, idx) {
          var rowEl = row();
          rowEl.style.padding = '6px 0';
          rowEl.style.borderBottom = '1px solid ' + T.border;
          var label = document.createElement('div');
          label.style.cssText = 'flex:1;';
          label.innerHTML = (
            '<div style="color:' + T.text + ';">' + escHTML(s.title || '(untitled)') + '</div>' +
            '<div style="color:' + T.textMuted + ';font-size:10px;">' +
            (s.actions ? s.actions.length : 0) + ' action(s) - saved ' +
            escHTML((s.savedAt || '').replace('T', ' ').slice(0, 16)) + '</div>'
          );
          var bLoad = btn('Load', { color: T.cyan });
          var bDel  = btn('Delete', { color: T.pink });
          bLoad.addEventListener('click', function () {
            state.actions = (s.actions || []).slice();
            state.title = s.title || 'Untitled';
            titleInput.value = state.title;
            renderList();
            setStatus('Loaded "' + state.title + '"', T.cyan);
            closeLibrary();
          });
          bDel.addEventListener('click', function () {
            var l2 = loadLibrary();
            l2.splice(idx, 1);
            saveLibrary(l2);
            closeLibrary(); showLibrary();
          });
          rowEl.appendChild(label);
          rowEl.appendChild(bLoad);
          rowEl.appendChild(bDel);
          box.appendChild(rowEl);
        });
      }

      overlay.appendChild(box);
      container.appendChild(overlay);
    }
    function closeLibrary() {
      if (overlay && overlay.parentNode) { overlay.parentNode.removeChild(overlay); }
      overlay = null;
    }

    function escHTML(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    /* ---- mount ---- */
    container.appendChild(toolbar);
    container.appendChild(listWrap);
    renderList();

    /* ---- public API ---- */
    return {
      reload:    renderList,
      getActions: function () { return state.actions.slice(); },
      setActions: function (a) { state.actions = (a || []).slice(); renderList(); },
      getTitle:   function () { return state.title; },
      setTitle:   function (t) { state.title = t; titleInput.value = t; }
    };
  }

  if (typeof window !== 'undefined') {
    window.createAutomatorPanel = createAutomatorPanel;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createAutomatorPanel: createAutomatorPanel };
  }
})();
