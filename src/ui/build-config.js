/**
 * WDK Build Configurator UI.
 * Shows all modules with sizes, toggle on/off, displays build tier estimates.
 * Helps users understand what's included at each build level.
 */

var DK_BUILD_MODULES = [
  // Core (always included)
  { name: 'CSV Parser', file: 'parsers/csv.js', size: 2019, tier: 'core', required: true },
  { name: 'JSON Parser', file: 'parsers/json.js', size: 4449, tier: 'core', required: true },
  { name: 'DataFrame', file: 'transforms/data-model.js', size: 2827, tier: 'core', required: true },
  { name: 'Pipeline (Undo/Redo)', file: 'transforms/pipeline.js', size: 3469, tier: 'core', required: true },
  { name: 'Type Detection', file: 'util/detect-types.js', size: 3157, tier: 'core', required: true },
  { name: 'Export (CSV/JSON)', file: 'export/export.js', size: 3435, tier: 'core', required: true },
  { name: 'Table Renderer', file: 'ui/table.js', size: 8335, tier: 'core', required: true },
  { name: 'File Import', file: 'ui/file-import.js', size: 8674, tier: 'core', required: true },
  { name: 'App Shell', file: 'ui/app-shell.js', size: 29680, tier: 'core', required: true },
  { name: 'Panel System', file: 'ui/panel.js', size: 9279, tier: 'core', required: true },

  // Optional — Tier 1 (bookmarklet-friendly)
  { name: 'Redaction (hash/mask)', file: 'transforms/redact.js', size: 2051, tier: 'clean', required: false },
  { name: 'REPL', file: 'ui/repl.js', size: 6264, tier: 'scripting', required: false },

  // Optional — Tier 2 (standalone HTML)
  { name: 'ZIP Parser', file: 'parsers/zip.js', size: 3318, tier: 'xlsx', required: false },
  { name: 'XLSX Parser', file: 'parsers/xlsx.js', size: 18570, tier: 'xlsx', required: false },
  { name: 'Pivot Engine', file: 'transforms/pivot.js', size: 6825, tier: 'analysis', required: false },
  { name: 'Pivot Panel', file: 'ui/pivot-panel.js', size: 6668, tier: 'analysis', required: false },
  { name: 'SQL Functions', file: 'transforms/sql-functions.js', size: 7464, tier: 'analysis', required: false },
  { name: 'SQL Engine', file: 'transforms/sql.js', size: 11705, tier: 'analysis', required: false },
  { name: 'Notebook', file: 'ui/notebook.js', size: 9613, tier: 'analysis', required: false },

  // Optional — Inspector (bookmarklet-only)
  { name: 'DOM Scraper', file: 'inspect/dom-scraper.js', size: 5596, tier: 'inspect', required: false },
  { name: 'Network Interceptor', file: 'inspect/network-interceptor.js', size: 4506, tier: 'inspect', required: false },
  { name: 'Storage Viewer', file: 'inspect/storage-viewer.js', size: 2318, tier: 'inspect', required: false },
  { name: 'Console Capture', file: 'inspect/console-capture.js', size: 2032, tier: 'inspect', required: false },
];

var DK_BUILD_TIERS = {
  core: { label: 'Core', color: '#00e5ff', desc: 'Always included' },
  clean: { label: 'Clean Room', color: '#b967ff', desc: 'Redaction tools' },
  scripting: { label: 'Scripting', color: '#ffe066', desc: 'REPL console' },
  xlsx: { label: 'XLSX', color: '#ff8c42', desc: 'Excel file support' },
  analysis: { label: 'Analysis', color: '#80d080', desc: 'Pivot, SQL, Notebook' },
  inspect: { label: 'Inspector', color: '#ff2975', desc: 'Page inspection (bookmarklet)' },
};

var DK_BUILD_PRESETS = {
  bookmarklet: { label: 'Bookmarklet', tiers: ['core', 'clean', 'inspect'], desc: 'Inject into any page. <100KB target.' },
  standalone: { label: 'Standalone HTML', tiers: ['core', 'clean', 'scripting', 'xlsx', 'analysis'], desc: 'Full-featured, open locally.' },
  full: { label: 'Full (all modules)', tiers: ['core', 'clean', 'scripting', 'xlsx', 'analysis', 'inspect'], desc: 'Everything included.' },
  minimal: { label: 'Minimal (CSV only)', tiers: ['core'], desc: 'Core only, smallest footprint.' },
};

