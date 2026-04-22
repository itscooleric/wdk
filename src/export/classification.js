/**
 * WDK Classification Banner Module
 * Adds CAPCO-style classification markings to WDK exports.
 */
(function () {
  'use strict';

  var VALID_LEVELS = [
    'UNCLASSIFIED', 'CUI', 'CONFIDENTIAL', 'SECRET',
    'TOP SECRET', 'TOP SECRET//SCI'
  ];

  var ALIASES = {
    'U': 'UNCLASSIFIED',
    'C': 'CONFIDENTIAL',
    'S': 'SECRET',
    'TS': 'TOP SECRET',
    'TS//SCI': 'TOP SECRET//SCI'
  };

  var currentLevel = 'UNCLASSIFIED';

  function normalizeLevel(level) {
    var upper = String(level).toUpperCase().replace(/\s+/g, ' ').trim();
    if (ALIASES[upper]) {
      return ALIASES[upper];
    }
    if (VALID_LEVELS.indexOf(upper) !== -1) {
      return upper;
    }
    return null;
  }

  function setLevel(level) {
    var normalized = normalizeLevel(level);
    if (!normalized) {
      throw new Error(
        'Invalid classification level: "' + level + '". ' +
        'Valid levels: ' + VALID_LEVELS.join(', ')
      );
    }
    currentLevel = normalized;
  }

  function getLevel() {
    return currentLevel;
  }

  function getBanner() {
    return currentLevel;
  }

  function wrapCSV(csvString) {
    var banner = getBanner();
    return banner + '\n' + csvString + '\n' + banner;
  }

  function wrapJSON(jsonObj) {
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth() + 1;
    var day = now.getDate();
    var dateStr = year + '-' +
      (month < 10 ? '0' + month : month) + '-' +
      (day < 10 ? '0' + day : day);

    return {
      '_classification': getBanner(),
      '_classified_by': 'WDK Export',
      '_date': dateStr,
      'data': jsonObj
    };
  }

  function wrapText(text) {
    var banner = getBanner();
    return banner + '\n\n' + text + '\n\n' + banner;
  }

  function getDocxBanner() {
    return {
      type: 'banner',
      text: getBanner(),
      position: 'both'
    };
  }

  function validate(text) {
    var errors = [];
    var detectedLevel = null;
    var lines = String(text).split('\n');
    var firstLine = lines[0] ? lines[0].trim() : '';
    var lastLine = '';
    var i;

    for (i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() !== '') {
        lastLine = lines[i].trim();
        break;
      }
    }

    var topLevel = normalizeLevel(firstLine);
    var bottomLevel = normalizeLevel(lastLine);

    if (!topLevel) {
      errors.push('Missing or invalid classification banner at top');
    }

    if (!bottomLevel) {
      errors.push('Missing or invalid classification banner at bottom');
    }

    if (topLevel && bottomLevel && topLevel !== bottomLevel) {
      errors.push(
        'Top banner (' + topLevel + ') does not match bottom banner (' + bottomLevel + ')'
      );
    }

    if (topLevel && bottomLevel && topLevel === bottomLevel) {
      detectedLevel = topLevel;
    } else if (topLevel) {
      detectedLevel = topLevel;
    } else if (bottomLevel) {
      detectedLevel = bottomLevel;
    }

    return {
      valid: errors.length === 0,
      level: detectedLevel,
      errors: errors
    };
  }

  // Expose on window.DK namespace
  if (typeof window !== 'undefined') {
    window.DK = window.DK || {};
    window.DK.classification = {
      setLevel: setLevel,
      getLevel: getLevel,
      getBanner: getBanner,
      wrapCSV: wrapCSV,
      wrapJSON: wrapJSON,
      wrapText: wrapText,
      getDocxBanner: getDocxBanner,
      validate: validate
    };
  }
})();
