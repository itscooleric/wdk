/**
 * SharePoint Connection & Auth Foundation
 * Digest-based auth via contextinfo endpoint, base spFetch wrapper,
 * on-domain detection, and settings UI.
 * Zero external dependencies.
 */

/* global DK_SHELL_THEME */

var _spDigestCache = { value: null, expiry: 0, siteUrl: null };

/**
 * Detect if currently running on a SharePoint domain.
 * Checks for SP global objects and _api availability.
 * @returns {boolean}
 */
export function spDetectOnDomain() {
  if (typeof _spPageContextInfo !== 'undefined') return true;
  if (document.getElementById('s4-workspace')) return true;
  var metaGen = document.querySelector('meta[name="GENERATOR"]');
  if (metaGen && /sharepoint/i.test(metaGen.content)) return true;
  return false;
}

/**
 * Get the site URL from page context or user config.
 * @returns {string|null}
 */
export function spGetSiteUrl() {
  if (typeof _spPageContextInfo !== 'undefined' && _spPageContextInfo.webAbsoluteUrl) {
    return _spPageContextInfo.webAbsoluteUrl;
  }
  return null;
}

/**
 * Fetch a form digest value from the contextinfo endpoint.
 * Caches the digest and refreshes when expired.
 * @param {string} siteUrl - The SharePoint site URL
 * @returns {Promise<string>} The form digest value
 */
export async function spGetDigest(siteUrl) {
  var now = Date.now();
  if (_spDigestCache.value && _spDigestCache.siteUrl === siteUrl && now < _spDigestCache.expiry) {
    return _spDigestCache.value;
  }

  var resp = await fetch(siteUrl + '/_api/contextinfo', {
    method: 'POST',
    headers: { 'Accept': 'application/json;odata=verbose' },
    credentials: 'include',
    body: ''
  });

  if (!resp.ok) {
    throw new Error('Failed to get digest: HTTP ' + resp.status);
  }

  var data = await resp.json();
  var info = data.d
    ? data.d.GetContextWebInformation
    : data;
  var digest = info.FormDigestValue;
  var timeout = (info.FormDigestTimeoutSeconds || 1800) * 1000;

  _spDigestCache = { value: digest, expiry: now + timeout - 60000, siteUrl: siteUrl };
  return digest;
}

/**
 * Invalidate the cached digest, forcing a refresh on next call.
 */
export function spClearDigest() {
  _spDigestCache = { value: null, expiry: 0, siteUrl: null };
}

/**
 * Base fetch wrapper for SharePoint REST API calls.
 * Auto-includes digest for write operations, sets credentials and headers.
 *
 * @param {string} url - Full API URL
 * @param {object} [options] - Fetch options
 * @param {string} [options.method='GET'] - HTTP method
 * @param {string} [options.siteUrl] - Site URL for digest retrieval
 * @param {object} [options.headers] - Additional headers
 * @param {*} [options.body] - Request body
 * @param {string} [options.accept] - Accept header override
 * @returns {Promise<Response>}
 */
export async function spFetch(url, options) {
  options = options || {};
  var method = (options.method || 'GET').toUpperCase();
  var headers = Object.assign({}, options.headers || {});

  // Set default Accept if not provided
  if (!headers['Accept']) {
    headers['Accept'] = options.accept || 'application/json;odata=verbose';
  }

  // For write operations, include the digest
  if (method !== 'GET' && options.siteUrl) {
    if (!headers['X-RequestDigest']) {
      headers['X-RequestDigest'] = await spGetDigest(options.siteUrl);
    }
  }

  // Set Content-Type for POST/PUT/PATCH with JSON body
  if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && options.body && typeof options.body === 'object') {
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json;odata=verbose';
    }
    options.body = JSON.stringify(options.body);
  }

  var fetchOpts = {
    method: method,
    headers: headers,
    credentials: 'include'
  };

  if (options.body !== undefined && method !== 'GET') {
    fetchOpts.body = options.body;
  }

  var resp = await fetch(url, fetchOpts);

  // On 403, try refreshing digest and retry once
  if (resp.status === 403 && method !== 'GET' && options.siteUrl) {
    spClearDigest();
    headers['X-RequestDigest'] = await spGetDigest(options.siteUrl);
    fetchOpts.headers = headers;
    resp = await fetch(url, fetchOpts);
  }

  return resp;
}

/**
 * Test connection to a SharePoint site. Returns current user info.
 * @param {string} siteUrl - The SharePoint site URL
 * @returns {Promise<{ok: boolean, user?: object, error?: string}>}
 */
