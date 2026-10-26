/* Settings harness: loads the real options page with mocked chrome APIs. */
(function () {
  'use strict';

  var CACHE_BUST = '?v=' + Date.now();
  var storageData = {
    defaultCopyFormat: 'urls',
    autoWatch: false,
    showBadge: true
  };
  var storageListeners = [];

  function notifyStorage(changes) {
    storageListeners.forEach(function (listener) {
      try {
        listener(changes, 'sync');
      } catch (error) {
        console.error('[options harness] storage listener failed', error);
      }
    });
  }

  var storageArea = {
    get: function (defaults) {
      var result = {};
      if (defaults && typeof defaults === 'object') {
        Object.keys(defaults).forEach(function (key) { result[key] = defaults[key]; });
      }
      Object.keys(storageData).forEach(function (key) { result[key] = storageData[key]; });
      return Promise.resolve(result);
    },
    set: function (patch) {
      var changes = {};
      Object.keys(patch || {}).forEach(function (key) {
        changes[key] = { oldValue: storageData[key], newValue: patch[key] };
        storageData[key] = patch[key];
      });
      notifyStorage(changes);
      return Promise.resolve();
    }
  };

  var mock = {
    badges: { 7: '8', 8: '3' },
    badgeWrites: [],
    chrome: {
      storage: {
        sync: storageArea,
        local: storageArea,
        onChanged: {
          addListener: function (listener) {
            storageListeners.push(listener);
          }
        }
      },
      tabs: {
        query: function () {
          return Promise.resolve([{ id: 7 }, { id: 8 }]);
        }
      },
      action: {
        setBadgeText: function (details) {
          mock.badgeWrites.push({ tabId: details.tabId, text: details.text || '' });
          mock.badges[details.tabId] = details.text || '';
          return Promise.resolve();
        }
      },
      runtime: {
        getManifest: function () {
          return { version: '1.4.0' };
        }
      }
    }
  };

  window.__optionsMock = mock;
  window.__optionsReady = false;

  function delay(milliseconds) {
    return new Promise(function (resolve) {
      setTimeout(resolve, milliseconds);
    });
  }

  function loadFrame(frame, html) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error('The options frame did not load within 6 seconds.'));
      }, 6000);
      frame.addEventListener('load', function () {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      frame.srcdoc = html;
    });
  }

  function setText(id, text) {
    var element = document.getElementById(id);
    if (element) element.textContent = text;
  }

  function renderChecks(results) {
    var container = document.getElementById('checks');
    container.replaceChildren();
    results.forEach(function (item) {
      var line = document.createElement('p');
      line.className = 'check ' + (item.ok ? 'pass' : 'fail');
      line.textContent = (item.ok ? 'PASS ' : 'FAIL ') + item.name +
        (item.ok ? '' : ' — ' + item.detail);
      container.appendChild(line);
    });
  }

  function updatePanel(results) {
    setText('mock-storage', JSON.stringify(storageData, null, 2));
    setText('mock-badges', JSON.stringify(mock.badges, null, 2));
    var frame = document.getElementById('options-frame');
    var status = frame.contentDocument ? frame.contentDocument.getElementById('save-status') : null;
    setText('mock-status', status ? status.textContent : '-');
    if (results) renderChecks(results);
  }

  function showError(message) {
    var banner = document.getElementById('error-banner');
    banner.textContent = message;
    banner.style.display = 'block';
    window.__optionsHarnessError = message;
  }

  async function runChecks(frame) {
    var doc = frame.contentDocument;
    var results = [];

    function check(name, fn) {
      try {
        var value = fn();
        results.push({ name: name, ok: value !== false, detail: value === false ? 'Assertion returned false.' : '' });
      } catch (error) {
        results.push({ name: name, ok: false, detail: error && error.message ? error.message : String(error) });
      }
    }

    await delay(200);

    check('Settings load with defaults', function () {
      if (doc.getElementById('copy-format').value !== 'urls') throw new Error('copy format is not urls');
      if (doc.getElementById('auto-watch').checked) throw new Error('auto-watch should be off');
      if (!doc.getElementById('show-badge').checked) throw new Error('show-badge should be on');
      if (doc.getElementById('copy-format').disabled) throw new Error('controls are disabled');
    });

    var select = doc.getElementById('copy-format');
    select.value = 'json';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await delay(180);
    check('Copy format change saves', function () {
      if (storageData.defaultCopyFormat !== 'json') throw new Error('storage was not updated');
    });

    doc.getElementById('auto-watch').click();
    await delay(180);
    check('Auto-watch saves', function () {
      if (storageData.autoWatch !== true) throw new Error('autoWatch was not saved');
    });

    doc.getElementById('show-badge').click();
    await delay(320);
    check('Badge preference saves and clears badges', function () {
      if (storageData.showBadge !== false) throw new Error('showBadge was not saved');
      if (mock.badges[7] !== '' || mock.badges[8] !== '') throw new Error('badges were not cleared');
      var clears = mock.badgeWrites.filter(function (item) { return item.text === ''; });
      if (clears.length < 2) throw new Error('expected two clear writes');
    });

    doc.getElementById('reset-btn').click();
    await delay(360);
    check('Reset restores defaults', function () {
      if (storageData.defaultCopyFormat !== 'urls') throw new Error('copy format was not reset');
      if (storageData.autoWatch !== false) throw new Error('autoWatch was not reset');
      if (storageData.showBadge !== true) throw new Error('showBadge was not reset');
      if (doc.getElementById('copy-format').value !== 'urls') throw new Error('UI copy format was not reset');
      if (doc.getElementById('auto-watch').checked) throw new Error('UI auto-watch was not reset');
      if (!doc.getElementById('show-badge').checked) throw new Error('UI show-badge was not reset');
    });

    return results;
  }

  async function boot() {
    var response = await fetch('../options.html', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load options.html (HTTP ' + response.status + ').');
    var html = await response.text();
    var parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed.body.querySelectorAll('script').forEach(function (script) { script.remove(); });
    // Resolve brand images from the site root. The srcdoc preload scanner can
    // otherwise request them relative to /tests/ before <base> is applied.
    var bodyHtml = parsed.body.innerHTML.replace(/(src=")brand\//g, '$1/brand/');

    var documentHtml = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<base href="../">' +
      '<title>Clipfox settings harness</title>' +
      '<link rel="stylesheet" href="/options.css' + CACHE_BUST + '">' +
      '</head><body>' + bodyHtml +
      '<script>window.chrome = parent.__optionsMock.chrome;<\/script>' +
      '<script defer src="/options.js' + CACHE_BUST + '"><\/script>' +
      '</body></html>';

    var frame = document.getElementById('options-frame');
    await loadFrame(frame, documentHtml);

    var results = await runChecks(frame);
    window.__optionsResults = {
      passed: results.filter(function (item) { return item.ok; }).length,
      failed: results.filter(function (item) { return !item.ok; }).length,
      total: results.length,
      checks: results
    };
    window.__optionsReady = true;
    updatePanel(results);
    setInterval(function () { updatePanel(); }, 350);
  }

  boot().catch(function (error) {
    showError('Harness failed: ' + (error && error.message ? error.message : String(error)));
    updatePanel();
  });
})();
