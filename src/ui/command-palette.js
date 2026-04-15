/**
 * WDK Command Palette
 * Searchable action list triggered by Ctrl+P.
 * Fuzzy subsequence matching, keyboard navigation, Synthwave 84 theme.
 */

function createCommandPalette(actions) {
  var overlay = null;
  var isOpen = false;
  var selectedIndex = 0;
  var filteredActions = actions.slice();

  function fuzzyMatch(query, label) {
    var q = query.toLowerCase();
    var l = label.toLowerCase();
    var qi = 0;
    for (var li = 0; li < l.length && qi < q.length; li++) {
      if (l.charAt(li) === q.charAt(qi)) {
        qi++;
      }
    }
    return qi === q.length;
  }

  function injectPaletteStyles() {
    if (document.getElementById('dk-palette-styles')) return;
    var style = document.createElement('style');
    style.id = 'dk-palette-styles';
    style.textContent = [
      '.dk-palette-overlay {',
      '  position: fixed; top: 0; left: 0; width: 100%; height: 100%;',
      '  background: rgba(0,0,0,0.7); z-index: 10001;',
      '  display: flex; align-items: flex-start; justify-content: center;',
      '  padding-top: 20vh;',
      '}',
      '.dk-palette-box {',
      '  background: #12122a; border: 1px solid #2a2a4e; border-radius: 6px;',
      '  width: 420px; max-width: 90vw; overflow: hidden;',
      '  box-shadow: 0 8px 32px rgba(0,0,0,0.5);',
      '}',
      '.dk-palette-input {',
      '  background: #0a0a1a; color: #e0e0f0;',
      '  border: none; border-bottom: 1px solid #2a2a4e;',
      '  padding: 10px 14px; font-size: 14px; width: 100%;',
      '  font-family: "SF Mono", "Fira Code", "Consolas", monospace;',
      '  outline: none; box-sizing: border-box;',
      '}',
      '.dk-palette-input::placeholder { color: #555577; }',
      '.dk-palette-list {',
      '  max-height: ' + (12 * 32) + 'px; overflow-y: auto;',
      '  scrollbar-width: thin; scrollbar-color: #2a2a4e #12122a;',
      '}',
      '.dk-palette-item {',
      '  padding: 6px 14px; cursor: pointer;',
      '  display: flex; align-items: center;',
      '  font-family: "SF Mono", "Fira Code", "Consolas", monospace;',
      '  font-size: 13px; color: #e0e0f0;',
      '  border-left: 2px solid transparent;',
      '}',
      '.dk-palette-item:hover, .dk-palette-item.dk-palette-active {',
      '  background: #1a1a3a;',
      '}',
      '.dk-palette-item.dk-palette-active {',
      '  border-left: 2px solid #00e5ff;',
      '}',
      '.dk-palette-icon {',
      '  margin-right: 10px; font-size: 14px; width: 18px; text-align: center;',
      '}',
      '.dk-palette-label { flex: 1; }',
      '.dk-palette-shortcut {',
      '  color: #8888aa; font-size: 10px; float: right; margin-left: 12px;',
      '}',
      '.dk-palette-empty {',
      '  padding: 12px 14px; color: #555577; font-style: italic;',
      '  font-size: 12px; text-align: center;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function buildUI() {
    injectPaletteStyles();

    overlay = document.createElement('div');
    overlay.className = 'dk-palette-overlay';

    var box = document.createElement('div');
    box.className = 'dk-palette-box';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'dk-palette-input';
    input.placeholder = 'Type a command...';

    var list = document.createElement('div');
    list.className = 'dk-palette-list';

    box.appendChild(input);
    box.appendChild(list);
    overlay.appendChild(box);

    function renderList() {
      list.innerHTML = '';
      if (filteredActions.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'dk-palette-empty';
        empty.textContent = 'No matching commands';
        list.appendChild(empty);
        return;
      }
      for (var i = 0; i < filteredActions.length; i++) {
        var action = filteredActions[i];
        var item = document.createElement('div');
        item.className = 'dk-palette-item';
        if (i === selectedIndex) {
          item.classList.add('dk-palette-active');
        }

        var icon = document.createElement('span');
        icon.className = 'dk-palette-icon';
        icon.textContent = action.icon || '';
        item.appendChild(icon);

        var label = document.createElement('span');
        label.className = 'dk-palette-label';
        label.textContent = action.label;
        item.appendChild(label);

        if (action.shortcut) {
          var shortcut = document.createElement('span');
          shortcut.className = 'dk-palette-shortcut';
          shortcut.textContent = action.shortcut;
          item.appendChild(shortcut);
        }

        (function (idx, act) {
          item.addEventListener('click', function () {
            close();
            if (act.handler) act.handler();
          });
          item.addEventListener('mouseenter', function () {
            selectedIndex = idx;
            renderList();
          });
        })(i, action);

        list.appendChild(item);
      }

      // Scroll active item into view
      var activeItem = list.querySelector('.dk-palette-active');
      if (activeItem) {
        activeItem.scrollIntoView({ block: 'nearest' });
      }
    }

    input.addEventListener('input', function () {
      var query = input.value;
      if (!query) {
        filteredActions = actions.slice();
      } else {
        filteredActions = actions.filter(function (a) {
          return fuzzyMatch(query, a.label);
        });
      }
      selectedIndex = 0;
      renderList();
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filteredActions.length > 0) {
          selectedIndex = (selectedIndex + 1) % filteredActions.length;
          renderList();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filteredActions.length > 0) {
          selectedIndex = (selectedIndex - 1 + filteredActions.length) % filteredActions.length;
          renderList();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredActions.length > 0 && filteredActions[selectedIndex]) {
          var handler = filteredActions[selectedIndex].handler;
          close();
          if (handler) handler();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        close();
      }
    });

    renderList();

    return { overlay: overlay, input: input, renderList: renderList };
  }

  var ui = null;

  function open() {
    if (isOpen) return;
    isOpen = true;
    filteredActions = actions.slice();
    selectedIndex = 0;
    if (!ui) {
      ui = buildUI();
    } else {
      ui.input.value = '';
      filteredActions = actions.slice();
      selectedIndex = 0;
      ui.renderList();
    }
    document.body.appendChild(ui.overlay);
    ui.input.focus();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    if (ui && ui.overlay.parentNode) {
      ui.overlay.parentNode.removeChild(ui.overlay);
    }
  }

  function toggle() {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }

  return {
    open: open,
    close: close,
    toggle: toggle
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createCommandPalette: createCommandPalette };
}