export async function spTestConnection(siteUrl) {
  try {
    var resp = await spFetch(siteUrl + '/_api/web/currentuser', {
      siteUrl: siteUrl,
      accept: 'application/json;odata=verbose'
    });
    if (!resp.ok) {
      return { ok: false, error: 'HTTP ' + resp.status + ' ' + resp.statusText };
    }
    var data = await resp.json();
    var user = data.d || data;
    return {
      ok: true,
      user: {
        title: user.Title,
        email: user.Email,
        loginName: user.LoginName,
        id: user.Id,
        isSiteAdmin: user.IsSiteAdmin
      }
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * Render SharePoint connection settings UI.
 * @param {HTMLElement} container - Container element
 * @returns {{ getSiteUrl: () => string }}
 */
export function spCreateSettingsUI(container) {
  var cyan = '#00e5ff';
  var pink = '#ff2975';
  var bg = '#12122a';
  var border = '#2a2a4a';
  var text = '#e0e0f0';
  var textDim = '#8888aa';

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'padding:16px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;margin:8px 0;';

  var title = document.createElement('div');
  title.textContent = 'SharePoint Connection';
  title.style.cssText = 'font-size:14px;font-weight:700;color:' + cyan + ';margin-bottom:12px;letter-spacing:1px;';
  wrapper.appendChild(title);

  // Site URL row
  var urlRow = document.createElement('div');
  urlRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;';

  var urlLabel = document.createElement('label');
  urlLabel.textContent = 'Site URL';
  urlLabel.style.cssText = 'color:' + textDim + ';font-size:12px;min-width:60px;';
  urlRow.appendChild(urlLabel);

  var urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.placeholder = 'https://your-site.sharepoint.com/sites/MySite';
  urlInput.style.cssText = 'flex:1;padding:6px 10px;background:#0a0a1a;border:1px solid ' + border + ';border-radius:4px;color:' + text + ';font-family:inherit;font-size:12px;outline:none;';
  urlInput.addEventListener('focus', function() { urlInput.style.borderColor = cyan; });
  urlInput.addEventListener('blur', function() { urlInput.style.borderColor = border; });

  // Pre-fill if on-domain
  var detectedUrl = spGetSiteUrl();
  if (detectedUrl) {
    urlInput.value = detectedUrl;
  }
  urlRow.appendChild(urlInput);

  var testBtn = document.createElement('button');
  testBtn.textContent = 'Test Connection';
  testBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid ' + cyan + ';border-radius:4px;color:' + cyan + ';font-family:inherit;font-size:12px;cursor:pointer;white-space:nowrap;';
  testBtn.addEventListener('mouseenter', function() { testBtn.style.background = 'rgba(0,229,255,0.1)'; });
  testBtn.addEventListener('mouseleave', function() { testBtn.style.background = 'transparent'; });
  urlRow.appendChild(testBtn);
  wrapper.appendChild(urlRow);

  // Status area
  var statusDiv = document.createElement('div');
  statusDiv.style.cssText = 'font-size:12px;color:' + textDim + ';min-height:20px;padding:4px 0;';
  wrapper.appendChild(statusDiv);

  // On-domain indicator
  if (spDetectOnDomain()) {
    var domainNote = document.createElement('div');
    domainNote.textContent = '● Running on SharePoint domain';
    domainNote.style.cssText = 'font-size:11px;color:#4caf50;margin-top:4px;';
    wrapper.appendChild(domainNote);
  }

  testBtn.addEventListener('click', async function() {
    var siteUrl = urlInput.value.replace(/\/+$/, '');
    if (!siteUrl) {
      statusDiv.style.color = pink;
      statusDiv.textContent = 'Enter a site URL first';
      return;
    }
    statusDiv.style.color = textDim;
    statusDiv.textContent = 'Testing connection...';
    testBtn.disabled = true;

    var result = await spTestConnection(siteUrl);
    testBtn.disabled = false;

    if (result.ok) {
      statusDiv.style.color = '#4caf50';
      statusDiv.textContent = '● Connected as ' + result.user.title + (result.user.email ? ' (' + result.user.email + ')' : '');
      if (result.user.isSiteAdmin) {
        statusDiv.textContent += ' [Site Admin]';
      }
    } else {
      statusDiv.style.color = pink;
      statusDiv.textContent = '✗ ' + result.error;
    }
  });

  container.appendChild(wrapper);

  return {
    getSiteUrl: function() { return urlInput.value.replace(/\/+$/, ''); }
  };
}
