/**
 * SharePoint Version/Compatibility Layer
 * Detect SP version, toggle OData modes, feature matrix.
 * Zero external dependencies.
 */

/* global spFetch */

/**
 * Feature support matrix by SharePoint version.
 */
var SP_FEATURE_MATRIX = {
  '2013': {
    batch: false,
    modernUi: false,
    resourcePath: false,
    clientSideAssets: false,
    spfx: false,
    odataMode: 'verbose',
    minimalMetadata: false,
    webhooks: false,
    flowIntegration: false
  },
  '2016': {
    batch: true,
    modernUi: false,
    resourcePath: true,
    clientSideAssets: false,
    spfx: false,
    odataMode: 'nometadata',
    minimalMetadata: true,
    webhooks: false,
    flowIntegration: false
  },
  '2019': {
    batch: true,
    modernUi: true,
    resourcePath: true,
    clientSideAssets: true,
    spfx: true,
    odataMode: 'nometadata',
    minimalMetadata: true,
    webhooks: true,
    flowIntegration: false
  },
  'spo': {
    batch: true,
    modernUi: true,
    resourcePath: true,
    clientSideAssets: true,
    spfx: true,
    odataMode: 'nometadata',
    minimalMetadata: true,
    webhooks: true,
    flowIntegration: true
  }
};

/**
 * Detect SharePoint version by querying the web endpoint.
 * Falls back to page metadata inspection.
 *
 * @param {string} siteUrl - The SharePoint site URL
 * @returns {Promise<{version: string, major: number, minor: number, label: string}>}
 */
export async function spDetectVersion(siteUrl) {
  try {
    // Try _api/web to get server version from response headers
    var resp = await spFetch(siteUrl + '/_api/web?$select=UIVersion', {
      siteUrl: siteUrl,
      accept: 'application/json;odata=verbose'
    });

    // Check MicrosoftSharePointTeamServices header
    var serverVersion = resp.headers.get('MicrosoftSharePointTeamServices') || '';
    var data = await resp.json();

    if (serverVersion) {
      var parts = serverVersion.split('.');
      var major = parseInt(parts[0], 10);
      var minor = parseInt(parts[1], 10) || 0;
      return _resolveVersion(major, minor);
    }

    // Fallback: check UIVersion from response
    var uiVersion = data.d ? data.d.UIVersion : data.UIVersion;
    if (uiVersion) {
      // UIVersion 15 = 2013/2016/2019, 16 = SPO
      // Need more info to distinguish
    }
  } catch (e) {
    // Fallback to page context
  }

  // Fallback: check _spPageContextInfo
  if (typeof _spPageContextInfo !== 'undefined') {
    var ctx = _spPageContextInfo;
    if (ctx.isSPO) return { version: 'spo', major: 16, minor: 0, label: 'SharePoint Online' };
    if (ctx.webUIVersion === 15) {
      // Could be 2013, 2016, or 2019 — check for modern page support
      if (ctx.modernPageFeatureEnabled) return { version: '2019', major: 16, minor: 0, label: 'SharePoint 2019' };
    }
  }

  // Fallback: check for modern UI indicators in DOM
  if (document.querySelector('[data-sp-feature-tag]') || document.getElementById('spSiteHeader')) {
    return { version: 'spo', major: 16, minor: 0, label: 'SharePoint Online' };
  }

  // Default to 2013 (most conservative)
  return { version: '2013', major: 15, minor: 0, label: 'SharePoint 2013 (assumed)' };
}

/**
 * Resolve major.minor version numbers to a named version.
 * @param {number} major
 * @param {number} minor
 * @returns {{version: string, major: number, minor: number, label: string}}
 */
function _resolveVersion(major, minor) {
  if (major >= 16 && minor >= 20000) {
    return { version: 'spo', major: major, minor: minor, label: 'SharePoint Online' };
  }
  if (major >= 16 && minor >= 4351) {
    return { version: '2019', major: major, minor: minor, label: 'SharePoint 2019' };
  }
  if (major >= 16) {
    return { version: '2016', major: major, minor: minor, label: 'SharePoint 2016' };
  }
  if (major >= 15) {
    return { version: '2013', major: major, minor: minor, label: 'SharePoint 2013' };
  }
  return { version: '2013', major: major, minor: minor, label: 'SharePoint (unknown, v' + major + ')' };
}

/**
 * Get appropriate OData Accept header for a given SP version.
 * SP 2013 requires odata=verbose; 2016+ supports nometadata.
 *
 * @param {{version: string}} versionInfo - Output from spDetectVersion
 * @returns {string} Accept header value
 */
export function spGetODataHeaders(versionInfo) {
  var mode = SP_FEATURE_MATRIX[versionInfo.version]
    ? SP_FEATURE_MATRIX[versionInfo.version].odataMode
    : 'verbose';
  if (mode === 'nometadata') {
    return 'application/json;odata=nometadata';
  }
  return 'application/json;odata=verbose';
}

/**
 * Check if a specific feature is supported by the detected SP version.
 *
 * @param {{version: string}} versionInfo - Output from spDetectVersion
 * @param {string} feature - Feature key: 'batch', 'modernUi', 'resourcePath', 'clientSideAssets', 'spfx', 'webhooks', 'flowIntegration'
 * @returns {boolean}
 */
export function spSupportsFeature(versionInfo, feature) {
  var matrix = SP_FEATURE_MATRIX[versionInfo.version];
  if (!matrix) return false;
  return !!matrix[feature];
}

/**
 * Get warning HTML if running in IE11.
 * @returns {string|null} Warning HTML or null if not IE11
 */
export function spGetIE11Warning() {
  if (typeof window !== 'undefined' && window.MSInputMethodContext && document.documentMode) {
    return '<div style="padding:10px;background:#3a1a00;border:1px solid #ff6600;border-radius:4px;color:#ffaa44;font-size:12px;margin:8px 0;">'
      + '⚠ Internet Explorer 11 detected. Some features may have limited functionality. '
      + 'Async operations use XHR fallback. Consider using Edge or Chrome for full support.'
      + '</div>';
  }
  return null;
}

/**
 * Get the full feature matrix for display purposes.
 * @returns {object}
 */
export function spGetFeatureMatrix() {
  return SP_FEATURE_MATRIX;
}
