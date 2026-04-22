/**
 * WDK Robo — browser automation script builder
 * Define actions as JSON, export as Playwright / Selenium / Cypress scripts.
 */
(function () {
  'use strict';
  if (!window.DK) { window.DK = {}; }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  function escStr(s) {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  }

  function escPy(s) {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  function indent(lines, n) {
    var pad = '';
    for (var i = 0; i < n; i++) { pad += ' '; }
    return lines.map(function (l) { return pad + l; });
  }

  /* ------------------------------------------------------------------ */
  /*  buildSelector                                                      */
  /* ------------------------------------------------------------------ */

  function buildSelector(el) {
    if (!el || el.nodeType !== 1) { return ''; }

    // 1. id
    if (el.id) { return '#' + CSS.escape(el.id); }

    // 2. data-testid
    var tid = el.getAttribute('data-testid');
    if (tid) { return '[data-testid="' + tid + '"]'; }

    // 3. tag.class combo — check uniqueness
    var tag = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      var cls = el.className.trim().split(/\s+/).map(function (c) { return '.' + CSS.escape(c); }).join('');
      var candidate = tag + cls;
      if (document.querySelectorAll(candidate).length === 1) { return candidate; }
    }

    // 4. nth-child path
    var parts = [];
    var cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      var p = cur.parentElement;
      if (!p) { break; }
      var children = p.children;
      var idx = 1;
      for (var i = 0; i < children.length; i++) {
        if (children[i] === cur) { idx = i + 1; break; }
      }
      parts.unshift(cur.tagName.toLowerCase() + ':nth-child(' + idx + ')');
      cur = p;
    }
    return parts.join(' > ');
  }

  /* ------------------------------------------------------------------ */
  /*  Playwright export                                                  */
  /* ------------------------------------------------------------------ */

  function toPlaywright(actions, options) {
    var opts = options || {};
    var name = opts.name || 'Automation Script';
    var timeout = opts.timeout || 30000;
    var lines = [];

    lines.push("const { test, expect } = require('@playwright/test');");
    lines.push('');
    if (opts.baseURL) {
      lines.push("test.use({ baseURL: '" + escStr(opts.baseURL) + "' });");
      lines.push('');
    }
    lines.push("test('" + escStr(name) + "', async ({ page }) => {");
    lines.push("  test.setTimeout(" + timeout + ");");

    var extractIdx = 0;
    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      var s = a.selector ? escStr(a.selector) : '';
      switch (a.action) {
        case 'navigate':
          lines.push("  await page.goto('" + escStr(a.url) + "');");
          break;
        case 'wait':
          if (a.selector) {
            lines.push("  await page.waitForSelector('" + s + "', { timeout: " + (a.timeout || timeout) + " });");
          } else {
            lines.push("  await page.waitForTimeout(" + (a.ms || 1000) + ");");
          }
          break;
        case 'click':
          lines.push("  await page.click('" + s + "');");
          break;
        case 'type':
          lines.push("  await page.fill('" + s + "', '" + escStr(a.value || '') + "');");
          break;
        case 'select':
          lines.push("  await page.selectOption('" + s + "', '" + escStr(a.value || '') + "');");
          break;
        case 'press':
          lines.push("  await page.keyboard.press('" + escStr(a.key || a.value || '') + "');");
          break;
        case 'scroll':
          if (a.selector) {
            lines.push("  await page.locator('" + s + "').scrollIntoViewIfNeeded();");
          } else {
            lines.push("  await page.evaluate(() => window.scrollBy(0, " + (a.y || a.pixels || 500) + "));");
          }
          break;
        case 'screenshot':
          lines.push("  await page.screenshot({ path: '" + escStr(a.name || 'screenshot_' + i) + ".png' });");
          break;
        case 'extract':
          var varName = a.as || 'extracted_' + (extractIdx++);
          lines.push("  const " + varName + " = await page.locator('" + s + "').textContent();");
          break;
        case 'assert':
          if (a.text !== undefined) {
            lines.push("  await expect(page.locator('" + s + "')).toHaveText('" + escStr(a.text) + "');");
          } else {
            lines.push("  await expect(page.locator('" + s + "')).toBeVisible();");
          }
          break;
        default:
          lines.push("  // unsupported action: " + (a.action || 'unknown'));
      }
    }

    lines.push('});');
    lines.push('');
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ */
  /*  Selenium (Python) export                                           */
  /* ------------------------------------------------------------------ */

  function toSelenium(actions, options) {
    var opts = options || {};
    var lines = [];

    lines.push('from selenium import webdriver');
    lines.push('from selenium.webdriver.common.by import By');
    lines.push('from selenium.webdriver.common.keys import Keys');
    lines.push('from selenium.webdriver.support.ui import WebDriverWait, Select');
    lines.push('from selenium.webdriver.support import expected_conditions as EC');
    lines.push('import time');
    lines.push('');
    lines.push('driver = webdriver.Chrome()');
    lines.push('driver.implicitly_wait(' + ((opts.timeout || 30000) / 1000) + ')');
    lines.push('');

    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      var s = a.selector ? escPy(a.selector) : '';
      switch (a.action) {
        case 'navigate':
          lines.push('driver.get("' + escPy(a.url) + '")');
          break;
        case 'wait':
          if (a.selector) {
            lines.push('WebDriverWait(driver, ' + ((a.timeout || 10000) / 1000) + ').until(');
            lines.push('    EC.presence_of_element_located((By.CSS_SELECTOR, "' + s + '"))');
            lines.push(')');
          } else {
            lines.push('time.sleep(' + ((a.ms || 1000) / 1000) + ')');
          }
          break;
        case 'click':
          lines.push('driver.find_element(By.CSS_SELECTOR, "' + s + '").click()');
          break;
        case 'type':
          lines.push('el = driver.find_element(By.CSS_SELECTOR, "' + s + '")');
          lines.push('el.clear()');
          lines.push('el.send_keys("' + escPy(a.value || '') + '")');
          break;
        case 'select':
          lines.push('Select(driver.find_element(By.CSS_SELECTOR, "' + s + '")).select_by_value("' + escPy(a.value || '') + '")');
          break;
        case 'press':
          lines.push('driver.find_element(By.TAG_NAME, "body").send_keys(Keys.' + (a.key || a.value || 'ENTER').toUpperCase() + ')');
          break;
        case 'scroll':
          if (a.selector) {
            lines.push('el = driver.find_element(By.CSS_SELECTOR, "' + s + '")');
            lines.push('driver.execute_script("arguments[0].scrollIntoView(true);", el)');
          } else {
            lines.push('driver.execute_script("window.scrollBy(0, ' + (a.y || a.pixels || 500) + ')")');
          }
          break;
        case 'screenshot':
          lines.push('driver.save_screenshot("' + escPy(a.name || 'screenshot_' + i) + '.png")');
          break;
        case 'extract':
          lines.push((a.as || 'extracted') + ' = driver.find_element(By.CSS_SELECTOR, "' + s + '").text');
          break;
        case 'assert':
          if (a.text !== undefined) {
            lines.push('assert driver.find_element(By.CSS_SELECTOR, "' + s + '").text == "' + escPy(a.text) + '"');
          } else {
            lines.push('assert driver.find_element(By.CSS_SELECTOR, "' + s + '").is_displayed()');
          }
          break;
        default:
          lines.push('# unsupported action: ' + (a.action || 'unknown'));
      }
    }

    lines.push('');
    lines.push('driver.quit()');
    lines.push('');
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ */
  /*  Cypress export                                                     */
  /* ------------------------------------------------------------------ */

  function toCypress(actions, options) {
    var opts = options || {};
    var name = opts.name || 'Automation Script';
    var lines = [];

    lines.push("describe('" + escStr(name) + "', () => {");
    lines.push("  it('runs the automation', () => {");

    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      var s = a.selector ? escStr(a.selector) : '';
      switch (a.action) {
        case 'navigate':
          lines.push("    cy.visit('" + escStr(a.url) + "');");
          break;
        case 'wait':
          if (a.selector) {
            lines.push("    cy.get('" + s + "', { timeout: " + (a.timeout || 10000) + " }).should('exist');");
          } else {
            lines.push("    cy.wait(" + (a.ms || 1000) + ");");
          }
          break;
        case 'click':
          lines.push("    cy.get('" + s + "').click();");
          break;
        case 'type':
          lines.push("    cy.get('" + s + "').clear().type('" + escStr(a.value || '') + "');");
          break;
        case 'select':
          lines.push("    cy.get('" + s + "').select('" + escStr(a.value || '') + "');");
          break;
        case 'press':
          lines.push("    cy.get('body').type('{" + (a.key || a.value || 'enter').toLowerCase() + "}');");
          break;
        case 'scroll':
          if (a.selector) {
            lines.push("    cy.get('" + s + "').scrollIntoView();");
          } else {
            lines.push("    cy.scrollTo(0, " + (a.y || a.pixels || 500) + ");");
          }
          break;
        case 'screenshot':
          lines.push("    cy.screenshot('" + escStr(a.name || 'screenshot_' + i) + "');");
          break;
        case 'extract':
          lines.push("    cy.get('" + s + "').invoke('text').as('" + escStr(a.as || 'extracted') + "');");
          break;
        case 'assert':
          if (a.text !== undefined) {
            lines.push("    cy.get('" + s + "').should('have.text', '" + escStr(a.text) + "');");
          } else {
            lines.push("    cy.get('" + s + "').should('be.visible');");
          }
          break;
        default:
          lines.push("    // unsupported action: " + (a.action || 'unknown'));
      }
    }

    lines.push('  });');
    lines.push('});');
    lines.push('');
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ */
  /*  createScript                                                       */
  /* ------------------------------------------------------------------ */

  function createScript(actions, options) {
    var opts = options || {};
    var script = {
      name: opts.name || 'Untitled Script',
      description: opts.description || '',
      actions: actions.slice(),
      createdAt: new Date().toISOString(),

      addAction: function (action) { script.actions.push(action); return script; },
      removeAction: function (idx) { script.actions.splice(idx, 1); return script; },
      toPlaywright: function (o) { return toPlaywright(script.actions, mergeOpts(opts, o)); },
      toSelenium: function (o) { return toSelenium(script.actions, mergeOpts(opts, o)); },
      toCypress: function (o) { return toCypress(script.actions, mergeOpts(opts, o)); },
      toJSON: function () {
        return JSON.stringify({
          name: script.name,
          description: script.description,
          actions: script.actions,
          createdAt: script.createdAt
        }, null, 2);
      }
    };
    return script;
  }

  function mergeOpts(base, extra) {
    if (!extra) { return base; }
    var out = {};
    var k;
    for (k in base) { if (base.hasOwnProperty(k)) { out[k] = base[k]; } }
    for (k in extra) { if (extra.hasOwnProperty(k)) { out[k] = extra[k]; } }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /*  Recorder                                                           */
  /* ------------------------------------------------------------------ */

  function record() {
    var actions = [];
    var active = true;

    function onClick(e) {
      if (!active) { return; }
      var sel = buildSelector(e.target);
      if (sel) { actions.push({ action: 'click', selector: sel }); }
    }

    function onInput(e) {
      if (!active) { return; }
      var el = e.target;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
        var sel = buildSelector(el);
        if (!sel) { return; }
        if (el.tagName === 'SELECT') {
          actions.push({ action: 'select', selector: sel, value: el.value });
        } else {
          // Merge consecutive types on same selector
          var last = actions[actions.length - 1];
          if (last && last.action === 'type' && last.selector === sel) {
            last.value = el.value;
          } else {
            actions.push({ action: 'type', selector: sel, value: el.value });
          }
        }
      }
    }

    function onSubmit(e) {
      if (!active) { return; }
      var sel = buildSelector(e.target);
      if (sel) { actions.push({ action: 'click', selector: sel + ' [type="submit"]' }); }
    }

    function onNav() {
      if (!active) { return; }
      actions.push({ action: 'navigate', url: window.location.href });
    }

    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onInput, true);
    document.addEventListener('submit', onSubmit, true);
    window.addEventListener('popstate', onNav);
    window.addEventListener('hashchange', onNav);

    return {
      stop: function () {
        active = false;
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('change', onInput, true);
        document.removeEventListener('submit', onSubmit, true);
        window.removeEventListener('popstate', onNav);
        window.removeEventListener('hashchange', onNav);
      },
      getActions: function () { return actions.slice(); },
      isRecording: function () { return active; }
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Download                                                           */
  /* ------------------------------------------------------------------ */

  function download(actions, format, options) {
    var opts = options || {};
    var content, ext, mime;

    switch (format) {
      case 'playwright':
        content = toPlaywright(actions, opts);
        ext = '.spec.js';
        mime = 'text/javascript';
        break;
      case 'selenium':
        content = toSelenium(actions, opts);
        ext = '.py';
        mime = 'text/x-python';
        break;
      case 'cypress':
        content = toCypress(actions, opts);
        ext = '.cy.js';
        mime = 'text/javascript';
        break;
      case 'json':
        content = JSON.stringify(actions, null, 2);
        ext = '.json';
        mime = 'application/json';
        break;
      default:
        content = toPlaywright(actions, opts);
        ext = '.spec.js';
        mime = 'text/javascript';
    }

    var name = (opts.name || 'automation').replace(/\s+/g, '-').toLowerCase() + ext;
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ------------------------------------------------------------------ */
  /*  Validate                                                           */
  /* ------------------------------------------------------------------ */

  var VALID_ACTIONS = {
    navigate: ['url'],
    wait: [],
    click: ['selector'],
    type: ['selector', 'value'],
    select: ['selector', 'value'],
    press: [],
    scroll: [],
    screenshot: [],
    extract: ['selector'],
    assert: ['selector']
  };

  function validate(actions) {
    var errors = [];
    if (!Array.isArray(actions)) { return [{ index: -1, message: 'Actions must be an array' }]; }
    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      if (!a || !a.action) {
        errors.push({ index: i, message: 'Missing action property' });
        continue;
      }
      if (!(a.action in VALID_ACTIONS)) {
        errors.push({ index: i, message: 'Unknown action: ' + a.action });
        continue;
      }
      var required = VALID_ACTIONS[a.action];
      for (var j = 0; j < required.length; j++) {
        if (!a[required[j]] && a[required[j]] !== 0) {
          errors.push({ index: i, message: a.action + ' requires ' + required[j] });
        }
      }
    }
    return errors;
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  window.DK.robo = {
    createScript: createScript,
    toPlaywright: toPlaywright,
    toSelenium: toSelenium,
    toCypress: toCypress,
    record: record,
    buildSelector: buildSelector,
    download: download,
    validate: validate
  };
})();
