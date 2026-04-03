/**
 * Wiz Pivot Table Panel.
 * Provides a UI for groupBy, aggregate, and pivot operations.
 * Renders config controls and result table inline.
 */

/* global aggregate, pivot, renderTable, DataFrame */

var DK_PIVOT_THEME = {
  bg: '#0d0d22',
  border: '#2a2a4e',
  cyan: '#00e5ff',
  pink: '#ff2975',
  text: '#e0e0f0',
  textDim: '#8888aa',
  inputBg: '#121228',
};

function createPivotPanel(container, getDataFrame) {
  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;font-family:"SF Mono","Fira Code","Consolas",monospace;font-size:12px;color:' + DK_PIVOT_THEME.text + ';';

  // Config area
  var config = document.createElement('div');
  config.style.cssText = 'padding:8px;background:' + DK_PIVOT_THEME.bg + ';border-bottom:1px solid ' + DK_PIVOT_THEME.border + ';display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;';

  // Mode selector
  var modeLabel = _label('Mode');
  var modeSelect = _select(['aggregate', 'pivot']);
  modeLabel.appendChild(modeSelect);

  // Group by
  var groupLabel = _label('Group by');
  var groupSelect = _multiSelect();
  groupLabel.appendChild(groupSelect);

  // Agg column
  var aggColLabel = _label('Value column');
  var aggColSelect = _select([]);
  aggColLabel.appendChild(aggColSelect);

  // Agg function
  var aggFuncLabel = _label('Function');
  var aggFuncSelect = _select(['sum', 'count', 'avg', 'min', 'max', 'distinct', 'first', 'last', 'concat']);
  aggFuncLabel.appendChild(aggFuncSelect);

  // Pivot column (only visible in pivot mode)
  var pivotColLabel = _label('Pivot column');
  var pivotColSelect = _select([]);
  pivotColLabel.appendChild(pivotColSelect);

  // Run button
  var runBtn = document.createElement('button');
  runBtn.textContent = 'Run';
  runBtn.style.cssText = 'background:' + DK_PIVOT_THEME.cyan + ';color:#000;border:none;padding:4px 16px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:bold;border-radius:2px;height:24px;';

  config.appendChild(modeLabel);
  config.appendChild(groupLabel);
  config.appendChild(aggColLabel);
  config.appendChild(aggFuncLabel);
  config.appendChild(pivotColLabel);
  config.appendChild(runBtn);

  // Result area
  var resultArea = document.createElement('div');
  resultArea.style.cssText = 'flex:1;overflow:auto;';

  // Status
  var status = document.createElement('div');
  status.style.cssText = 'padding:4px 8px;font-size:10px;color:' + DK_PIVOT_THEME.textDim + ';';

  wrapper.appendChild(config);
  wrapper.appendChild(resultArea);
  wrapper.appendChild(status);
  container.appendChild(wrapper);

  // Toggle pivot column visibility
  function updateMode() {
    pivotColLabel.style.display = modeSelect.value === 'pivot' ? '' : 'none';
  }
  modeSelect.addEventListener('change', updateMode);
  updateMode();

  // Populate columns from current DataFrame
  function refreshColumns() {
    var df = getDataFrame();
    if (!df) return;
    var headers = df._headers || [];

    // Update group by (multi-select)
    groupSelect.innerHTML = '';
    headers.forEach(function (h) {
      var opt = document.createElement('option');
      opt.value = h;
      opt.textContent = h;
      groupSelect.appendChild(opt);
    });

    // Update value column
    _updateSelect(aggColSelect, headers);
    // Update pivot column
    _updateSelect(pivotColSelect, headers);
  }

  // Run aggregation/pivot
  runBtn.addEventListener('click', function () {
    var df = getDataFrame();
    if (!df || !df._rows.length) {
      status.textContent = 'No data loaded';
      return;
    }

    var selectedGroups = _getSelectedValues(groupSelect);
    if (selectedGroups.length === 0) {
      status.textContent = 'Select at least one group-by column';
      return;
    }

    var mode = modeSelect.value;
    var aggCol = aggColSelect.value;
    var aggFunc = aggFuncSelect.value;

    try {
      var result;
      var t0 = performance.now();

      if (mode === 'aggregate') {
        result = aggregate(df, selectedGroups, [{ column: aggCol, func: aggFunc }]);
      } else {
        var pivotCol = pivotColSelect.value;
        if (!pivotCol) { status.textContent = 'Select a pivot column'; return; }
        result = pivot(df, selectedGroups, pivotCol, aggCol, aggFunc);
      }

      var elapsed = (performance.now() - t0).toFixed(1);

      // Render result as a new table
      resultArea.innerHTML = '';
      var resultDf = { _headers: result.headers, _rows: result.rows };
      if (typeof renderTable === 'function') {
        renderTable(resultArea, resultDf);
      }

      status.textContent = result.rows.length + ' groups \u00b7 ' + elapsed + 'ms';
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
    }
  });

  // Helper: create label
  function _label(text) {
    var el = document.createElement('label');
    el.style.cssText = 'display:flex;flex-direction:column;gap:2px;font-size:10px;color:' + DK_PIVOT_THEME.textDim + ';text-transform:uppercase;letter-spacing:0.5px;';
    var span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    return el;
  }

  // Helper: create select
  function _select(options) {
    var sel = document.createElement('select');
    sel.style.cssText = 'background:' + DK_PIVOT_THEME.inputBg + ';color:' + DK_PIVOT_THEME.text + ';border:1px solid ' + DK_PIVOT_THEME.border + ';padding:2px 4px;font-family:inherit;font-size:12px;min-width:80px;';
    options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      sel.appendChild(opt);
    });
    return sel;
  }

  // Helper: create multi-select
  function _multiSelect() {
    var sel = document.createElement('select');
    sel.multiple = true;
    sel.size = 3;
    sel.style.cssText = 'background:' + DK_PIVOT_THEME.inputBg + ';color:' + DK_PIVOT_THEME.text + ';border:1px solid ' + DK_PIVOT_THEME.border + ';padding:2px 4px;font-family:inherit;font-size:12px;min-width:100px;max-height:60px;';
    return sel;
  }

  function _updateSelect(sel, options) {
    sel.innerHTML = '';
    options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      sel.appendChild(opt);
    });
  }

  function _getSelectedValues(sel) {
    var vals = [];
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].selected) vals.push(sel.options[i].value);
    }
    return vals;
  }

  return {
    refresh: refreshColumns,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createPivotPanel: createPivotPanel };
}