function createBuildConfig(container) {
  var theme = { bg: '#0d0d22', cellBg: '#121228', border: '#2a2a4e', text: '#e0e0f0', textDim: '#8888aa', cyan: '#00e5ff' };

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'font-family:"SF Mono","Fira Code","Consolas",monospace;font-size:12px;color:' + theme.text + ';background:' + theme.bg + ';padding:16px;overflow-y:auto;height:100%;';

  // Title
  var title = document.createElement('h3');
  title.textContent = 'Build Configurator';
  title.style.cssText = 'margin:0 0 12px;color:' + theme.cyan + ';font-size:14px;';
  wrapper.appendChild(title);

  // Presets
  var presetBar = document.createElement('div');
  presetBar.style.cssText = 'display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;';
  Object.keys(DK_BUILD_PRESETS).forEach(function (key) {
    var preset = DK_BUILD_PRESETS[key];
    var btn = document.createElement('button');
    btn.textContent = preset.label;
    btn.title = preset.desc;
    btn.style.cssText = 'background:transparent;color:' + theme.cyan + ';border:1px solid ' + theme.border + ';padding:3px 10px;cursor:pointer;font-family:inherit;font-size:11px;border-radius:2px;';
    btn.addEventListener('click', function () {
      DK_BUILD_MODULES.forEach(function (mod, i) {
        if (mod.required) return;
        checkboxes[i].checked = preset.tiers.indexOf(mod.tier) >= 0;
      });
      updateSummary();
    });
    btn.addEventListener('mouseenter', function () { btn.style.borderColor = theme.cyan; });
    btn.addEventListener('mouseleave', function () { btn.style.borderColor = theme.border; });
    presetBar.appendChild(btn);
  });
  wrapper.appendChild(presetBar);

  // Module list
  var table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:collapse;';

  var thead = document.createElement('thead');
  var headRow = document.createElement('tr');
  ['', 'Module', 'Tier', 'Size'].forEach(function (h) {
    var th = document.createElement('th');
    th.textContent = h;
    th.style.cssText = 'text-align:left;padding:4px 8px;border-bottom:1px solid ' + theme.border + ';color:' + theme.textDim + ';font-size:10px;text-transform:uppercase;';
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  var tbody = document.createElement('tbody');
  var checkboxes = [];

  DK_BUILD_MODULES.forEach(function (mod, i) {
    var tr = document.createElement('tr');

    // Checkbox
    var tdCheck = document.createElement('td');
    tdCheck.style.cssText = 'padding:3px 8px;';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.disabled = mod.required;
    cb.addEventListener('change', updateSummary);
    checkboxes.push(cb);
    tdCheck.appendChild(cb);

    // Name
    var tdName = document.createElement('td');
    tdName.style.cssText = 'padding:3px 8px;color:' + (mod.required ? theme.text : theme.textDim) + ';';
    tdName.textContent = mod.name;

    // Tier
    var tdTier = document.createElement('td');
    tdTier.style.cssText = 'padding:3px 8px;';
    var tierBadge = document.createElement('span');
    var tierInfo = DK_BUILD_TIERS[mod.tier];
    tierBadge.textContent = tierInfo.label;
    tierBadge.style.cssText = 'font-size:10px;color:' + tierInfo.color + ';border:1px solid ' + tierInfo.color + ';padding:1px 4px;border-radius:2px;';
    tdTier.appendChild(tierBadge);

    // Size
    var tdSize = document.createElement('td');
    tdSize.style.cssText = 'padding:3px 8px;text-align:right;color:' + theme.textDim + ';font-size:11px;';
    tdSize.textContent = formatKB(mod.size);

    tr.appendChild(tdCheck);
    tr.appendChild(tdName);
    tr.appendChild(tdTier);
    tr.appendChild(tdSize);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrapper.appendChild(table);

  // Summary
  var summary = document.createElement('div');
  summary.style.cssText = 'margin-top:12px;padding:8px;border:1px solid ' + theme.border + ';border-radius:3px;';
  wrapper.appendChild(summary);

  // Action buttons
  var actionBar = document.createElement('div');
  actionBar.style.cssText = 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;';

  var copyBmBtn = document.createElement('button');
  copyBmBtn.textContent = 'Copy Bookmarklet';
  copyBmBtn.style.cssText = 'background:' + theme.cyan + ';color:#0a0a1a;border:none;padding:6px 14px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:bold;border-radius:2px;';
  copyBmBtn.addEventListener('click', function () {
    var scripts = document.querySelectorAll('script');
    var js = '';
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].textContent.length > 1000) { js = scripts[i].textContent; break; }
    }
    if (!js) { copyBmBtn.textContent = 'No script found'; return; }
    var uri = 'javascript:' + encodeURIComponent(js);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(uri).then(function () {
        copyBmBtn.textContent = 'Copied!';
        setTimeout(function () { copyBmBtn.textContent = 'Copy Bookmarklet'; }, 2000);
      });
    } else {
      var ta = document.createElement('textarea');
      ta.value = uri;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      copyBmBtn.textContent = 'Copied!';
      setTimeout(function () { copyBmBtn.textContent = 'Copy Bookmarklet'; }, 2000);
    }
  });

  var dlHtmlBtn = document.createElement('button');
  dlHtmlBtn.textContent = 'Download HTML';
  dlHtmlBtn.style.cssText = 'background:transparent;color:' + theme.cyan + ';border:1px solid ' + theme.border + ';padding:6px 14px;cursor:pointer;font-family:inherit;font-size:11px;border-radius:2px;';
  dlHtmlBtn.addEventListener('click', function () {
    var html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
    var blob = new Blob([html], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'wdk.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  actionBar.appendChild(copyBmBtn);
  actionBar.appendChild(dlHtmlBtn);
  wrapper.appendChild(actionBar);

  container.appendChild(wrapper);
  updateSummary();

  function updateSummary() {
    var total = 0, count = 0;
    DK_BUILD_MODULES.forEach(function (mod, i) {
      if (checkboxes[i].checked) {
        total += mod.size;
        count++;
      }
    });
    // Estimate: IIFE wrapper + minification factor ~0.7
    var rawKB = total / 1024;
    var minEst = rawKB * 0.7;
    summary.innerHTML = '<span style="color:' + theme.cyan + ';font-weight:bold;">' + count + '/' + DK_BUILD_MODULES.length + ' modules</span>' +
      ' \u00b7 Raw: <b>' + rawKB.toFixed(1) + ' KB</b>' +
      ' \u00b7 Est. minified: <b>' + minEst.toFixed(1) + ' KB</b>' +
      (minEst < 100 ? ' \u00b7 <span style="color:#80d080;">Bookmarklet OK</span>' : ' \u00b7 <span style="color:#ff8c42;">Standalone+ only</span>');
  }

  function formatKB(bytes) {
    return (bytes / 1024).toFixed(1) + ' KB';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createBuildConfig: createBuildConfig, DK_BUILD_MODULES: DK_BUILD_MODULES };
}
