/**
 * SharePoint Error Handling & Throttle Recovery
 * Parse SP error responses, retry with exponential backoff,
 * digest refresh on 403, user-friendly error display.
 * Zero external dependencies.
 */

/* global spFetch, spClearDigest, spGetDigest */

/**
 * Module-level throttle state tracking.
 */
var spThrottleState = {
  consecutiveThrottles: 0,
  lastThrottleTime: 0,
  totalThrottles: 0
};

/**
 * Parse a SharePoint error response.
 * Handles both odata=verbose and minimal/nometadata formats.
 *
 * @param {Response} response - The fetch Response object
 * @returns {Promise<{code: string, message: string, status: number, raw?: object}>}
 */
export async function spParseError(response) {
  var result = {
    code: 'Unknown',
    message: 'HTTP ' + response.status + ' ' + response.statusText,
    status: response.status,
    raw: null
  };

  try {
    var text = await response.text();
    if (!text) return result;

    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // May be XML error response
      var msgMatch = text.match(/<m:message[^>]*>([^<]+)<\/m:message>/i);
      if (msgMatch) {
        result.message = msgMatch[1];
      }
      return result;
    }

    result.raw = data;

    // odata=verbose format: { error: { code: "...", message: { value: "..." } } }
    if (data.error) {
      result.code = data.error.code || result.code;
      if (data.error.message) {
        result.message = typeof data.error.message === 'string'
          ? data.error.message
          : data.error.message.value || result.message;
      }
    }

    // odata=nometadata format: { "odata.error": { code: "...", message: { value: "..." } } }
    if (data['odata.error']) {
      var odataErr = data['odata.error'];
      result.code = odataErr.code || result.code;
      if (odataErr.message) {
        result.message = typeof odataErr.message === 'string'
          ? odataErr.message
          : odataErr.message.value || result.message;
      }
    }
  } catch (e) {
    // Could not parse body — return defaults
  }

  return result;
}

/**
 * Fetch with automatic retry on throttle (429) and service unavailable (503).
 * Uses exponential backoff with jitter. Refreshes digest on 403.
 *
 * @param {string} url - Full API URL
 * @param {object} [options] - Same options as spFetch
 * @param {number} [maxRetries=4] - Maximum retry attempts
 * @param {function} [onRetry] - Callback on retry: onRetry(attempt, waitMs, status)
 * @returns {Promise<Response>}
 */
export async function spFetchWithRetry(url, options, maxRetries, onRetry) {
  maxRetries = maxRetries || 4;
  var attempt = 0;

  while (true) {
    var resp = await spFetch(url, options);

    // Success or non-retryable error
    if (resp.ok || (resp.status !== 429 && resp.status !== 503 && resp.status !== 403)) {
      if (spThrottleState.consecutiveThrottles > 0) {
        spThrottleState.consecutiveThrottles = 0;
      }
      return resp;
    }

    // 403 — try digest refresh (once)
    if (resp.status === 403 && attempt === 0) {
      spClearDigest();
      if (options && options.siteUrl) {
        await spGetDigest(options.siteUrl);
      }
      attempt++;
      continue;
    }

    // 429/503 — throttled
    if (resp.status === 429 || resp.status === 503) {
      spThrottleState.consecutiveThrottles++;
      spThrottleState.totalThrottles++;
      spThrottleState.lastThrottleTime = Date.now();
    }

    if (attempt >= maxRetries) {
      return resp; // Return the error response after max retries
    }

    // Calculate backoff
    var retryAfter = resp.headers.get('Retry-After');
    var waitMs;
    if (retryAfter) {
      waitMs = parseInt(retryAfter, 10) * 1000;
      if (isNaN(waitMs)) {
        // Retry-After might be a date
        var retryDate = new Date(retryAfter).getTime();
        waitMs = retryDate - Date.now();
      }
    } else {
      // Exponential backoff: 1s, 2s, 4s, 8s with jitter
      var base = Math.pow(2, attempt) * 1000;
      var jitter = Math.random() * 500;
      waitMs = base + jitter;
    }

    waitMs = Math.max(waitMs, 500);
    waitMs = Math.min(waitMs, 30000);

    if (onRetry) {
      onRetry(attempt + 1, waitMs, resp.status);
    }

    await new Promise(function(resolve) { setTimeout(resolve, waitMs); });
    attempt++;
  }
}

/**
 * Render a user-friendly error display.
 *
 * @param {HTMLElement} container - Container element
 * @param {{code?: string, message: string, status?: number}} error - Parsed error
 * @returns {HTMLElement} The error element (for removal)
 */
export function spCreateErrorDisplay(container, error) {
  var pink = '#ff2975';
  var bgErr = '#1a0a14';
  var border = '#3a1a2a';

  var el = document.createElement('div');
  el.style.cssText = 'padding:10px 14px;background:' + bgErr + ';border:1px solid ' + border + ';border-radius:6px;margin:8px 0;font-size:12px;';

  var header = document.createElement('div');
  header.style.cssText = 'color:' + pink + ';font-weight:700;margin-bottom:4px;display:flex;align-items:center;gap:6px;';
  header.textContent = '✗ SharePoint Error';
  if (error.status) {
    var badge = document.createElement('span');
    badge.textContent = error.status;
    badge.style.cssText = 'font-size:10px;padding:1px 6px;border:1px solid ' + pink + ';border-radius:3px;font-weight:400;';
    header.appendChild(badge);
  }
  el.appendChild(header);

  var msg = document.createElement('div');
  msg.style.cssText = 'color:#e0a0b0;';
  msg.textContent = error.message;
  el.appendChild(msg);

  if (error.code && error.code !== 'Unknown') {
    var code = document.createElement('div');
    code.style.cssText = 'color:#886070;font-size:11px;margin-top:4px;';
    code.textContent = 'Code: ' + error.code;
    el.appendChild(code);
  }

  // Throttle info
  if (spThrottleState.totalThrottles > 0) {
    var throttleInfo = document.createElement('div');
    throttleInfo.style.cssText = 'color:#886070;font-size:11px;margin-top:4px;';
    throttleInfo.textContent = 'Throttle events: ' + spThrottleState.totalThrottles
      + ' (consecutive: ' + spThrottleState.consecutiveThrottles + ')';
    el.appendChild(throttleInfo);
  }

  // Dismiss button
  var dismiss = document.createElement('button');
  dismiss.textContent = '✕';
  dismiss.style.cssText = 'position:absolute;top:6px;right:8px;background:none;border:none;color:#886070;font-size:14px;cursor:pointer;padding:2px;';
  dismiss.addEventListener('click', function() { el.remove(); });
  el.style.position = 'relative';
  el.appendChild(dismiss);

  container.appendChild(el);
  return el;
}

/**
 * Get current throttle state for monitoring.
 * @returns {{consecutiveThrottles: number, lastThrottleTime: number, totalThrottles: number}}
 */
export function spGetThrottleState() {
  return Object.assign({}, spThrottleState);
}

/**
 * Reset throttle state counters.
 */
export function spResetThrottleState() {
  spThrottleState.consecutiveThrottles = 0;
  spThrottleState.lastThrottleTime = 0;
  spThrottleState.totalThrottles = 0;
}
