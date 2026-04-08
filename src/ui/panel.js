/**
 * WDK floating panel UI.
 * Injects a draggable, resizable panel into any web page.
 * Synthwave 84 dark theme. Zero external dependencies.
 */

var DK_THEME = {
  bg: '#0a0a1a',
  bgLight: '#12122a',
  bgHover: '#1a1a3a',
  cyan: '#00e5ff',
  pink: '#ff2975',
  purple: '#b967ff',
  text: '#e0e0f0',
  textDim: '#8888aa',
  border: '#2a2a4a',
  shadow: 'rgba(0, 229, 255, 0.15)',
};

function injectStyles() {
  if (document.getElementById('dk-panel-styles')) return;
  var style = document.createElement('style');
  style.id = 'dk-panel-styles';
  style.textContent = [
    '.dk-panel {',
    '  position: fixed; top: 60px; right: 20px;',
    '  width: 520px; height: 420px; min-width: 320px; min-height: 220px;',
    '  background: ' + DK_THEME.bg + ';',
    '  border: 1px solid ' + DK_THEME.border + ';',
    '  border-radius: 8px;',
    '  box-shadow: 0 4px 32px ' + DK_THEME.shadow + ', 0 0 1px ' + DK_THEME.cyan + ';',
    '  z-index: 999999;',
    '  display: flex; flex-direction: column;',
    '  font-family: "SF Mono", "Fira Code", "Cascadia Code", "Consolas", monospace;',
    '  font-size: 13px; color: ' + DK_THEME.text + ';',
    '  overflow: hidden; user-select: none;',
    '}',
    '.dk-panel.dk-hidden { display: none; }',
    '.dk-titlebar {',
    '  display: flex; align-items: center; justify-content: space-between;',
    '  padding: 6px 10px; cursor: grab;',
    '  background: linear-gradient(135deg, ' + DK_THEME.bgLight + ', ' + DK_THEME.bg + ');',
    '  border-bottom: 1px solid ' + DK_THEME.border + ';',
    '  flex-shrink: 0;',
    '}',
    '.dk-titlebar:active { cursor: grabbing; }',
    '.dk-title {',
    '  font-weight: 700; font-size: 13px; letter-spacing: 1px;',
    '  background: linear-gradient(90deg, ' + DK_THEME.cyan + ', ' + DK_THEME.purple + ');',
    '  -webkit-background-clip: text; -webkit-text-fill-color: transparent;',
    '  background-clip: text;',
    '}',
    '.dk-titlebar-btns { display: flex; gap: 6px; }',
    '.dk-btn {',
    '  width: 22px; height: 22px; border: none; border-radius: 4px;',
    '  background: ' + DK_THEME.bgHover + '; color: ' + DK_THEME.textDim + ';',
    '  cursor: pointer; font-size: 13px; line-height: 22px; text-align: center;',
    '  padding: 0; transition: background 0.15s, color 0.15s;',
    '}',
    '.dk-btn:hover { background: ' + DK_THEME.purple + '; color: #fff; }',
    '.dk-btn-close:hover { background: ' + DK_THEME.pink + '; color: #fff; }',
    '.dk-content {',
    '  flex: 1; overflow-y: auto; overflow-x: hidden; padding: 8px;',
    '  user-select: text;',
    '}',
    '.dk-content::-webkit-scrollbar { width: 6px; }',
    '.dk-content::-webkit-scrollbar-track { background: ' + DK_THEME.bg + '; }',
    '.dk-content::-webkit-scrollbar-thumb { background: ' + DK_THEME.border + '; border-radius: 3px; }',
    '.dk-statusbar {',
    '  padding: 4px 10px; font-size: 11px; color: ' + DK_THEME.textDim + ';',
    '  border-top: 1px solid ' + DK_THEME.border + ';',
    '  background: ' + DK_THEME.bgLight + ';',
    '  flex-shrink: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
    '}',
    '.dk-resize-handle {',
    '  position: absolute; bottom: 0; right: 0; width: 16px; height: 16px;',
    '  cursor: nwse-resize;',
    '}',
    '.dk-resize-handle::after {',
    '  content: ""; position: absolute; bottom: 3px; right: 3px;',
    '  width: 8px; height: 8px;',
    '  border-right: 2px solid ' + DK_THEME.textDim + ';',
    '  border-bottom: 2px solid ' + DK_THEME.textDim + ';',
    '}',
    '.dk-mini-icon {',
    '  position: fixed; bottom: 16px; right: 16px;',
    '  width: 40px; height: 40px; border-radius: 50%;',
    '  background: linear-gradient(135deg, ' + DK_THEME.purple + ', ' + DK_THEME.cyan + ');',
    '  box-shadow: 0 2px 12px ' + DK_THEME.shadow + ';',
    '  z-index: 999999; cursor: pointer; display: none;',
    '  align-items: center; justify-content: center;',
    '  font-size: 18px; font-weight: 900; color: #fff;',
    '  border: none; line-height: 40px; text-align: center;',
    '}',
    '.dk-mini-icon.dk-visible { display: flex; }',
  ].join('\n');
  document.head.appendChild(style);
}

