/* Settings harness: loads the real options page with mocked chrome APIs. */
(function () {
  'use strict';

  var CACHE_BUST = '?v=' + Date.now();
  // Deliberately omit the new preference keys to cover an older install.
  var storageData = { defaultCopyFormat: 'urls', autoWatch: false, showBadge: true };
  var localData = {};
  var storageListeners = [];
  var mock;

  function notifyStorage(changes, areaName) {
    storageListeners.forEach(function (listener) {
      try {
        listener(changes, areaName);
      } catch (error) {
        console.error('[options harness] storage listener failed', error);
      }
    });
  }

  function makeStorageArea(data, areaName) {
    return {
      get: function (defaults) {
        if (areaName === 'sync' && mock.failSyncReads) return Promise.reject(new Error('sync read failed'));
        if (areaName === 'local' && mock.failLocalReads) return Promise.reject(new Error('local read failed'));
      var result = {};
      if (defaults && typeof defaults === 'object') {
        Object.keys(defaults).forEach(function (key) { result[key] = defaults[key]; });
      }
        Object.keys(data).forEach(function (key) { result[key] = data[key]; });
        return Promise.resolve(result);
      },
      set: function (patch) {
        if (areaName === 'sync' && mock.failSyncWrites) return Promise.reject(new Error('sync write failed'));
        if (areaName === 'local' && mock.failLocalWrites) return Promise.reject(new Error('local write failed'));
        var changes = {};
        Object.keys(patch || {}).forEach(function (key) {
          changes[key] = { oldValue: data[key], newValue: patch[key] };
          data[key] = patch[key];
        });
        notifyStorage(changes, areaName);
        return Promise.resolve();
      }
    };
  }

  mock = {
    badges: { 7: '8', 8: '3' },
    badgeWrites: [],
    failSyncReads: true,
    failLocalReads: true,
    failSyncWrites: false,
    failLocalWrites: false,
    chrome: {
      storage: {
        sync: makeStorageArea(storageData, 'sync'),
        local: makeStorageArea(localData, 'local'),
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
          return { version: '1.4.1' };
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

    await delay(220);
    check('Load failure disables controls and offers retry', function () {
      if (!doc.getElementById('copy-format').disabled) throw new Error('controls should be disabled while preferences fail to load');
      if (doc.getElementById('retry-btn').hidden) throw new Error('retry button should be visible');
      if (doc.getElementById('save-status').textContent.indexOf('Could not load') === -1) throw new Error('load error is not announced');
    });

    mock.failSyncReads = false;
    mock.failLocalReads = false;
    doc.getElementById('retry-btn').click();
    await delay(220);
    check('Older installs receive new preference defaults', function () {
      if (doc.getElementById('copy-format').value !== 'urls') throw new Error('copy format default is not urls');
      if (doc.getElementById('default-filter').value !== 'video') throw new Error('default filter is not videos');
      if (doc.getElementById('badge-count-mode').value !== 'all') throw new Error('badge mode is not all links');
      if (doc.getElementById('watch-interval').value !== '3000') throw new Error('watch interval is not 3 seconds');
      if (doc.getElementById('auto-watch').checked) throw new Error('auto-watch should be off');
      if (!doc.getElementById('show-badge').checked) throw new Error('show-badge should be on');
      if (!doc.getElementById('save-btn').disabled) throw new Error('Save should be disabled with no draft changes');
    });

    var format = doc.getElementById('copy-format');
    format.value = 'json';
    format.dispatchEvent(new Event('change', { bubbles: true }));
    doc.getElementById('default-filter').value = 'all';
    doc.getElementById('default-filter').dispatchEvent(new Event('change', { bubbles: true }));
    doc.getElementById('watch-interval').value = '5000';
    doc.getElementById('watch-interval').dispatchEvent(new Event('change', { bubbles: true }));
    doc.getElementById('auto-watch').click();
    doc.getElementById('badge-count-mode').value = 'video';
    doc.getElementById('badge-count-mode').dispatchEvent(new Event('change', { bubbles: true }));
    check('Edits stay as a draft until saved', function () {
      if (storageData.defaultCopyFormat !== 'urls') throw new Error('draft wrote to storage before Save');
      if (storageData.defaultFilter !== undefined) throw new Error('new preference wrote to old storage before Save');
      if (doc.getElementById('save-btn').disabled) throw new Error('Save should be enabled for a dirty form');
      if (doc.getElementById('save-status').textContent !== 'Unsaved changes') throw new Error('unsaved state is not shown');
    });

    doc.getElementById('cancel-btn').click();
    check('Cancel restores the last saved values', function () {
      if (doc.getElementById('copy-format').value !== 'urls') throw new Error('Cancel did not restore copy format');
      if (doc.getElementById('default-filter').value !== 'video') throw new Error('Cancel did not restore filter');
      if (doc.getElementById('watch-interval').value !== '3000') throw new Error('Cancel did not restore interval');
      if (!doc.getElementById('save-btn').disabled) throw new Error('Save should be disabled after cancel');
    });

    format.value = 'json';
    format.dispatchEvent(new Event('change', { bubbles: true }));
    doc.getElementById('default-filter').value = 'all';
    doc.getElementById('default-filter').dispatchEvent(new Event('change', { bubbles: true }));
    doc.getElementById('watch-interval').value = '5000';
    doc.getElementById('watch-interval').dispatchEvent(new Event('change', { bubbles: true }));
    doc.getElementById('auto-watch').click();
    doc.getElementById('badge-count-mode').value = 'video';
    doc.getElementById('badge-count-mode').dispatchEvent(new Event('change', { bubbles: true }));
    doc.getElementById('save-btn').click();
    await delay(220);
    check('Save persists the new preferences together', function () {
      if (storageData.defaultCopyFormat !== 'json') throw new Error('copy format was not saved');
      if (storageData.defaultFilter !== 'all') throw new Error('filter was not saved');
      if (storageData.watchIntervalMs !== 5000) throw new Error('interval was not saved as a number');
      if (storageData.autoWatch !== true) throw new Error('auto-watch was not saved');
      if (storageData.badgeCountMode !== 'video') throw new Error('badge mode was not saved');
      if (doc.getElementById('save-status').textContent !== 'All changes saved') throw new Error('success state is missing');
    });

    check('Changing badge mode clears old counts', function () {
      if (mock.badges[7] !== '' || mock.badges[8] !== '') throw new Error('mode change kept counts from the old badge mode');
    });

    mock.badges[7] = '5';
    mock.badges[8] = '2';
    mock.badgeWrites = [];
    doc.getElementById('show-badge').click();
    check('Badge changes do not apply before Save', function () {
      if (storageData.showBadge !== true) throw new Error('badge setting wrote before Save');
      if (mock.badges[7] !== '5' || mock.badges[8] !== '2') throw new Error('badges cleared before Save');
    });
    doc.getElementById('save-btn').click();
    await delay(220);
    check('Saving badge off clears existing badges', function () {
      if (storageData.showBadge !== false) throw new Error('badge preference was not saved');
      if (mock.badges[7] !== '' || mock.badges[8] !== '') throw new Error('badges were not cleared');
    });

    doc.getElementById('reset-btn').click();
    check('Reset stages defaults without changing storage', function () {
      if (storageData.defaultCopyFormat !== 'json') throw new Error('Reset wrote to storage before Save');
      if (doc.getElementById('default-filter').value !== 'video') throw new Error('filter default was not staged');
      if (doc.getElementById('badge-count-mode').value !== 'all') throw new Error('badge mode default was not staged');
      if (doc.getElementById('watch-interval').value !== '3000') throw new Error('interval default was not staged');
      if (doc.getElementById('auto-watch').checked) throw new Error('auto-watch default was not staged');
      if (!doc.getElementById('show-badge').checked) throw new Error('badge default was not staged');
    });
    doc.getElementById('cancel-btn').click();
    check('Cancel discards staged reset', function () {
      if (doc.getElementById('copy-format').value !== 'json') throw new Error('staged reset was not discarded');
      if (storageData.showBadge !== false) throw new Error('Cancel changed saved badge preference');
    });
    doc.getElementById('reset-btn').click();
    doc.getElementById('save-btn').click();
    await delay(250);
    check('Saving reset restores every default and clears stale badges', function () {
      if (storageData.defaultCopyFormat !== 'urls' || storageData.autoWatch !== false || storageData.showBadge !== true) {
        throw new Error('legacy preference defaults were not restored');
      }
      if (storageData.defaultFilter !== 'video' || storageData.badgeCountMode !== 'all' || storageData.watchIntervalMs !== 3000) {
        throw new Error('new preference defaults were not restored');
      }
      if (mock.badges[7] !== '' || mock.badges[8] !== '') throw new Error('stale badge counts were not cleared on mode change');
    });

    mock.failSyncWrites = true;
    doc.getElementById('default-filter').value = 'all';
    doc.getElementById('default-filter').dispatchEvent(new Event('change', { bubbles: true }));
    doc.getElementById('save-btn').click();
    await delay(220);
    check('Sync failure falls back to local storage', function () {
      if (localData.defaultFilter !== 'all') throw new Error('fallback preference was not saved locally');
      if (doc.getElementById('save-detail').textContent.indexOf('Saved on this device') === -1) throw new Error('local-only save status is missing');
    });

    mock.failLocalWrites = true;
    doc.getElementById('watch-interval').value = '10000';
    doc.getElementById('watch-interval').dispatchEvent(new Event('change', { bubbles: true }));
    doc.getElementById('save-btn').click();
    await delay(220);
    check('Failed save preserves the draft for retry', function () {
      if (doc.getElementById('watch-interval').value !== '10000') throw new Error('failed save lost the draft');
      if (!doc.getElementById('save-status').textContent.includes('Could not save')) throw new Error('save failure is not announced');
      if (doc.getElementById('save-btn').disabled) throw new Error('Save should remain enabled for retry');
    });
    doc.getElementById('cancel-btn').click();
    check('Cancel recovers from a failed save', function () {
      if (doc.getElementById('watch-interval').value !== '3000') throw new Error('Cancel did not restore last saved value');
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