function createPanel() {
  injectStyles();

  // --- Mini icon (shown when minimized) ---
  var miniIcon = document.createElement('button');
  miniIcon.className = 'dk-mini-icon';
  miniIcon.textContent = 'D';
  miniIcon.title = 'WDK (Ctrl+Shift+D)';

  // --- Main panel ---
  var panel = document.createElement('div');
  panel.className = 'dk-panel';

  // Title bar
  var titlebar = document.createElement('div');
  titlebar.className = 'dk-titlebar';

  var title = document.createElement('span');
  title.className = 'dk-title';
  title.textContent = 'DATAKIT';

  var btns = document.createElement('div');
  btns.className = 'dk-titlebar-btns';

  var minBtn = document.createElement('button');
  minBtn.className = 'dk-btn';
  minBtn.textContent = '\u2013'; // en-dash as minimize
  minBtn.title = 'Minimize';

  var closeBtn = document.createElement('button');
  closeBtn.className = 'dk-btn dk-btn-close';
  closeBtn.textContent = '\u00d7'; // multiplication sign as close
  closeBtn.title = 'Close';

  btns.appendChild(minBtn);
  btns.appendChild(closeBtn);
  titlebar.appendChild(title);
  titlebar.appendChild(btns);

  // Content area
  var contentArea = document.createElement('div');
  contentArea.className = 'dk-content';

  // Status bar
  var statusBar = document.createElement('div');
  statusBar.className = 'dk-statusbar';
  statusBar.textContent = 'Ready';

  // Resize handle
  var resizeHandle = document.createElement('div');
  resizeHandle.className = 'dk-resize-handle';

  panel.appendChild(titlebar);
  panel.appendChild(contentArea);
  panel.appendChild(statusBar);
  panel.appendChild(resizeHandle);

  document.body.appendChild(panel);
  document.body.appendChild(miniIcon);

  // --- Drag logic ---
  var dragState = null;

  titlebar.addEventListener('mousedown', function (e) {
    if (e.target === minBtn || e.target === closeBtn) return;
    e.preventDefault();
    var rect = panel.getBoundingClientRect();
    dragState = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top };
    panel.style.right = 'auto';
    panel.style.left = rect.left + 'px';
    panel.style.top = rect.top + 'px';
  });

  document.addEventListener('mousemove', function (e) {
    if (dragState) {
      e.preventDefault();
      var dx = e.clientX - dragState.startX;
      var dy = e.clientY - dragState.startY;
      panel.style.left = (dragState.origLeft + dx) + 'px';
      panel.style.top = (dragState.origTop + dy) + 'px';
    }
    if (resizeState) {
      e.preventDefault();
      var w = Math.max(320, resizeState.origW + (e.clientX - resizeState.startX));
      var h = Math.max(220, resizeState.origH + (e.clientY - resizeState.startY));
      panel.style.width = w + 'px';
      panel.style.height = h + 'px';
    }
  });

  document.addEventListener('mouseup', function () {
    dragState = null;
    resizeState = null;
  });

  // --- Resize logic ---
  var resizeState = null;

  resizeHandle.addEventListener('mousedown', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var rect = panel.getBoundingClientRect();
    resizeState = { startX: e.clientX, startY: e.clientY, origW: rect.width, origH: rect.height };
  });

  // --- Minimize / restore ---
  var minimized = false;

  function minimize() {
    minimized = true;
    panel.classList.add('dk-hidden');
    miniIcon.classList.add('dk-visible');
  }

  function restore() {
    minimized = false;
    panel.classList.remove('dk-hidden');
    miniIcon.classList.remove('dk-visible');
  }

  minBtn.addEventListener('click', function () { minimize(); });
  miniIcon.addEventListener('click', function () { restore(); });

  // --- Close ---
  closeBtn.addEventListener('click', function () { hide(); });

  // --- Keyboard shortcut ---
  function onKeydown(e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      if (panel.classList.contains('dk-hidden') && !minimized) {
        show();
      } else if (minimized) {
        restore();
      } else {
        hide();
      }
    }
  }
  document.addEventListener('keydown', onKeydown);

  // --- Public API ---
  var visible = true;

  function show() {
    visible = true;
    if (minimized) {
      restore();
    } else {
      panel.classList.remove('dk-hidden');
    }
    miniIcon.classList.remove('dk-visible');
  }

  function hide() {
    visible = false;
    minimized = false;
    panel.classList.add('dk-hidden');
    miniIcon.classList.remove('dk-visible');
  }

  function destroy() {
    document.removeEventListener('keydown', onKeydown);
    if (panel.parentNode) panel.parentNode.removeChild(panel);
    if (miniIcon.parentNode) miniIcon.parentNode.removeChild(miniIcon);
    var styleEl = document.getElementById('dk-panel-styles');
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
  }

  return {
    container: panel,
    contentArea: contentArea,
    statusBar: statusBar,
    show: show,
    hide: hide,
    destroy: destroy,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createPanel: createPanel };
}
